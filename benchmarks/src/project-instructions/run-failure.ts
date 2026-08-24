import { createBenchmarkGateFailure } from "./failure.ts";
import { createUnavailableCellLiveness } from "./run-liveness.ts";

const PROCESS_FAILURE_PATTERN = /child benchmark (?:exited|failed to start)|spawn/iu;
const CAPTURE_FAILURE_PATTERN = /capture overflow:/iu;
const STATUS_FAILURE_PATTERN = /^(?:run|sample) status /iu;
const CORRECTNESS_FAILURE_PATTERN = /quality gate failed/iu;
const PROVIDER_FAILURE_PATTERN =
  /(?:compiler|model identity|response model|provider|authentication|authorization|context capacity|quota|rate limit)/iu;

type LivenessError = Error & { pairedBenchmarkLiveness?: unknown };

type ClassifiedFailureOptions = {
  compilerCertification?: boolean;
  kind?: string;
  liveness?: unknown;
};

export function classifyPairedBenchmarkFailure(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  if (PROCESS_FAILURE_PATTERN.test(reason)) return "process";
  if (CAPTURE_FAILURE_PATTERN.test(reason)) return "infrastructure";
  if (STATUS_FAILURE_PATTERN.test(reason)) return "status";
  if (CORRECTNESS_FAILURE_PATTERN.test(reason)) return "correctness";
  if (PROVIDER_FAILURE_PATTERN.test(reason)) return "provider";
  return "infrastructure";
}

export function attachPairedBenchmarkLiveness(error: unknown, liveness: unknown): LivenessError {
  const failure = error instanceof Error ? error : new Error(String(error));
  Object.defineProperty(failure, "pairedBenchmarkLiveness", {
    configurable: true,
    value: liveness,
  });
  return failure as LivenessError;
}

export function createClassifiedBenchmarkGateFailure(
  pair: { run: number; task: string },
  mode: string,
  error: unknown,
  options: ClassifiedFailureOptions = {},
) {
  const liveness =
    options.liveness ??
    (error instanceof Error ? (error as LivenessError).pairedBenchmarkLiveness : undefined) ??
    createUnavailableCellLiveness();
  return {
    ...createBenchmarkGateFailure(pair, mode, error, options),
    kind: options.kind ?? classifyPairedBenchmarkFailure(error),
    liveness,
  };
}
