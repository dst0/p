import { join } from "node:path";

import {
  attachBenchmarkCleanupError,
  benchmarkInterruptionFromSignal,
  isBenchmarkInterruptedError,
} from "./benchmark-interruption.js";

export async function abortBenchmarkRecording(recording, primaryError) {
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

export function finalizeBenchmarkAgentResources(agentDirs, authOutputGuard, output, signal) {
  const cleanupErrors = [];
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

function attempt(action, errors) {
  try {
    action();
  } catch (error) {
    errors.push(error);
  }
}
