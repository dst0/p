import { escapeMarkdownText } from "../harness/markdown.ts";
import { getBenchmarkProjectInstructionSeedFailure } from "./seed-runner.ts";

type BenchmarkPair = { run: number; task: string };

type BenchmarkGateFailureOptions = { compilerCertification?: boolean };

type CompilerFailureTelemetry = {
  attemptCount: number;
  elapsedMs: number;
  failureKinds: string[];
  usage: { total: number };
};

export function createBenchmarkGateFailure(
  pair: BenchmarkPair,
  mode: string,
  error: unknown,
  options: BenchmarkGateFailureOptions = {},
) {
  const seedFailure = getBenchmarkProjectInstructionSeedFailure(error);
  const certificationReason = seedFailure?.diagnostic ?? "project instruction compiler certification failed";
  return {
    run: pair.run,
    task: pair.task,
    mode,
    reason:
      options.compilerCertification === true
        ? certificationReason
        : error instanceof Error
          ? error.message
          : String(error),
    ...(seedFailure?.compilerFailure ? { compilerFailure: seedFailure.compilerFailure } : {}),
  };
}

export function renderBenchmarkCompilerFailureTelemetry(failure: CompilerFailureTelemetry | undefined): string {
  if (!failure) return "";
  const tokens = Math.round(failure.usage.total).toLocaleString("en-US");
  const elapsed = Math.round(failure.elapsedMs).toLocaleString("en-US");
  return `Compiler telemetry: ${failure.attemptCount} attempts; ${escapeMarkdownText(failure.failureKinds.join(", "))}; ${tokens} tokens; ${elapsed} ms.\n\n`;
}
