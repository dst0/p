import { BenchmarkCollectionOverflowError } from "./benchmark-collection-overflow-error.js";
import { BenchmarkOutputOverflowError } from "./benchmark-output-overflow-error.js";

export { BenchmarkCollectionOverflowError } from "./benchmark-collection-overflow-error.js";
export { BenchmarkOutputOverflowError } from "./benchmark-output-overflow-error.js";

export const DEFAULT_BENCHMARK_OUTPUT_LIMITS = Object.freeze({
  maxActiveRecordingChunkBytes: 32 * 1024 * 1024,
  maxRecordingArchiveBytes: 256 * 1024 * 1024,
  maxCombinedStderrBytes: 8 * 1024 * 1024,
  maxCombinedStdoutBytes: 32 * 1024 * 1024,
  maxLineBytes: 1024 * 1024,
  maxMetricBytes: 16 * 1024 * 1024,
  maxMetricEvents: 65_536,
  maxRawRecordingBytes: 8 * 1024 * 1024 * 1024,
  maxRawStdoutBytes: 8 * 1024 * 1024,
  maxRecordingStorageBytes: 256 * 1024 * 1024,
  maxRuntimeContexts: 256,
  maxStderrBytes: 4 * 1024 * 1024,
});

export function resolveBenchmarkOutputLimits(overrides = {}) {
  const limits = { ...DEFAULT_BENCHMARK_OUTPUT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive safe integer`);
    }
  }
  return limits;
}

export function createBoundedTextCapture(captureName, limitBytes) {
  const blocks = [];
  let pending = [];
  let pendingBytes = 0;
  let byteLength = 0;
  return {
    append(value) {
      if (!value) return;
      const nextBytes = Buffer.byteLength(value, "utf8");
      if (byteLength + nextBytes > limitBytes) {
        throw new BenchmarkOutputOverflowError(captureName, limitBytes, byteLength + nextBytes);
      }
      pending.push(value);
      pendingBytes += nextBytes;
      if (pendingBytes >= 64 * 1024) {
        blocks.push(pending.join(""));
        pending = [];
        pendingBytes = 0;
      }
      byteLength += nextBytes;
    },
    get byteLength() {
      return byteLength;
    },
    value() {
      return [...blocks, pending.join("")].join("");
    },
  };
}

export function captureOverflowEvidence(error, turn) {
  if (
    !(error instanceof BenchmarkOutputOverflowError)
    && !(error instanceof BenchmarkCollectionOverflowError)
  ) return undefined;
  return {
    kind: "capture_overflow",
    captureName: error.captureName,
    ...(error instanceof BenchmarkOutputOverflowError
      ? { limitBytes: error.limitBytes, observedBytesAtLeast: error.observedBytesAtLeast }
      : { limitCount: error.limitCount, observedCountAtLeast: error.observedCountAtLeast }),
    ...(turn === undefined ? {} : { turn }),
  };
}

export function createBenchmarkTurnAggregate(overrides = {}) {
  const limits = resolveBenchmarkOutputLimits(overrides);
  const stdout = createBoundedTextCapture("combined metric output", limits.maxCombinedStdoutBytes);
  const stderr = createBoundedTextCapture("combined stderr", limits.maxCombinedStderrBytes);
  const runtimeContexts = [];
  const userTurns = [];
  let metricEventCount = 0;
  return {
    append(turn) {
      stdout.append(turn.stdout);
      if (turn.stderr) {
        if (stderr.byteLength > 0) stderr.append("\n--- TURN SEPARATOR ---\n");
        stderr.append(turn.stderr);
      }
      if (runtimeContexts.length + turn.runtimeContexts.length > limits.maxRuntimeContexts) {
        throw new BenchmarkCollectionOverflowError(
          "combined runtime contexts",
          limits.maxRuntimeContexts,
          runtimeContexts.length + turn.runtimeContexts.length,
        );
      }
      const nextMetricEventCount = metricEventCount + (turn.metricEventCount ?? 0);
      if (nextMetricEventCount > limits.maxMetricEvents) {
        throw new BenchmarkCollectionOverflowError(
          "combined metric events",
          limits.maxMetricEvents,
          nextMetricEventCount,
        );
      }
      metricEventCount = nextMetricEventCount;
      runtimeContexts.push(...turn.runtimeContexts);
      userTurns.push(...turn.userTurns);
    },
    runtimeContexts,
    stderr,
    stdout,
    userTurns,
  };
}
