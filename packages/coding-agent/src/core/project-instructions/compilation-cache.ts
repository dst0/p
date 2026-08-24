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
import {
  type CompilationCacheOptions,
  getCompilationCachePath,
  getCompilationFailurePath,
  getCompilerIdentity,
} from "./compilation-cache-paths.ts";
import { parseProjectInstructionCompilerUsage } from "./compiler-usage.ts";
import { hashText } from "./content.ts";
import type { ProjectInstructionCompilerResult } from "./types.ts";

export {
  type CachedCompilationFailure,
  loadCachedCompilationFailure,
  persistCompilationFailure,
} from "./compilation-failure-cache.ts";

interface CompilationCacheRecord {
  schemaVersion: 4;
  agentsHash: string;
  compilerVersion: string;
  compilerIdentity: string;
  resultHash: string;
  body: string;
  triggers: Record<string, string>;
  classifications: ProjectInstructionCompilerResult["classifications"];
  alwaysOn: Record<string, string>;
  requires: Record<string, string[]>;
  usage?: ProjectInstructionCompilerResult["usage"];
}

export function loadCachedCompilation(options: CompilationCacheOptions): ProjectInstructionCompilerResult | undefined {
  try {
    assertCacheDirectorySafe(options.cacheDir, options.workspaceRoot, false);
    const record = parseRecord(JSON.parse(readRegularFile(getCompilationCachePath(options))) as unknown);
    if (
      !record ||
      record.agentsHash !== options.agentsHash ||
      record.compilerVersion !== options.compilerVersion ||
      record.compilerIdentity !== getCompilerIdentity(options) ||
      record.resultHash !== computeResultHash(record)
    ) {
      return undefined;
    }
    return {
      body: record.body,
      triggers: record.triggers,
      classifications: record.classifications,
      alwaysOn: record.alwaysOn,
      ...(Object.keys(record.requires).length > 0 ? { requires: record.requires } : {}),
      usage: record.usage,
    };
  } catch {
    return undefined;
  }
}

export function persistCompilation(options: CompilationCacheOptions, result: ProjectInstructionCompilerResult): void {
  assertCacheDirectorySafe(options.cacheDir, options.workspaceRoot, true);
  const directory = join(options.cacheDir, "compilations");
  ensurePrivateDirectory(directory);
  const usage = result.usage === undefined ? undefined : parseProjectInstructionCompilerUsage(result.usage, false);
  if (result.usage !== undefined && usage === undefined) {
    throw new Error("Project instruction compiler returned invalid usage");
  }
  const recordWithoutHash = {
    schemaVersion: 4 as const,
    agentsHash: options.agentsHash,
    compilerVersion: options.compilerVersion,
    compilerIdentity: getCompilerIdentity(options),
    body: result.body,
    triggers: result.triggers,
    classifications: result.classifications,
    alwaysOn: result.alwaysOn,
    requires: result.requires ?? {},
    usage,
  };
  const record: CompilationCacheRecord = {
    ...recordWithoutHash,
    resultHash: computeResultHash(recordWithoutHash),
  };
  const target = getCompilationCachePath(options);
  if (existsSync(target)) assertNotSymlink(target);
  const temporary = join(directory, `.tmp-${process.pid}-${randomUUID()}.json`);
  writePrivateFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temporary, target);
  const failurePath = getCompilationFailurePath(options);
  if (existsSync(failurePath)) {
    assertNotSymlink(failurePath);
    unlinkSync(failurePath);
  }
}

function computeResultHash(record: Omit<CompilationCacheRecord, "resultHash">): string {
  return hashText(
    JSON.stringify({
      schemaVersion: record.schemaVersion,
      agentsHash: record.agentsHash,
      compilerVersion: record.compilerVersion,
      compilerIdentity: record.compilerIdentity,
      body: record.body,
      triggers: record.triggers,
      classifications: record.classifications,
      alwaysOn: record.alwaysOn,
      requires: record.requires,
      usage: record.usage,
    }),
  );
}

function parseRecord(value: unknown): CompilationCacheRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const usage = record.usage === undefined ? undefined : parseProjectInstructionCompilerUsage(record.usage, true);
  if (
    record.schemaVersion !== 4 ||
    typeof record.agentsHash !== "string" ||
    typeof record.compilerVersion !== "string" ||
    typeof record.compilerIdentity !== "string" ||
    typeof record.resultHash !== "string" ||
    typeof record.body !== "string" ||
    !isStringRecord(record.triggers) ||
    !isClassifications(record.classifications) ||
    !isStringRecord(record.alwaysOn) ||
    !isStringArrayRecord(record.requires) ||
    (record.usage !== undefined && usage === undefined)
  ) {
    return undefined;
  }
  return {
    schemaVersion: 4,
    agentsHash: record.agentsHash,
    compilerVersion: record.compilerVersion,
    compilerIdentity: record.compilerIdentity,
    resultHash: record.resultHash,
    body: record.body,
    triggers: record.triggers,
    classifications: record.classifications,
    alwaysOn: record.alwaysOn,
    requires: record.requires,
    usage,
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

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (entry) => Array.isArray(entry) && entry.every((dependency) => typeof dependency === "string"),
    )
  );
}

function isClassifications(value: unknown): value is ProjectInstructionCompilerResult["classifications"] {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "modules" in value &&
    "constraints" in value &&
    isScopeRecord(value.modules) &&
    isScopeRecord(value.constraints)
  );
}

function isScopeRecord(value: unknown): value is Record<string, "always-on" | "routed"> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => entry === "always-on" || entry === "routed")
  );
}
