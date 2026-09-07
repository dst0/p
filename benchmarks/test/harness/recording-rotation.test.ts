import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";

import { runBenchmarkAgentTurn } from "../../src/agents/turn.ts";
import { createBenchmarkRecording } from "../../src/harness/recording-lifecycle.ts";

function writeRecording(
  recording: ReturnType<typeof createBenchmarkRecording>,
  value: Uint8Array | string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    recording.stream.write(value, (error) => (error ? reject(error) : resolve()));
  });
}

function command(source: string) {
  return {
    executable: process.execPath,
    args: ["-e", source],
    cwd: process.cwd(),
    env: process.env,
  };
}

test("rotates private raw chunks while preserving arbitrary bytes in one exact final archive", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-recording-rotation-"));
  const finalPath = join(root, "recording.jsonl.br");
  const recording = createBenchmarkRecording(finalPath, {
    maxActiveChunkBytes: 11,
    maxBytes: 4_096,
    maxStoredBytes: 4_096,
  });
  try {
    const expected = Buffer.concat([
      Buffer.from('{"event":1}\n'),
      Buffer.from([0x66, 0x80, 0x0a]),
      Buffer.from('{"event":2,"value":"abcdefghijklmnopqrstuvwxyz"}\n'),
    ]);
    await writeRecording(recording, expected);

    assert.equal(typeof recording.chunkDirectory, "string");
    assert.equal(statSync(recording.chunkDirectory).mode & 0o777, 0o700);
    assert.ok(statSync(recording.activePath).size <= 11);
    assert.equal(statSync(recording.activePath).mode & 0o777, 0o600);
    const chunks = readdirSync(recording.chunkDirectory)
      .filter((name) => name.endsWith(".br"))
      .sort();
    assert.ok(chunks.length >= 4);
    const activePrefix = Buffer.concat([
      ...chunks.map((name) => {
        const path = join(recording.chunkDirectory, name);
        assert.equal(statSync(path).mode & 0o777, 0o600);
        return brotliDecompressSync(readFileSync(path));
      }),
      readFileSync(recording.activePath),
    ]);
    assert.deepEqual(activePrefix, expected);

    await recording.finalize();
    assert.deepEqual(brotliDecompressSync(readFileSync(finalPath)), expected);
    assert.equal(statSync(finalPath).mode & 0o777, 0o600);
    assert.equal(
      readdirSync(root).some((name) => name.includes("chunks")),
      false,
    );
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
});

test("stored recording overflow terminates the child with bounded partial evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-recording-storage-cap-"));
  const recording = createBenchmarkRecording(join(root, "recording.jsonl.br"), {
    maxActiveChunkBytes: 64,
    maxBytes: 8_192,
    maxStoredBytes: 256,
  });
  try {
    const result = await runBenchmarkAgentTurn(
      command(
        "const value = Buffer.from(Array.from({ length: 4096 }, (_, index) => (index * 97 + 31) % 251)); process.stdout.write(value); setInterval(() => {}, 1000);",
      ),
      1_000,
      recording,
      new Set(),
      { failureKillGraceMs: 50, outputLimits: { maxLineBytes: 8_192 }, turn: 1 },
    );
    assert.equal(result.captureOverflow?.captureName, "recording storage");
    assert.equal(result.captureOverflow?.limitBytes, 256);
    assert.equal(result.recordingCapture.partial, true);
    assert.ok(result.recordingCapture.bytes < result.recordingCapture.limitBytes);
    assert.equal(result.recordingCapture.storageLimitBytes, 256);
    assert.equal(result.signal === "SIGTERM" || result.signal === "SIGKILL", true);
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
});
