import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import ignore from "ignore";
import type { Minimatch } from "minimatch";
import { FILE_PATTERNS } from "./constants.ts";
import { resolveExtensionEntries } from "./dependency-scanning.ts";
import { collectFiles, collectSkillEntries } from "./package-installation.ts";
import type { ResourceType } from "./types.ts";
import { addIgnoreRules, toPosixPath } from "./version-resolution.ts";

export function collectAutoExtensionEntries(dir: string): string[] {
  const entries: string[] = [];
  if (!existsSync(dir)) return entries;

  // First check if this directory itself has explicit extension entries (package.json or index)
  const rootEntries = resolveExtensionEntries(dir);
  if (rootEntries) {
    return rootEntries;
  }

  // Otherwise, discover extensions from directory contents
  const ig = ignore();
  addIgnoreRules(ig, dir, dir);

  try {
    const dirEntries = readdirSync(dir, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;

      const fullPath = join(dir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();

      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(fullPath);
          isDir = stats.isDirectory();
          isFile = stats.isFile();
        } catch {
          continue;
        }
      }

      const relPath = toPosixPath(relative(dir, fullPath));
      const ignorePath = isDir ? `${relPath}/` : relPath;
      if (ig.ignores(ignorePath)) continue;

      if (isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
        entries.push(fullPath);
      } else if (isDir) {
        const resolvedEntries = resolveExtensionEntries(fullPath);
        if (resolvedEntries) {
          entries.push(...resolvedEntries);
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return entries;
}

export function collectResourceFiles(dir: string, resourceType: ResourceType): string[] {
  if (resourceType === "skills") {
    return collectSkillEntries(dir, "p");
  }
  if (resourceType === "extensions") {
    return collectAutoExtensionEntries(dir);
  }
  return collectFiles(dir, FILE_PATTERNS[resourceType]);
}

export function matchesAnyPattern(filePath: string, compiledPatterns: Minimatch[], baseDir: string): boolean {
  if (compiledPatterns.length === 0) return false;

  let rel: string | undefined;
  let name: string | undefined;
  let filePathPosix: string | undefined;
  let isSkillFile: boolean | undefined;

  let parentDir: string | undefined;
  let parentRel: string | undefined;
  let parentName: string | undefined;
  let parentDirPosix: string | undefined;

  for (let i = 0; i < compiledPatterns.length; i++) {
    const compiled = compiledPatterns[i];

    if (rel === undefined) {
      rel = toPosixPath(relative(baseDir, filePath));
      name = basename(filePath);
      filePathPosix = toPosixPath(filePath);
      isSkillFile = name === "SKILL.md";
    }

    if (compiled.match(rel) || compiled.match(name!) || compiled.match(filePathPosix!)) {
      return true;
    }

    if (isSkillFile) {
      if (parentDir === undefined) {
        parentDir = dirname(filePath);
        parentRel = toPosixPath(relative(baseDir, parentDir));
        parentName = basename(parentDir);
        parentDirPosix = toPosixPath(parentDir);
      }
      if (compiled.match(parentRel!) || compiled.match(parentName!) || compiled.match(parentDirPosix!)) {
        return true;
      }
    }
  }
  return false;
}

export function normalizeExactPattern(pattern: string): string {
  const normalized = pattern.startsWith("./") || pattern.startsWith(".\\") ? pattern.slice(2) : pattern;
  return toPosixPath(normalized);
}

export function matchesAnyExactPattern(filePath: string, normalizedPatterns: Set<string>, baseDir: string): boolean {
  if (normalizedPatterns.size === 0) return false;

  const filePathPosix = toPosixPath(filePath);
  if (normalizedPatterns.has(filePathPosix)) return true;

  const rel = toPosixPath(relative(baseDir, filePath));
  if (normalizedPatterns.has(rel)) return true;

  const name = basename(filePath);
  if (name === "SKILL.md") {
    const parentDir = dirname(filePath);
    const parentDirPosix = toPosixPath(parentDir);
    if (normalizedPatterns.has(parentDirPosix)) return true;

    const parentRel = toPosixPath(relative(baseDir, parentDir));
    if (normalizedPatterns.has(parentRel)) return true;
  }
  return false;
}

export function getOverridePatterns(entries: string[]): string[] {
  return entries.filter((pattern) => pattern.startsWith("!") || pattern.startsWith("+") || pattern.startsWith("-"));
}
