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

export async function runProjectInstructionCompiler(
  compiler: ProjectInstructionCompiler | undefined,
  request: ProjectInstructionCompilerRequest,
): Promise<ProjectInstructionCompilationAttempt> {
  if (!compiler || request.sources.length === 0) return { status: "unavailable" };
  try {
    const candidate = await compiler(request);
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
  }
}
