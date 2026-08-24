import { join } from "node:path";
import type { BenchmarkAuthOutputGuard } from "../harness/auth-output-guard.ts";
import {
  attachBenchmarkCleanupError,
  benchmarkInterruptionFromSignal,
  isBenchmarkInterruptedError,
} from "../harness/interruption.ts";
import type { BenchmarkAgentDirectories } from "./private-directories.ts";

export async function abortBenchmarkRecording(
  recording: { abort(): Promise<void> },
  primaryError: unknown,
): Promise<never> {
  try {
    await recording.abort();
  } catch (cleanupError) {
    if (isBenchmarkInterruptedError(primaryError)) {
      throw attachBenchmarkCleanupError(primaryError, cleanupError);
    }
    throw cleanupError;
  }
  throw primaryError;
}

export function finalizeBenchmarkAgentResources(
  agentDirs: BenchmarkAgentDirectories | undefined,
  authOutputGuard: BenchmarkAuthOutputGuard,
  output: string,
  signal: AbortSignal | undefined,
): void {
  const cleanupErrors: unknown[] = [];
  if (agentDirs) {
    for (const agent of ["pi", "p"]) {
      attempt(() => authOutputGuard.capture(join(agentDirs.dirs[agent], "auth.json")), cleanupErrors);
    }
    attempt(() => agentDirs.dispose(), cleanupErrors);
  }
  attempt(() => authOutputGuard.sanitizeTree(output), cleanupErrors);
  if (cleanupErrors.length === 0) return;
  const interruption = benchmarkInterruptionFromSignal(signal);
  if (interruption) {
    for (const error of cleanupErrors) attachBenchmarkCleanupError(interruption, error);
    throw interruption;
  }
  throw new AggregateError(cleanupErrors, "Benchmark agent resource cleanup failed");
}

function attempt(action: () => void, errors: unknown[]): void {
  try {
    action();
  } catch (error) {
    errors.push(error);
  }
}
