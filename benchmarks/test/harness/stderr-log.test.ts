import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";

import { writeBenchmarkStderrLog } from "../../src/harness/stderr-log.ts";

const q6Parameters = {
  [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
  [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
};

test("atomically writes exact private Brotli-Q6 stderr and replaces an old log", () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-stderr-"));
  try {
    const first = "first stderr 😀\n".repeat(512);
    const fileName = writeBenchmarkStderrLog(root, "p-run-1-task", first);
    const finalPath = join(root, fileName);
    assert.equal(fileName, "p-run-1-task.log.br");
    assert.equal(statSync(finalPath).mode & 0o777, 0o600);
    assert.deepEqual(readFileSync(finalPath), brotliCompressSync(Buffer.from(first), { params: q6Parameters }));
    assert.equal(brotliDecompressSync(readFileSync(finalPath)).toString("utf8"), first);

    chmodSync(finalPath, 0o644);
    const replacement = "replacement stderr\n";
    assert.equal(writeBenchmarkStderrLog(root, "p-run-1-task", replacement), fileName);
    assert.equal(statSync(finalPath).mode & 0o777, 0o600);
    assert.equal(brotliDecompressSync(readFileSync(finalPath)).toString("utf8"), replacement);
    assert.deepEqual(readdirSync(root), [fileName]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses exact startup paths and rejects unsafe input without replacing evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-stderr-paths-"));
  try {
    assert.equal(
      writeBenchmarkStderrLog(root, "model-resolution.stderr", "resolution\n"),
      "model-resolution.stderr.log.br",
    );
    assert.equal(writeBenchmarkStderrLog(root, "request.stderr", "request\n"), "request.stderr.log.br");
    const requestPath = join(root, "request.stderr.log.br");
    const before = readFileSync(requestPath);
    assert.throws(() => writeBenchmarkStderrLog(root, "../request.stderr", "unsafe\n"), /safe file stem/u);
    assert.throws(() => writeBenchmarkStderrLog(root, "request.stderr", Buffer.from("not text")), /must be a string/u);
    assert.deepEqual(readFileSync(requestPath), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("benchmark runner routes every task and startup stderr artifact through the Brotli writer", () => {
  const source = [
    readFileSync(new URL("../../src/workloads/benchmark-run.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../../src/workloads/startup-probes.ts", import.meta.url), "utf8"),
  ].join("\n");
  assert.equal(source.match(/writeBenchmarkStderrLog\(/gu)?.length, 4);
  assert.match(source, /benchmarkStderrLogName\("request\.stderr"\)/u);
  assert.doesNotMatch(source, /\.stderr\.log["`]/u);
  assert.doesNotMatch(source, /stderrName = `[^`]+\.log`/u);
});
