import { constants, closeSync, fstatSync, openSync, readSync } from "node:fs";
import { TextDecoder } from "node:util";
import { hashProjectInstructionResult } from "./benchmark-project-instruction-outer-authority.js";

export const MAX_PROJECT_INSTRUCTION_RESULT_BYTES = 64 * 1024 * 1024;

export class BenchmarkChildResultError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BenchmarkChildResultError";
    this.code = code;
  }
}

function invalid(code, message) {
  throw new BenchmarkChildResultError(code, message);
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonnegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validCaptureOverflow(value) {
  if (value === undefined) return true;
  if (
    !value ||
    typeof value !== "object" ||
    value.kind !== "capture_overflow" ||
    typeof value.captureName !== "string" ||
    value.captureName.length === 0 ||
    (value.turn !== undefined && !positiveSafeInteger(value.turn))
  ) {
    return false;
  }
  const validBytes =
    positiveSafeInteger(value.limitBytes) &&
    nonnegativeSafeInteger(value.observedBytesAtLeast) &&
    value.observedBytesAtLeast > value.limitBytes;
  const validCount =
    positiveSafeInteger(value.limitCount) &&
    nonnegativeSafeInteger(value.observedCountAtLeast) &&
    value.observedCountAtLeast > value.limitCount;
  return validBytes !== validCount;
}

function validRecordingCapture(recordingCapture, captureOverflow) {
  if (
    !recordingCapture ||
    typeof recordingCapture !== "object" ||
    recordingCapture.format !== "chunked-brotli-v1" ||
    !nonnegativeSafeInteger(recordingCapture.archiveBytes) ||
    !positiveSafeInteger(recordingCapture.archiveLimitBytes) ||
    recordingCapture.archiveBytes > recordingCapture.archiveLimitBytes ||
    !nonnegativeSafeInteger(recordingCapture.bytes) ||
    !positiveSafeInteger(recordingCapture.limitBytes) ||
    recordingCapture.bytes > recordingCapture.limitBytes ||
    typeof recordingCapture.partial !== "boolean" ||
    !nonnegativeSafeInteger(recordingCapture.storageBytes) ||
    !positiveSafeInteger(recordingCapture.storageLimitBytes) ||
    recordingCapture.storageBytes > recordingCapture.storageLimitBytes
  ) {
    return false;
  }
  const rawOverflow = captureOverflow?.captureName === "raw recording";
  const storageOverflow = captureOverflow?.captureName === "recording storage";
  const archiveOverflow = captureOverflow?.captureName === "recording archive";
  if (recordingCapture.partial) {
    if (rawOverflow) {
      return (
        recordingCapture.bytes === recordingCapture.limitBytes &&
        captureOverflow.limitBytes === recordingCapture.limitBytes
      );
    }
    if (storageOverflow) return captureOverflow.limitBytes === recordingCapture.storageLimitBytes;
    return archiveOverflow && captureOverflow.limitBytes === recordingCapture.archiveLimitBytes;
  }
  return !rawOverflow && !storageOverflow && !archiveOverflow;
}

function readBoundedResult(descriptor) {
  const chunks = [];
  let totalBytes = 0;
  while (totalBytes <= MAX_PROJECT_INSTRUCTION_RESULT_BYTES) {
    const remaining = MAX_PROJECT_INSTRUCTION_RESULT_BYTES + 1 - totalBytes;
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
    const bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    totalBytes += bytesRead;
  }
  if (totalBytes > MAX_PROJECT_INSTRUCTION_RESULT_BYTES) {
    invalid("oversized_results", "child benchmark results exceed the hard size ceiling");
  }
  return Buffer.concat(chunks, totalBytes);
}

function readCommittedResult(path, expectedSha256) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === "ENOENT") invalid("missing_results", "child benchmark results are missing");
    invalid("invalid_result_file", "child benchmark results must be a regular non-linked file");
  }
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1) {
      invalid("invalid_result_file", "child benchmark results must be a regular non-linked file");
    }
    if (before.size > MAX_PROJECT_INSTRUCTION_RESULT_BYTES) {
      invalid("oversized_results", "child benchmark results exceed the hard size ceiling");
    }
    const contents = readBoundedResult(descriptor);
    const after = fstatSync(descriptor);
    if (
      !after.isFile() ||
      after.nlink !== 1 ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size
    ) {
      invalid("invalid_result_file", "child benchmark results changed while being read");
    }
    const sha256 = hashProjectInstructionResult(contents);
    if (expectedSha256 !== undefined && sha256 !== expectedSha256) {
      invalid("invalid_result_commitment", "child benchmark results do not match the outer result commitment");
    }
    let decoded;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(contents);
    } catch {
      invalid("malformed_results", "child benchmark results are not valid UTF-8");
    }
    return { contents: decoded, sha256 };
  } finally {
    closeSync(descriptor);
  }
}

export function readBenchmarkChildResult(path, expectedSha256) {
  const committed = readCommittedResult(path, expectedSha256);
  let document;
  try {
    document = JSON.parse(committed.contents);
  } catch {
    invalid("malformed_results", "child benchmark results JSON is malformed");
  }
  if (!document || typeof document !== "object" || !Array.isArray(document.results) || document.results.length !== 1) {
    invalid("invalid_results", "child benchmark results document is invalid");
  }
  const [result] = document.results;
  if (!result || typeof result !== "object") {
    invalid("invalid_results", "child benchmark results document is invalid");
  }
  if (!validCaptureOverflow(result.captureOverflow) || !validRecordingCapture(result.recordingCapture, result.captureOverflow)) {
    invalid("invalid_capture_metadata", "child benchmark recording capture metadata is invalid");
  }
  return {
    document,
    result,
    recordingCapture: result.recordingCapture,
    captureOverflow: result.captureOverflow,
    resultSha256: committed.sha256,
  };
}
