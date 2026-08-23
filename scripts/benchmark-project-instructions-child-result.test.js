import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  BenchmarkChildResultError,
  readBenchmarkChildResult,
} from "./benchmark-project-instructions-child-result.js";

function readFixture(result) {
  const directory = mkdtempSync(join(tmpdir(), "p-child-result-capture-"));
  const path = join(directory, "results.json");
  writeFileSync(path, `${JSON.stringify({ results: [result] })}\n`);
  try {
    return readBenchmarkChildResult(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function recordingCapture(overrides = {}) {
  return {
    format: "chunked-brotli-v1",
    bytes: 12,
    limitBytes: 64,
    partial: false,
    storageBytes: 10,
    storageLimitBytes: 32,
    archiveBytes: 20,
    archiveLimitBytes: 64,
    ...overrides,
  };
}

test("strict child-result parsing accepts complete full and bounded-partial recording metadata", () => {
  const full = { recordingCapture: recordingCapture() };
  assert.deepEqual(readFixture(full).recordingCapture, full.recordingCapture);
  const partial = {
    recordingCapture: recordingCapture({ bytes: 64, partial: true }),
    captureOverflow: {
      kind: "capture_overflow",
      captureName: "raw recording",
      limitBytes: 64,
      observedBytesAtLeast: 65,
      turn: 1,
    },
  };
  assert.deepEqual(readFixture(partial).captureOverflow, partial.captureOverflow);
});

test("strict child-result parsing accepts storage-bounded partial recording metadata", () => {
  const partial = {
    recordingCapture: {
      format: "chunked-brotli-v1",
      bytes: 192,
      limitBytes: 8_192,
      partial: true,
      storageBytes: 180,
      storageLimitBytes: 256,
      archiveBytes: 96,
      archiveLimitBytes: 128,
    },
    captureOverflow: {
      kind: "capture_overflow",
      captureName: "recording storage",
      limitBytes: 256,
      observedBytesAtLeast: 257,
      turn: 1,
    },
  };
  assert.deepEqual(readFixture(partial).recordingCapture, partial.recordingCapture);
});

test("strict child-result parsing rejects inconsistent overflow evidence", () => {
  assert.throws(
    () =>
      readFixture({
        recordingCapture: recordingCapture(),
        captureOverflow: {
          kind: "capture_overflow",
          captureName: "raw recording",
          limitBytes: 64,
          observedBytesAtLeast: 65,
        },
      }),
    (error) => error instanceof BenchmarkChildResultError && error.code === "invalid_capture_metadata",
  );
});

test("strict child-result parsing requires bounded final-archive metadata", () => {
  const capture = recordingCapture();
  delete capture.archiveBytes;
  delete capture.archiveLimitBytes;
  assert.throws(
    () => readFixture({ recordingCapture: capture }),
    (error) => error instanceof BenchmarkChildResultError && error.code === "invalid_capture_metadata",
  );
});
