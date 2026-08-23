import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { benchmarkRecordingOptions } from "./benchmark-recording-options.js";
import { benchmarkRunnerRecordingFactory } from "./benchmark-runner-recording-factory.js";

test("runner recording options preserve every independently configured limit", () => {
  assert.deepEqual(
    benchmarkRecordingOptions({
      outputLimits: {
        maxActiveRecordingChunkBytes: 11,
        maxRawRecordingBytes: 22,
        maxRecordingArchiveBytes: 33,
        maxRecordingStorageBytes: 44,
      },
    }),
    {
      maxActiveChunkBytes: 11,
      maxArchiveBytes: 33,
      maxBytes: 22,
      maxStoredBytes: 44,
    },
  );
});

test("runner recording options enforce the configured physical storage limit", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-runner-storage-limit-"));
  try {
    const recording = benchmarkRunnerRecordingFactory.command(
      join(root, "recording.jsonl.br"),
      {
        outputLimits: {
          maxActiveRecordingChunkBytes: 4,
          maxRawRecordingBytes: 4_096,
          maxRecordingArchiveBytes: 4_096,
          maxRecordingStorageBytes: 8,
        },
      },
    );
    let failure;
    recording.onFailure((error) => {
      failure = error;
    });
    recording.stream.write(Buffer.from("0123456789abcdef"));

    await recording.finalize();

    assert.equal(failure?.captureName, "recording storage");
    assert.equal(failure?.limitBytes, 8);
    assert.equal(recording.capture.partial, true);
    assert.equal(recording.capture.storageLimitBytes, 8);
    assert.ok(recording.capture.bytes < 16);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("runner recording options enforce the configured retained archive limit", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-runner-archive-limit-"));
  try {
    const recording = benchmarkRunnerRecordingFactory.task(
      join(root, "recording.jsonl.br"),
      {
        outputLimits: {
          maxActiveRecordingChunkBytes: 1_024,
          maxRawRecordingBytes: 4_096,
          maxRecordingArchiveBytes: 64,
          maxRecordingStorageBytes: 4_096,
        },
      },
    );
    recording.stream.write(Buffer.from("retained benchmark evidence\n"));

    await assert.rejects(
      recording.finalize(),
      (error) => error.captureName === "recording archive" && error.limitBytes === 64,
    );
    assert.equal(recording.capture.archiveLimitBytes, 64);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
