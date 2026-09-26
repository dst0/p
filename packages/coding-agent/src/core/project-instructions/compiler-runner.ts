import {
  getProjectInstructionCompilerFailureEvidence,
  type ProjectInstructionCompilerFailureTelemetry,
} from "./compiler-attempt-diagnostics.ts";
import {
  classifyProjectInstructionCompilerError,
  renderProjectInstructionCompilerDiagnosticError,
} from "./compiler-diagnostics.ts";
import { validateProjectInstructionCompilerResult } from "./compiler-validation.ts";
import type {
  ProjectInstructionCompiler,
  ProjectInstructionCompilerDiagnostic,
  ProjectInstructionCompilerRequest,
  ProjectInstructionCompilerResult,
  ProjectInstructionCompilerStatus,
} from "./types.ts";

export interface ProjectInstructionCompilationAttempt {
  status: ProjectInstructionCompilerStatus;
  result?: ProjectInstructionCompilerResult;
  error?: string;
  diagnostic?: ProjectInstructionCompilerDiagnostic;
  compilerFailure?: ProjectInstructionCompilerFailureTelemetry;
}

export interface RunProjectInstructionCompilerOptions {
  signal?: AbortSignal;
  deadlineSeconds?: number;
}

export const MAX_PROJECT_INSTRUCTION_STARTUP_DEADLINE_SECONDS = 2_147_483;

export function assertValidProjectInstructionStartupDeadline(seconds: number | undefined): void {
  if (seconds === undefined) return;
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_PROJECT_INSTRUCTION_STARTUP_DEADLINE_SECONDS) {
    throw new RangeError(
      `Project instruction startup deadline must be between 0 and ${MAX_PROJECT_INSTRUCTION_STARTUP_DEADLINE_SECONDS} seconds`,
    );
  }
}

export async function runProjectInstructionCompiler(
  compiler: ProjectInstructionCompiler | undefined,
  request: ProjectInstructionCompilerRequest,
  options?: RunProjectInstructionCompilerOptions,
): Promise<ProjectInstructionCompilationAttempt> {
  assertValidProjectInstructionStartupDeadline(options?.deadlineSeconds);
  if (!compiler || request.sources.length === 0) return { status: "unavailable" };
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let abortController: AbortController | undefined;
  let parentAbortHandler: (() => void) | undefined;
  let effectiveAbortHandler: (() => void) | undefined;
  let effectiveSignal = options?.signal;

  if (options?.deadlineSeconds && options.deadlineSeconds > 0) {
    abortController = new AbortController();
    if (options.signal) {
      if (options.signal.aborted) {
        abortController.abort(options.signal.reason);
      } else {
        parentAbortHandler = () => abortController?.abort(options.signal?.reason);
        options.signal.addEventListener("abort", parentAbortHandler, { once: true });
      }
    }
    const deadlineMs = Math.max(1, Math.round(options.deadlineSeconds * 1000));
    deadlineTimer = setTimeout(() => {
      abortController?.abort(
        new Error(`Project instruction compilation timed out after startup deadline of ${options.deadlineSeconds}s`),
      );
    }, deadlineMs);
    effectiveSignal = abortController.signal;
  }

  try {
    if (effectiveSignal?.aborted) {
      throw effectiveSignal.reason ?? new Error("Project instruction compilation aborted");
    }
    const candidatePromise = compiler(request, { signal: effectiveSignal });
    const candidate = effectiveSignal
      ? await Promise.race([
          candidatePromise,
          new Promise<never>((_, reject) => {
            if (effectiveSignal.aborted) {
              reject(effectiveSignal.reason ?? new Error("Operation aborted"));
              return;
            }
            effectiveAbortHandler = () => reject(effectiveSignal.reason ?? new Error("Operation aborted"));
            effectiveSignal.addEventListener("abort", effectiveAbortHandler, { once: true });
          }),
        ])
      : await candidatePromise;
    return {
      status: "success",
      result: validateProjectInstructionCompilerResult(candidate, request.modules, request.constraints),
    };
  } catch (error) {
    const evidence = getProjectInstructionCompilerFailureEvidence(error);
    const diagnostic = evidence?.diagnostic ?? classifyProjectInstructionCompilerError(error);
    return {
      status: "failed",
      error: evidence?.error ?? renderProjectInstructionCompilerDiagnosticError(diagnostic),
      diagnostic,
      ...(evidence ? { compilerFailure: evidence.telemetry } : {}),
    };
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (parentAbortHandler) options?.signal?.removeEventListener("abort", parentAbortHandler);
    if (effectiveAbortHandler) effectiveSignal?.removeEventListener("abort", effectiveAbortHandler);
  }
}
