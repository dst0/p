import { existsSync, readFileSync } from "node:fs";

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

export function readBenchmarkChildResult(path) {
  if (!existsSync(path)) invalid("missing_results", "child benchmark results are missing");
  let document;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
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
  };
}
