import { getBenchmarkProjectInstructionSeedFailure } from "./benchmark-project-instruction-seed-runner.js";
import { escapeMarkdownText } from "./benchmark-markdown.js";

export function createBenchmarkGateFailure(pair, mode, error, options = {}) {
  const seedFailure = getBenchmarkProjectInstructionSeedFailure(error);
  const certificationReason = seedFailure?.diagnostic ?? "project instruction compiler certification failed";
  return {
    run: pair.run,
    task: pair.task,
    mode,
    reason: options.compilerCertification === true ? certificationReason : error instanceof Error ? error.message : String(error),
    ...(seedFailure?.compilerFailure ? { compilerFailure: seedFailure.compilerFailure } : {}),
  };
}

export function renderBenchmarkCompilerFailureTelemetry(failure) {
  if (!failure) return "";
  const tokens = Math.round(failure.usage.total).toLocaleString("en-US");
  const elapsed = Math.round(failure.elapsedMs).toLocaleString("en-US");
  return `Compiler telemetry: ${failure.attemptCount} attempts; ${escapeMarkdownText(failure.failureKinds.join(", "))}; ${tokens} tokens; ${elapsed} ms.\n\n`;
}
