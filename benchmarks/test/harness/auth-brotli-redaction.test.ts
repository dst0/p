import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";

import { createBenchmarkAuthOutputGuard } from "../../src/harness/auth-output-guard.ts";
import { replacePrivateBrotliText } from "../../src/harness/private-brotli.ts";

const q6TextParameters = {
  [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
  [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
};

test("auth redaction atomically publishes exact private Q6-text Brotli evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "p-auth-brotli-redaction-"));
  try {
    const auth = join(root, "auth.json");
    const output = join(root, "output");
    const artifact = join(output, "stderr.log.br");
    const token = "atomic-redaction-secret";
    writeFileSync(auth, `${JSON.stringify({ token })}\n`);
    mkdirSync(output);
    writeFileSync(artifact, brotliCompressSync(Buffer.from(`before ${token} after\n`)));
    createBenchmarkAuthOutputGuard([auth]).sanitizeTree(output);
    const sanitized = "before <REDACTED_AUTH> after\n";
    assert.equal(statSync(artifact).mode & 0o777, 0o600);
    assert.deepEqual(readFileSync(artifact), brotliCompressSync(Buffer.from(sanitized), { params: q6TextParameters }));
    assert.equal(brotliDecompressSync(readFileSync(artifact)).toString("utf8"), sanitized);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("auth redaction cannot succeed when atomic Brotli replacement fails", () => {
  const root = mkdtempSync(join(tmpdir(), "p-auth-brotli-failure-"));
  try {
    const auth = join(root, "auth.json");
    const output = join(root, "output");
    const token = "replacement-failure-secret";
    writeFileSync(auth, `${JSON.stringify({ token })}\n`);
    mkdirSync(output);
    writeFileSync(join(output, "recording.jsonl.br"), brotliCompressSync(Buffer.from(`${token}\n`)));
    const guard = createBenchmarkAuthOutputGuard([auth], {
      replaceBrotliText: (path, text) => replacePrivateBrotliText(path, text, { faultAt: "before-publish" }),
    });
    assert.throws(() => guard.sanitizeTree(output), /Private benchmark artifact/u);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
