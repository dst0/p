import type { ProjectInstructionCompilerDiagnostic, ProjectInstructionCompilerUsage } from "./types.ts";

export const PROJECT_INSTRUCTION_COMPILER_FAILURE_KINDS = [
  "envelope",
  "root-schema",
  "constraint-set",
  "grounding-semantic",
  "provider",
] as const;

export type ProjectInstructionCompilerFailureKind = (typeof PROJECT_INSTRUCTION_COMPILER_FAILURE_KINDS)[number];

export type ProjectInstructionCompilerFailureInvariant = "body-budget";

export interface ProjectInstructionCompilerAttemptDiagnostic {
  kind: ProjectInstructionCompilerFailureKind;
  invariant?: ProjectInstructionCompilerFailureInvariant;
  selectedCount?: number;
  materializedBodyChars?: number;
  hardLimitChars?: number;
  usage: ProjectInstructionCompilerUsage;
  elapsedMs: number;
}

export interface ProjectInstructionCompilerFailureTelemetry {
  attemptCount: number;
  failureKinds: ProjectInstructionCompilerFailureKind[];
  attemptDiagnostics?: ProjectInstructionCompilerAttemptDiagnostic[];
  usage: ProjectInstructionCompilerUsage;
  elapsedMs: number;
}

export interface ProjectInstructionCompilerFailureEvidence {
  error: string;
  diagnostic: ProjectInstructionCompilerDiagnostic;
  telemetry: ProjectInstructionCompilerFailureTelemetry;
}

export type ProjectInstructionCompilerOutputDiagnostic = Omit<
  ProjectInstructionCompilerAttemptDiagnostic,
  "kind" | "usage" | "elapsedMs"
>;

const outputFailures = new WeakMap<
  Error,
  {
    kind: ProjectInstructionCompilerFailureKind;
    diagnostic?: ProjectInstructionCompilerOutputDiagnostic;
  }
>();
const compilerFailures = new WeakMap<Error, ProjectInstructionCompilerFailureEvidence>();

export function createProjectInstructionCompilerOutputError(
  kind: ProjectInstructionCompilerFailureKind,
  diagnostic?: ProjectInstructionCompilerOutputDiagnostic,
): Error {
  const error = new Error(`Instruction compiler output failed ${kind} validation`);
  outputFailures.set(error, {
    kind,
    diagnostic: diagnostic ? cloneOutputDiagnostic(diagnostic) : undefined,
  });
  return error;
}

export function getProjectInstructionCompilerOutputFailureKind(
  error: unknown,
): ProjectInstructionCompilerFailureKind | undefined {
  return error instanceof Error ? outputFailures.get(error)?.kind : undefined;
}

export function getProjectInstructionCompilerOutputDiagnostic(
  error: unknown,
): ProjectInstructionCompilerOutputDiagnostic | undefined {
  if (!(error instanceof Error)) return undefined;
  const failure = outputFailures.get(error);
  return failure?.diagnostic ? cloneOutputDiagnostic(failure.diagnostic) : undefined;
}

export function createProjectInstructionCompilerFailure(
  telemetry: ProjectInstructionCompilerFailureTelemetry,
  providerContextFailure = false,
): Error {
  const message = providerContextFailure
    ? "Instruction compiler provider context window failed"
    : telemetry.failureKinds.includes("provider")
      ? "Instruction compiler provider call failed"
      : "Instruction compiler output validation failed";
  const error = new Error(message);
  compilerFailures.set(error, {
    error: `Error: ${message}`,
    diagnostic: providerContextFailure
      ? "project instruction compiler model context capacity was insufficient"
      : telemetry.failureKinds.includes("provider")
        ? "project instruction compiler provider call failed"
        : "project instruction compiler output validation failed",
    telemetry: cloneFailureTelemetry(telemetry),
  });
  return error;
}

export function getProjectInstructionCompilerFailureTelemetry(
  error: unknown,
): ProjectInstructionCompilerFailureTelemetry | undefined {
  if (!(error instanceof Error)) return undefined;
  const evidence = compilerFailures.get(error);
  return evidence ? cloneFailureTelemetry(evidence.telemetry) : undefined;
}

export function getProjectInstructionCompilerFailureEvidence(
  error: unknown,
): ProjectInstructionCompilerFailureEvidence | undefined {
  if (!(error instanceof Error)) return undefined;
  const evidence = compilerFailures.get(error);
  return evidence
    ? {
        error: evidence.error,
        diagnostic: evidence.diagnostic,
        telemetry: cloneFailureTelemetry(evidence.telemetry),
      }
    : undefined;
}

function cloneFailureTelemetry(
  telemetry: ProjectInstructionCompilerFailureTelemetry,
): ProjectInstructionCompilerFailureTelemetry {
  return {
    attemptCount: telemetry.attemptCount,
    failureKinds: [...telemetry.failureKinds],
    attemptDiagnostics: telemetry.attemptDiagnostics?.map(cloneAttemptDiagnostic),
    usage: { ...telemetry.usage },
    elapsedMs: telemetry.elapsedMs,
  };
}

function cloneAttemptDiagnostic(
  diagnostic: ProjectInstructionCompilerAttemptDiagnostic,
): ProjectInstructionCompilerAttemptDiagnostic {
  return {
    kind: diagnostic.kind,
    ...(diagnostic.invariant ? { invariant: diagnostic.invariant } : {}),
    ...(diagnostic.selectedCount === undefined ? {} : { selectedCount: diagnostic.selectedCount }),
    ...(diagnostic.materializedBodyChars === undefined
      ? {}
      : { materializedBodyChars: diagnostic.materializedBodyChars }),
    ...(diagnostic.hardLimitChars === undefined ? {} : { hardLimitChars: diagnostic.hardLimitChars }),
    usage: { ...diagnostic.usage },
    elapsedMs: diagnostic.elapsedMs,
  };
}

function cloneOutputDiagnostic(
  diagnostic: ProjectInstructionCompilerOutputDiagnostic,
): ProjectInstructionCompilerOutputDiagnostic {
  return {
    ...(diagnostic.invariant ? { invariant: diagnostic.invariant } : {}),
    ...(diagnostic.selectedCount === undefined ? {} : { selectedCount: diagnostic.selectedCount }),
    ...(diagnostic.materializedBodyChars === undefined
      ? {}
      : { materializedBodyChars: diagnostic.materializedBodyChars }),
    ...(diagnostic.hardLimitChars === undefined ? {} : { hardLimitChars: diagnostic.hardLimitChars }),
  };
}
