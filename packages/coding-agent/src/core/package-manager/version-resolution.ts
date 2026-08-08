import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { valid, validRange } from "semver";
import { IGNORE_FILE_NAMES } from "./constants.ts";
import type { IgnoreMatcher, PathMetadata } from "./types.ts";

export function getEnv(): NodeJS.ProcessEnv {
  if (process.platform !== "linux" || Object.keys(process.env).length > 0) {
    return process.env;
  }
  try {
    const data = readFileSync("/proc/self/environ", "utf-8");
    const env: NodeJS.ProcessEnv = {};
    for (const entry of data.split("\0")) {
      const idx = entry.indexOf("=");
      if (idx > 0) {
        env[entry.slice(0, idx)] = entry.slice(idx + 1);
      }
    }
    return env;
  } catch {
    return process.env;
  }
}

export function isOfflineModeEnabled(): boolean {
  const value = process.env.P_OFFLINE;
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export function isExactNpmVersion(version: string | undefined): boolean {
  return valid(version ?? "") !== null;
}

export function getNpmVersionRange(version: string | undefined): string | undefined {
  return version ? (validRange(version) ?? undefined) : undefined;
}

export function resourcePrecedenceRank(m: PathMetadata): number {
  if (m.origin === "package") return 4;
  const scopeBase = m.scope === "project" ? 0 : 2;
  return scopeBase + (m.source === "local" ? 0 : 1);
}

export function toPosixPath(p: string): string {
  return p.split(sep).join("/");
}

export function getHomeDir(): string {
  return process.env.HOME || homedir();
}

export function getExtensionTempFolder(agentDir: string): string {
  const tempFolder = join(agentDir, "tmp", "extensions");
  mkdirSync(tempFolder, { recursive: true, mode: 0o700 });
  chmodSync(tempFolder, 0o700);
  return tempFolder;
}

export function prefixIgnorePattern(line: string, prefix: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#") && !trimmed.startsWith("\\#")) return null;

  let pattern = line;
  let negated = false;

  if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1);
  } else if (pattern.startsWith("\\!")) {
    pattern = pattern.slice(1);
  }

  if (pattern.startsWith("/")) {
    pattern = pattern.slice(1);
  }

  const prefixed = prefix ? `${prefix}${pattern}` : pattern;
  return negated ? `!${prefixed}` : prefixed;
}

export function addIgnoreRules(ig: IgnoreMatcher, dir: string, rootDir: string): void {
  const relativeDir = relative(rootDir, dir);
  const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : "";

  for (const filename of IGNORE_FILE_NAMES) {
    const ignorePath = join(dir, filename);
    if (!existsSync(ignorePath)) continue;
    try {
      const content = readFileSync(ignorePath, "utf-8");
      const patterns = content
        .split(/\r?\n/)
        .map((line) => prefixIgnorePattern(line, prefix))
        .filter((line): line is string => Boolean(line));
      if (patterns.length > 0) {
        ig.add(patterns);
      }
    } catch {}
  }
}

export function isPattern(s: string): boolean {
  return s.startsWith("!") || s.startsWith("+") || s.startsWith("-") || s.includes("*") || s.includes("?");
}

export function isOverridePattern(s: string): boolean {
  return s.startsWith("!") || s.startsWith("+") || s.startsWith("-");
}

export function hasGlobPattern(s: string): boolean {
  return s.includes("*") || s.includes("?");
}

export function splitPatterns(entries: string[]): { plain: string[]; patterns: string[] } {
  const plain: string[] = [];
  const patterns: string[] = [];
  for (const entry of entries) {
    if (isPattern(entry)) {
      patterns.push(entry);
    } else {
      plain.push(entry);
    }
  }
  return { plain, patterns };
}
