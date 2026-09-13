export class BenchmarkProcessTerminationUnconfirmedError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "BenchmarkProcessTerminationUnconfirmedError";
  }
}

export function isBenchmarkProcessTerminationUnconfirmedError(error: unknown): boolean {
  if (error instanceof BenchmarkProcessTerminationUnconfirmedError) return true;
  if (error instanceof AggregateError) {
    return error.errors.some((nested) => isBenchmarkProcessTerminationUnconfirmedError(nested));
  }
  if (error instanceof Error && "cleanupErrors" in error) {
    const cleanupErrors = (error as Error & { cleanupErrors?: unknown[] }).cleanupErrors;
    if (cleanupErrors?.some((nested) => isBenchmarkProcessTerminationUnconfirmedError(nested))) return true;
  }
  return error instanceof Error && error.cause !== undefined
    ? isBenchmarkProcessTerminationUnconfirmedError(error.cause)
    : false;
}

export function benchmarkUnconfirmedTerminationError(
  error: unknown,
  terminationAttempted: boolean,
  treeStopped: boolean,
): BenchmarkProcessTerminationUnconfirmedError | undefined {
  if (!terminationAttempted || treeStopped) return undefined;
  if (error instanceof BenchmarkProcessTerminationUnconfirmedError) return error;
  const detail = error instanceof Error ? `: ${error.message}` : "";
  return new BenchmarkProcessTerminationUnconfirmedError(`benchmark process tree did not terminate${detail}`, error);
}
