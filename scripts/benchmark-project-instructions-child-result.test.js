import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  BenchmarkChildResultError,
  readBenchmarkChildResult,
} from "./benchmark-project-instructions-child-result.js";
import { hashProjectInstructionResult } from "./benchmark-project-instruction-outer-authority.js";

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

test("child-result parsing rejects symlinks and bytes outside the outer commitment", () => {
  const root = mkdtempSync(join(tmpdir(), "p-child-result-authority-"));
  try {
    const target = join(root, "target.json");
    const path = join(root, "results.json");
    const contents = `${JSON.stringify({ results: [{ recordingCapture: recordingCapture() }] })}\n`;
    writeFileSync(target, contents);
    symlinkSync(target, path);
    assert.throws(
      () => readBenchmarkChildResult(path, hashProjectInstructionResult(contents)),
      (error) => error instanceof BenchmarkChildResultError && error.code === "invalid_result_file",
    );
    rmSync(path);
    writeFileSync(path, contents);
    assert.throws(
      () => readBenchmarkChildResult(path, "f".repeat(64)),
      (error) => error instanceof BenchmarkChildResultError && error.code === "invalid_result_commitment",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("child-result parsing rejects oversized result bytes before reading", () => {
  const root = mkdtempSync(join(tmpdir(), "p-child-result-oversized-"));
  try {
    const path = join(root, "results.json");
    writeFileSync(path, "x".repeat(64 * 1024 * 1024 + 1));
    assert.throws(
      () => readBenchmarkChildResult(path),
      (error) => error instanceof BenchmarkChildResultError && error.code === "oversized_results",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("child-result commitment hashes exact bytes and rejects invalid UTF-8", () => {
  const root = mkdtempSync(join(tmpdir(), "p-child-result-utf8-"));
  try {
    const path = join(root, "results.json");
    const published = `${JSON.stringify({
      results: [{ note: "�", recordingCapture: recordingCapture() }],
    })}\n`;
    const bytes = Buffer.from(published);
    const replacement = Buffer.from("�");
    const offset = bytes.indexOf(replacement);
    assert.ok(offset >= 0);
    const invalidBytes = Buffer.concat([
      bytes.subarray(0, offset),
      Buffer.from([0xff]),
      bytes.subarray(offset + replacement.length),
    ]);
    writeFileSync(path, invalidBytes);
    assert.throws(
      () => readBenchmarkChildResult(path, hashProjectInstructionResult(published)),
      (error) => error instanceof BenchmarkChildResultError && error.code === "invalid_result_commitment",
    );
    assert.throws(
      () => readBenchmarkChildResult(path, hashProjectInstructionResult(invalidBytes)),
      (error) => error instanceof BenchmarkChildResultError && error.code === "malformed_results",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
