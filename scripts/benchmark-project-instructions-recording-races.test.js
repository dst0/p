import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliCompressSync } from "node:zlib";

import { createSemanticRecordingFollower } from "./benchmark-project-instructions-recording-follower.js";

function event(id) {
  return Buffer.from(`${JSON.stringify({ type: "tool_execution_start", toolCallId: id })}\n`);
}

function createFollower(root, chunkDirectory, processed, hooks) {
  return createSemanticRecordingFollower({
    chunkDirectory,
    finalRecordingPath: join(root, "recording.jsonl.br"),
    processLine: (line) => processed.push(JSON.parse(line).toolCallId),
    resetSemanticState: () => processed.splice(0),
    testHooks: hooks,
  });
}

test("rotation published after active open is consumed exactly once before the replacement active file", () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-open-rotation-race-"));
  const chunkDirectory = join(root, "recording.jsonl.chunks");
  const activePath = join(chunkDirectory, "active.jsonl.active");
  mkdirSync(chunkDirectory, { mode: 0o700 });
  const first = event("first");
  const second = event("second");
  writeFileSync(activePath, first, { mode: 0o600 });
  const processed = [];
  let barrierCrossed = false;
  const follower = createFollower(root, chunkDirectory, processed, {
    afterActiveOpen() {
      if (barrierCrossed) return;
      barrierCrossed = true;
      const rawPath = join(chunkDirectory, "chunk-000000000000.jsonl.raw");
      renameSync(activePath, rawPath);
      writeFileSync(
        join(chunkDirectory, "chunk-000000000000.jsonl.br"),
        brotliCompressSync(readFileSync(rawPath)),
        { mode: 0o600 },
      );
      rmSync(rawPath);
      writeFileSync(activePath, second, { mode: 0o600 });
    },
  });
  try {
    assert.deepEqual(follower.observe(), { available: true, valid: true });
    assert.equal(barrierCrossed, true);
    assert.deepEqual(processed, ["first", "second"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an absent active pathname during rotation preserves the observed prefix exactly once", () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-absent-active-race-"));
  const chunkDirectory = join(root, "recording.jsonl.chunks");
  const activePath = join(chunkDirectory, "active.jsonl.active");
  const rawPath = join(chunkDirectory, "chunk-000000000000.jsonl.raw");
  mkdirSync(chunkDirectory, { mode: 0o700 });
  const first = event("first");
  const second = event("second");
  const third = event("third");
  const split = Math.floor(second.length / 2);
  const firstGeneration = Buffer.concat([first, second.subarray(0, split)]);
  writeFileSync(activePath, firstGeneration, { mode: 0o600 });
  const processed = [];
  const follower = createFollower(root, chunkDirectory, processed);
  try {
    assert.deepEqual(follower.observe(), { available: true, valid: true });
    assert.deepEqual(processed, ["first"]);

    renameSync(activePath, rawPath);
    assert.deepEqual(follower.observe(), { available: true, valid: true });
    assert.deepEqual(processed, ["first"]);

    writeFileSync(
      join(chunkDirectory, "chunk-000000000000.jsonl.br"),
      brotliCompressSync(readFileSync(rawPath)),
      { mode: 0o600 },
    );
    rmSync(rawPath);
    writeFileSync(activePath, Buffer.concat([second.subarray(split), third]), { mode: 0o600 });
    assert.deepEqual(follower.observe(), { available: true, valid: true });
    assert.deepEqual(processed, ["first", "second", "third"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
