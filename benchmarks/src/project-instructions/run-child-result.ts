import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { TextDecoder } from "node:util";
import { hashProjectInstructionResult } from "./outer-authority.ts";

export const MAX_PROJECT_INSTRUCTION_RESULT_BYTES = 64 * 1024 * 1024;

export class BenchmarkChildResultError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BenchmarkChildResultError";
    this.code = code;
  }
}

type CaptureOverflow = {
  kind: "capture_overflow";
  captureName: string;
  turn?: number;
  limitBytes?: number;
  observedBytesAtLeast?: number;
  limitCount?: number;
  observedCountAtLeast?: number;
};

type RecordingCapture = {
  format: "chunked-brotli-v1";
  archiveBytes: number;
  archiveLimitBytes: number;
  bytes: number;
  limitBytes: number;
  partial: boolean;
  storageBytes: number;
  storageLimitBytes: number;
};

type BenchmarkResult = Record<string, unknown> & {
  captureOverflow?: CaptureOverflow;
  recordingCapture?: RecordingCapture;
};

type BenchmarkResultDocument = Record<string, unknown> & { results: BenchmarkResult[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(code: string, message: string): never {
  throw new BenchmarkChildResultError(code, message);
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validCaptureOverflow(value: unknown): value is CaptureOverflow | undefined {
  if (value === undefined) return true;
  if (
    !isRecord(value) ||
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

function validRecordingCapture(
  recordingCapture: unknown,
  captureOverflow: CaptureOverflow | undefined,
): recordingCapture is RecordingCapture {
  if (
    !isRecord(recordingCapture) ||
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

function readBoundedResult(descriptor: number): Buffer {
  const chunks: Buffer[] = [];
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

function readCommittedResult(path: string, expectedSha256?: string): { contents: string; sha256: string } {
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") invalid("missing_results", "child benchmark results are missing");
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
    let decoded: string;
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

export function readBenchmarkChildResult(path: string, expectedSha256?: string) {
  const committed = readCommittedResult(path, expectedSha256);
  let document: unknown;
  try {
    document = JSON.parse(committed.contents);
  } catch {
    invalid("malformed_results", "child benchmark results JSON is malformed");
  }
  if (!isRecord(document) || !Array.isArray(document.results) || document.results.length !== 1) {
    invalid("invalid_results", "child benchmark results document is invalid");
  }
  const [result] = document.results;
  if (!isRecord(result)) {
    invalid("invalid_results", "child benchmark results document is invalid");
  }
  if (
    !validCaptureOverflow(result.captureOverflow) ||
    !validRecordingCapture(result.recordingCapture, result.captureOverflow)
  ) {
    invalid("invalid_capture_metadata", "child benchmark recording capture metadata is invalid");
  }
  return {
    document: document as BenchmarkResultDocument,
    result: result as BenchmarkResult,
    recordingCapture: result.recordingCapture,
    captureOverflow: result.captureOverflow,
    resultSha256: committed.sha256,
  };
}
