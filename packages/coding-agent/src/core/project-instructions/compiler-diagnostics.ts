import type { ProjectInstructionCompilerDiagnostic } from "./types.ts";

export function sanitizeProjectInstructionCompilerError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown compiler error";
  return message
    .replace(/https?:\/\/\S+/gu, "[url]")
    .replace(/[A-Za-z0-9_=-]{32,}/gu, "[redacted]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500);
}

export function classifyProjectInstructionCompilerError(error: unknown): ProjectInstructionCompilerDiagnostic {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/context (?:length|window)|maximum context|too many tokens|token limit/iu.test(message)) {
    return "project instruction compiler model context capacity was insufficient";
  }
  if (/does not support thinking off/iu.test(message)) {
    return "project instruction compiler model does not support thinking off";
  }
  if (/lacks explicit thinking-disable compatibility/iu.test(message)) {
    return "project instruction compiler model lacks explicit thinking-disable compatibility";
  }
  if (/compiler source (?:size )?limit/iu.test(message)) {
    return "project instruction compiler source size limit was exceeded";
  }
  if (/provider|stopped with (?:aborted|error)/iu.test(message)) {
    return "project instruction compiler provider call failed";
  }
  if (/body|classif|contract|JSON|source text|trigger|output validation/iu.test(message)) {
    return "project instruction compiler output validation failed";
  }
  return "project instruction compiler failed";
}

export function renderProjectInstructionCompilerDiagnosticError(
  diagnostic: ProjectInstructionCompilerDiagnostic,
): string {
  const detail = diagnostic.replace(/^project instruction compiler /u, "Instruction compiler ");
  return `Error: ${detail}`;
}
