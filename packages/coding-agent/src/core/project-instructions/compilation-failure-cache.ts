import { randomUUID } from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import {
  assertCacheDirectorySafe,
  assertNotSymlink,
  ensurePrivateDirectory,
  readRegularFile,
  writePrivateFile,
} from "./cache-safety.ts";
import {
  type CompilationCacheOptions,
  getCompilationFailurePath,
  getCompilerIdentity,
} from "./compilation-cache-paths.ts";
import {
  PROJECT_INSTRUCTION_COMPILER_FAILURE_KINDS,
  type ProjectInstructionCompilerAttemptDiagnostic,
  type ProjectInstructionCompilerFailureKind,
  type ProjectInstructionCompilerFailureTelemetry,
} from "./compiler-attempt-diagnostics.ts";
import { hashText } from "./content.ts";
import type { ProjectInstructionCompilerUsage } from "./types.ts";

interface CompilationFailureRecord {
  schemaVersion: 2;
  agentsHash: string;
  compilerVersion: string;
  compilerIdentity: string;
  failedAtMs: number;
  error: string;
  compilerFailure?: ProjectInstructionCompilerFailureTelemetry;
  resultHash: string;
}

export interface CachedCompilationFailure {
  failedAtMs: number;
  error: string;
  compilerFailure?: ProjectInstructionCompilerFailureTelemetry;
}

export function loadCachedCompilationFailure(options: CompilationCacheOptions): CachedCompilationFailure | undefined {
  try {
    assertCacheDirectorySafe(options.cacheDir, options.workspaceRoot, false);
    const record = parseFailureRecord(JSON.parse(readRegularFile(getCompilationFailurePath(options))) as unknown);
    if (
      !record ||
      record.agentsHash !== options.agentsHash ||
      record.compilerVersion !== options.compilerVersion ||
      record.compilerIdentity !== getCompilerIdentity(options) ||
      record.resultHash !== computeFailureHash(record)
    ) {
      return undefined;
    }
    return {
      failedAtMs: record.failedAtMs,
      error: record.error,
      ...(record.compilerFailure ? { compilerFailure: record.compilerFailure } : {}),
    };
  } catch {
    return undefined;
  }
}

export function persistCompilationFailure(options: CompilationCacheOptions, failure: CachedCompilationFailure): void {
  assertCacheDirectorySafe(options.cacheDir, options.workspaceRoot, true);
  const directory = join(options.cacheDir, "compilations");
  ensurePrivateDirectory(directory);
  const compilerFailure = sanitizeCompilerFailure(failure.compilerFailure, false);
  const recordWithoutHash = {
    schemaVersion: 2 as const,
    agentsHash: options.agentsHash,
    compilerVersion: options.compilerVersion,
    compilerIdentity: getCompilerIdentity(options),
    failedAtMs: failure.failedAtMs,
    error: sanitizeFailureError(failure.error),
    ...(compilerFailure ? { compilerFailure } : {}),
  };
  const record: CompilationFailureRecord = {
    ...recordWithoutHash,
    resultHash: hashText(JSON.stringify(recordWithoutHash)),
  };
  const target = getCompilationFailurePath(options);
  if (existsSync(target)) assertNotSymlink(target);
  const temporary = join(directory, `.tmp-failure-${process.pid}-${randomUUID()}.json`);
  writePrivateFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temporary, target);
}

function computeFailureHash(record: CompilationFailureRecord): string {
  return hashText(
    JSON.stringify({
      schemaVersion: record.schemaVersion,
      agentsHash: record.agentsHash,
      compilerVersion: record.compilerVersion,
      compilerIdentity: record.compilerIdentity,
      failedAtMs: record.failedAtMs,
      error: record.error,
      ...(record.compilerFailure ? { compilerFailure: record.compilerFailure } : {}),
    }),
  );
}

function parseFailureRecord(value: unknown): CompilationFailureRecord | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, FAILURE_RECORD_KEYS)) return undefined;
  const compilerFailure =
    value.compilerFailure === undefined ? undefined : sanitizeCompilerFailure(value.compilerFailure, true);
  if (
    value.schemaVersion !== 2 ||
    typeof value.agentsHash !== "string" ||
    typeof value.compilerVersion !== "string" ||
    typeof value.compilerIdentity !== "string" ||
    !isNonnegativeInteger(value.failedAtMs) ||
    value.failedAtMs > Date.now() ||
    typeof value.error !== "string" ||
    sanitizeFailureError(value.error) !== value.error ||
    (value.compilerFailure !== undefined && !compilerFailure) ||
    typeof value.resultHash !== "string"
  ) {
    return undefined;
  }
  return {
    schemaVersion: 2,
    agentsHash: value.agentsHash,
    compilerVersion: value.compilerVersion,
    compilerIdentity: value.compilerIdentity,
    failedAtMs: value.failedAtMs,
    error: value.error,
    ...(compilerFailure ? { compilerFailure } : {}),
    resultHash: value.resultHash,
  };
}

function sanitizeCompilerFailure(
  value: unknown,
  rejectUnknownFields: boolean,
): ProjectInstructionCompilerFailureTelemetry | undefined {
  if (!isRecord(value) || (rejectUnknownFields && !hasOnlyKeys(value, COMPILER_FAILURE_KEYS))) return undefined;
  if (!isPositiveInteger(value.attemptCount) || value.attemptCount > 2 || !isFailureKinds(value.failureKinds)) {
    return undefined;
  }
  const failureKinds = value.failureKinds;
  const usage = sanitizeUsage(value.usage, rejectUnknownFields);
  if (!usage || !isNonnegativeFinite(value.elapsedMs) || failureKinds.length !== value.attemptCount) {
    return undefined;
  }
  const attemptDiagnostics =
    value.attemptDiagnostics === undefined
      ? undefined
      : sanitizeAttempts(value.attemptDiagnostics, rejectUnknownFields);
  if (
    value.attemptDiagnostics !== undefined &&
    (!attemptDiagnostics ||
      attemptDiagnostics.length !== value.attemptCount ||
      attemptDiagnostics.some((attempt, index) => attempt.kind !== failureKinds[index]))
  ) {
    return undefined;
  }
  return {
    attemptCount: value.attemptCount,
    failureKinds: [...failureKinds],
    ...(attemptDiagnostics ? { attemptDiagnostics } : {}),
    usage,
    elapsedMs: value.elapsedMs,
  };
}

function sanitizeAttempts(
  value: unknown,
  rejectUnknownFields: boolean,
): ProjectInstructionCompilerAttemptDiagnostic[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attempts: ProjectInstructionCompilerAttemptDiagnostic[] = [];
  for (const entry of value) {
    const attempt = sanitizeAttempt(entry, rejectUnknownFields);
    if (!attempt) return undefined;
    attempts.push(attempt);
  }
  return attempts;
}

function sanitizeAttempt(
  value: unknown,
  rejectUnknownFields: boolean,
): ProjectInstructionCompilerAttemptDiagnostic | undefined {
  if (!isRecord(value) || (rejectUnknownFields && !hasOnlyKeys(value, ATTEMPT_KEYS)) || !isFailureKind(value.kind)) {
    return undefined;
  }
  const usage = sanitizeUsage(value.usage, rejectUnknownFields);
  if (!usage || !isNonnegativeFinite(value.elapsedMs)) return undefined;
  const hasBudget = value.invariant === "body-budget";
  if (
    (value.invariant !== undefined && !hasBudget) ||
    (hasBudget &&
      (value.kind !== "grounding-semantic" ||
        !isNonnegativeInteger(value.selectedCount) ||
        !isNonnegativeInteger(value.materializedBodyChars) ||
        !isPositiveInteger(value.hardLimitChars) ||
        value.materializedBodyChars <= value.hardLimitChars)) ||
    (!hasBudget &&
      (value.selectedCount !== undefined ||
        value.materializedBodyChars !== undefined ||
        value.hardLimitChars !== undefined))
  ) {
    return undefined;
  }
  return {
    kind: value.kind,
    ...(hasBudget
      ? {
          invariant: "body-budget" as const,
          selectedCount: value.selectedCount as number,
          materializedBodyChars: value.materializedBodyChars as number,
          hardLimitChars: value.hardLimitChars as number,
        }
      : {}),
    usage,
    elapsedMs: value.elapsedMs,
  };
}

function sanitizeUsage(value: unknown, rejectUnknownFields = true): ProjectInstructionCompilerUsage | undefined {
  if (!isRecord(value) || (rejectUnknownFields && !hasOnlyKeys(value, USAGE_KEYS))) return undefined;
  if (![value.input, value.output, value.cacheRead, value.cacheWrite, value.total].every(isNonnegativeInteger)) {
    return undefined;
  }
  return {
    input: value.input as number,
    output: value.output as number,
    cacheRead: value.cacheRead as number,
    cacheWrite: value.cacheWrite as number,
    total: value.total as number,
  };
}

const FAILURE_RECORD_KEYS = [
  "schemaVersion",
  "agentsHash",
  "compilerVersion",
  "compilerIdentity",
  "failedAtMs",
  "error",
  "compilerFailure",
  "resultHash",
] as const;
const COMPILER_FAILURE_KEYS = ["attemptCount", "failureKinds", "attemptDiagnostics", "usage", "elapsedMs"] as const;
const ATTEMPT_KEYS = [
  "kind",
  "invariant",
  "selectedCount",
  "materializedBodyChars",
  "hardLimitChars",
  "usage",
  "elapsedMs",
] as const;
const USAGE_KEYS = ["input", "output", "cacheRead", "cacheWrite", "total"] as const;
const SAFE_FAILURE_ERRORS = new Set([
  "Error: Instruction compiler failed",
  "Error: Instruction compiler model context capacity was insufficient",
  "Error: Instruction compiler model does not support thinking off",
  "Error: Instruction compiler model lacks explicit thinking-disable compatibility",
  "Error: Instruction compiler output validation failed",
  "Error: Instruction compiler provider call failed",
  "Error: Instruction compiler provider context window failed",
  "Error: Instruction compiler source size limit was exceeded",
]);

function sanitizeFailureError(value: string): string {
  return SAFE_FAILURE_ERRORS.has(value) ? value : "Error: Instruction compiler failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function isFailureKinds(value: unknown): value is ProjectInstructionCompilerFailureKind[] {
  return Array.isArray(value) && value.every(isFailureKind);
}

function isFailureKind(value: unknown): value is ProjectInstructionCompilerFailureKind {
  return PROJECT_INSTRUCTION_COMPILER_FAILURE_KINDS.some((kind) => kind === value);
}

function isPositiveInteger(value: unknown): value is number {
  return isNonnegativeInteger(value) && value > 0;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonnegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
