import {
  BenchmarkProcessTerminationUnconfirmedError,
  isBenchmarkProcessTerminationUnconfirmedError,
} from "../harness/process-termination-error.ts";

export interface AgentBenchmarkFinalization {
  primaryError?: unknown;
  mutableArtifactsSafe: boolean;
  finalizeAgentResources(): void;
  sanitizeReceipt(mutableArtifactsSafe: boolean): void;
  validateReleaseEvidence?(): void;
  disposeFreeze(): void;
  publishReleaseEvidence?(): void;
}

export class BenchmarkMutableArtifactsUnsafeError extends BenchmarkProcessTerminationUnconfirmedError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "BenchmarkMutableArtifactsUnsafeError";
  }
}

export function isBenchmarkMutableArtifactsUnsafeError(error: unknown): boolean {
  return isBenchmarkProcessTerminationUnconfirmedError(error);
}

export function finalizeAgentBenchmarkRun(finalization: AgentBenchmarkFinalization): void {
  const cleanupErrors: unknown[] = [];
  if (finalization.mutableArtifactsSafe) {
    attempt(finalization.finalizeAgentResources, cleanupErrors);
  } else {
    cleanupErrors.push(new Error("Mutable artifact cleanup skipped because process-tree termination was unconfirmed"));
  }
  if (!finalization.primaryError && cleanupErrors.length === 0 && finalization.validateReleaseEvidence) {
    attempt(finalization.validateReleaseEvidence, cleanupErrors);
  }
  attempt(() => finalization.sanitizeReceipt(finalization.mutableArtifactsSafe), cleanupErrors);
  attempt(finalization.disposeFreeze, cleanupErrors);
  if (cleanupErrors.length === 0) {
    if (!finalization.primaryError) finalization.publishReleaseEvidence?.();
    return;
  }
  const errors = finalization.primaryError ? [finalization.primaryError, ...cleanupErrors] : cleanupErrors;
  throw new AggregateError(errors, "Agent benchmark failed with cleanup errors");
}

function attempt(action: () => void, errors: unknown[]): void {
  try {
    action();
  } catch (error) {
    appendError(error, errors);
  }
}

function appendError(error: unknown, errors: unknown[]): void {
  if (error instanceof AggregateError) {
    for (const nested of error.errors) appendError(nested, errors);
  } else {
    errors.push(error);
  }
}
