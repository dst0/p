import { randomUUID } from "node:crypto";
import { existsSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  assertCacheDirectorySafe,
  assertNotSymlink,
  ensurePrivateDirectory,
  readRegularFile,
  writePrivateFile,
} from "./cache-safety.ts";
import { hashText } from "./content.ts";
import type { ProjectInstructionCompilerResult } from "./types.ts";

interface CompilationCacheRecord {
  schemaVersion: 1;
  agentsHash: string;
  compilerVersion: string;
  resultHash: string;
  body: string;
  triggers: Record<string, string>;
}

interface CompilationCacheOptions {
  cacheDir: string;
  workspaceRoot: string;
  agentsHash: string;
  compilerVersion: string;
  compilerIdentity?: string;
}

interface CompilationFailureRecord {
  schemaVersion: 1;
  agentsHash: string;
  compilerVersion: string;
  compilerIdentity: string;
  failedAtMs: number;
  error: string;
  resultHash: string;
}

export interface CachedCompilationFailure {
  failedAtMs: number;
  error: string;
}

export function loadCachedCompilation(options: CompilationCacheOptions): ProjectInstructionCompilerResult | undefined {
  try {
    assertCacheDirectorySafe(options.cacheDir, options.workspaceRoot, false);
    const record = parseRecord(JSON.parse(readRegularFile(getCachePath(options))) as unknown);
    if (
      !record ||
      record.agentsHash !== options.agentsHash ||
      record.compilerVersion !== options.compilerVersion ||
      record.resultHash !== computeResultHash(record)
    ) {
      return undefined;
    }
    return { body: record.body, triggers: record.triggers };
  } catch {
    return undefined;
  }
}

export function persistCompilation(options: CompilationCacheOptions, result: ProjectInstructionCompilerResult): void {
  assertCacheDirectorySafe(options.cacheDir, options.workspaceRoot, true);
  const directory = join(options.cacheDir, "compilations");
  ensurePrivateDirectory(directory);
  const recordWithoutHash = {
    schemaVersion: 1 as const,
    agentsHash: options.agentsHash,
    compilerVersion: options.compilerVersion,
    body: result.body,
    triggers: result.triggers,
  };
  const record: CompilationCacheRecord = {
    ...recordWithoutHash,
    resultHash: computeResultHash(recordWithoutHash),
  };
  const target = getCachePath(options);
  if (existsSync(target)) assertNotSymlink(target);
  const temporary = join(directory, `.tmp-${process.pid}-${randomUUID()}.json`);
  writePrivateFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temporary, target);
  const failurePath = getFailurePath(options);
  if (existsSync(failurePath)) {
    assertNotSymlink(failurePath);
    unlinkSync(failurePath);
  }
}

export function loadCachedCompilationFailure(options: CompilationCacheOptions): CachedCompilationFailure | undefined {
  try {
    assertCacheDirectorySafe(options.cacheDir, options.workspaceRoot, false);
    const record = parseFailureRecord(JSON.parse(readRegularFile(getFailurePath(options))) as unknown);
    if (
      !record ||
      record.agentsHash !== options.agentsHash ||
      record.compilerVersion !== options.compilerVersion ||
      record.compilerIdentity !== getCompilerIdentity(options) ||
      record.resultHash !== computeFailureHash(record)
    ) {
      return undefined;
    }
    return { failedAtMs: record.failedAtMs, error: record.error };
  } catch {
    return undefined;
  }
}

export function persistCompilationFailure(options: CompilationCacheOptions, failure: CachedCompilationFailure): void {
  assertCacheDirectorySafe(options.cacheDir, options.workspaceRoot, true);
  const directory = join(options.cacheDir, "compilations");
  ensurePrivateDirectory(directory);
  const recordWithoutHash = {
    schemaVersion: 1 as const,
    agentsHash: options.agentsHash,
    compilerVersion: options.compilerVersion,
    compilerIdentity: getCompilerIdentity(options),
    failedAtMs: failure.failedAtMs,
    error: failure.error.slice(0, 500),
  };
  const record: CompilationFailureRecord = {
    ...recordWithoutHash,
    resultHash: computeFailureHash(recordWithoutHash),
  };
  const target = getFailurePath(options);
  if (existsSync(target)) assertNotSymlink(target);
  const temporary = join(directory, `.tmp-failure-${process.pid}-${randomUUID()}.json`);
  writePrivateFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temporary, target);
}

function getCachePath(options: CompilationCacheOptions): string {
  return join(options.cacheDir, "compilations", `${options.agentsHash}-${hashText(options.compilerVersion)}.json`);
}

function getFailurePath(options: CompilationCacheOptions): string {
  return join(
    options.cacheDir,
    "compilations",
    `${options.agentsHash}-${hashText(options.compilerVersion)}-${hashText(getCompilerIdentity(options))}.failure.json`,
  );
}

function getCompilerIdentity(options: CompilationCacheOptions): string {
  return options.compilerIdentity?.trim() || "default";
}

function computeResultHash(record: Omit<CompilationCacheRecord, "resultHash">): string {
  return hashText(
    JSON.stringify({
      schemaVersion: record.schemaVersion,
      agentsHash: record.agentsHash,
      compilerVersion: record.compilerVersion,
      body: record.body,
      triggers: record.triggers,
    }),
  );
}

function computeFailureHash(record: Omit<CompilationFailureRecord, "resultHash">): string {
  return hashText(
    JSON.stringify({
      schemaVersion: record.schemaVersion,
      agentsHash: record.agentsHash,
      compilerVersion: record.compilerVersion,
      compilerIdentity: record.compilerIdentity,
      failedAtMs: record.failedAtMs,
      error: record.error,
    }),
  );
}

function parseRecord(value: unknown): CompilationCacheRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.agentsHash !== "string" ||
    typeof record.compilerVersion !== "string" ||
    typeof record.resultHash !== "string" ||
    typeof record.body !== "string" ||
    !isStringRecord(record.triggers)
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    agentsHash: record.agentsHash,
    compilerVersion: record.compilerVersion,
    resultHash: record.resultHash,
    body: record.body,
    triggers: record.triggers,
  };
}

function parseFailureRecord(value: unknown): CompilationFailureRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.agentsHash !== "string" ||
    typeof record.compilerVersion !== "string" ||
    typeof record.compilerIdentity !== "string" ||
    typeof record.failedAtMs !== "number" ||
    !Number.isFinite(record.failedAtMs) ||
    typeof record.error !== "string" ||
    typeof record.resultHash !== "string"
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    agentsHash: record.agentsHash,
    compilerVersion: record.compilerVersion,
    compilerIdentity: record.compilerIdentity,
    failedAtMs: record.failedAtMs,
    error: record.error,
    resultHash: record.resultHash,
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}
