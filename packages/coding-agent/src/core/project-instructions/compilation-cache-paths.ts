import { join } from "node:path";
import { hashText } from "./content.ts";

export interface CompilationCacheOptions {
  cacheDir: string;
  workspaceRoot: string;
  agentsHash: string;
  compilerVersion: string;
  compilerIdentity?: string;
}

export function getCompilationCachePath(options: CompilationCacheOptions): string {
  return join(
    options.cacheDir,
    "compilations",
    `${options.agentsHash}-${hashText(options.compilerVersion)}-${hashText(getCompilerIdentity(options))}.json`,
  );
}

export function getCompilationFailurePath(options: CompilationCacheOptions): string {
  return join(
    options.cacheDir,
    "compilations",
    `${options.agentsHash}-${hashText(options.compilerVersion)}-${hashText(getCompilerIdentity(options))}.failure.json`,
  );
}

export function getCompilerIdentity(options: CompilationCacheOptions): string {
  return options.compilerIdentity?.trim() || "default";
}
