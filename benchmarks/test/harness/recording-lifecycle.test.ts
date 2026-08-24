import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";

import { benchmarkRecordingPaths, createBenchmarkRecording } from "../../src/harness/recording-lifecycle.ts";

const lifecycleModule = new URL("../../src/harness/recording-lifecycle.ts", import.meta.url).href;

test("keeps active output raw and atomically publishes an exact Brotli recording", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-recording-"));
  try {
    const finalPath = join(root, "request.jsonl.br");
    const oldCompressed = brotliCompressSync(Buffer.from('{"old":true}\n'));
    writeFileSync(finalPath, oldCompressed, { mode: 0o600 });
    const recording = createBenchmarkRecording(finalPath);
    assert.equal(recording.activePath.endsWith(".br"), false);
    assert.equal(statSync(recording.activePath).mode & 0o777, 0o600);
    assert.equal(existsSync(recording.compressedTempPath), false);

    const expected = '{"event":1}\nmalformed-but-preserved\n{"event":2}\n';
    recording.stream.write(expected.slice(0, 13));
    recording.stream.write(expected.slice(13));
    assert.deepEqual(readFileSync(finalPath), oldCompressed);

    await recording.finalize();
    assert.equal(existsSync(recording.activePath), false);
    assert.equal(existsSync(recording.compressedTempPath), false);
    assert.equal(statSync(finalPath).mode & 0o777, 0o600);
    assert.equal(brotliDecompressSync(readFileSync(finalPath)).toString("utf8"), expected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("abort cleans handled exits while active crash scratch fails closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-recording-abort-"));
  try {
    const finalPath = join(root, "request.jsonl.br");
    const first = createBenchmarkRecording(finalPath);
    first.stream.write("sensitive partial output\n");
    await first.abort();
    assert.equal(existsSync(first.activePath), false);
    assert.equal(existsSync(first.compressedTempPath), false);
    assert.equal(existsSync(finalPath), false);

    writeFileSync(first.compressedTempPath, "stale compressed temp", { mode: 0o600 });
    const second = createBenchmarkRecording(finalPath);
    assert.equal(readFileSync(second.activePath, "utf8"), "");
    assert.equal(existsSync(second.compressedTempPath), false);
    second.stream.write("private crash output\n");
    assert.equal(statSync(second.activePath).mode & 0o777, 0o600);
    writeFileSync(second.compressedTempPath, "owned finalizer temp", { mode: 0o600 });
    assert.throws(() => createBenchmarkRecording(finalPath), /EEXIST|exist/i);
    assert.equal(readFileSync(second.compressedTempPath, "utf8"), "owned finalizer temp");
    await second.abort();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed compression keeps the old final and preserves an unexpected temp collision", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-recording-failure-"));
  try {
    const finalPath = join(root, "request.jsonl.br");
    const oldCompressed = brotliCompressSync(Buffer.from("old recording\n"));
    writeFileSync(finalPath, oldCompressed, { mode: 0o600 });
    const recording = createBenchmarkRecording(finalPath);
    recording.stream.write("new recording\n");
    writeFileSync(recording.compressedTempPath, "collision", { mode: 0o600 });
    await assert.rejects(recording.finalize(), /EEXIST|exist/i);
    assert.deepEqual(readFileSync(finalPath), oldCompressed);
    assert.equal(existsSync(recording.activePath), false);
    assert.equal(readFileSync(recording.compressedTempPath, "utf8"), "collision");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("active-process crash exposes no partial final and blocks unsafe restart", () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-recording-crash-"));
  try {
    const finalPath = join(root, "request.jsonl.br");
    const source = `
      import { createBenchmarkRecording } from ${JSON.stringify(lifecycleModule)};
      const recording = createBenchmarkRecording(${JSON.stringify(finalPath)});
      recording.stream.write("private partial output\\n");
      setTimeout(() => process.kill(process.pid, "SIGKILL"), 50);
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], { timeout: 5_000 });
    assert.equal(child.signal, "SIGKILL");
    assert.equal(existsSync(finalPath), false);
    const { activePath } = benchmarkRecordingPaths(finalPath);
    assert.equal(statSync(activePath).mode & 0o777, 0o600);
    assert.throws(() => createBenchmarkRecording(finalPath), /EEXIST|exist/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fsynced publication survives immediate process death after finalize", () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-recording-publish-"));
  try {
    const finalPath = join(root, "request.jsonl.br");
    const expected = "durable final recording\n";
    const source = `
      import { createBenchmarkRecording } from ${JSON.stringify(lifecycleModule)};
      const recording = createBenchmarkRecording(${JSON.stringify(finalPath)});
      recording.stream.write(${JSON.stringify(expected)});
      await recording.finalize();
      process.kill(process.pid, "SIGKILL");
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], { timeout: 5_000 });
    assert.equal(child.signal, "SIGKILL");
    assert.equal(brotliDecompressSync(readFileSync(finalPath)).toString("utf8"), expected);
    assert.equal(existsSync(benchmarkRecordingPaths(finalPath).activePath), false);
    assert.equal(existsSync(`${finalPath}.tmp`), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
