import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ignore from "ignore";
import { findGitRepoRoot } from "./package-installation.ts";
import type { PiManifest } from "./types.ts";
import { addIgnoreRules, toPosixPath } from "./version-resolution.ts";

export function collectAncestorAgentsSkillDirs(startDir: string): string[] {
  const skillDirs: string[] = [];
  const resolvedStartDir = resolve(startDir);
  const gitRepoRoot = findGitRepoRoot(resolvedStartDir);

  let dir = resolvedStartDir;
  while (true) {
    skillDirs.push(join(dir, ".agents", "skills"));
    if (gitRepoRoot && dir === gitRepoRoot) {
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return skillDirs;
}

export function collectAutoPromptEntries(dir: string): string[] {
  const entries: string[] = [];
  if (!existsSync(dir)) return entries;

  const ig = ignore();
  addIgnoreRules(ig, dir, dir);

  try {
    const dirEntries = readdirSync(dir, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;

      const fullPath = join(dir, entry.name);
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          isFile = statSync(fullPath).isFile();
        } catch {
          continue;
        }
      }

      const relPath = toPosixPath(relative(dir, fullPath));
      if (ig.ignores(relPath)) continue;

      if (isFile && entry.name.endsWith(".md")) {
        entries.push(fullPath);
      }
    }
  } catch {
    // Ignore errors
  }

  return entries;
}

export function collectAutoThemeEntries(dir: string): string[] {
  const entries: string[] = [];
  if (!existsSync(dir)) return entries;

  const ig = ignore();
  addIgnoreRules(ig, dir, dir);

  try {
    const dirEntries = readdirSync(dir, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;

      const fullPath = join(dir, entry.name);
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          isFile = statSync(fullPath).isFile();
        } catch {
          continue;
        }
      }

      const relPath = toPosixPath(relative(dir, fullPath));
      if (ig.ignores(relPath)) continue;

      if (isFile && entry.name.endsWith(".json")) {
        entries.push(fullPath);
      }
    }
  } catch {
    // Ignore errors
  }

  return entries;
}

export function readPiManifestFile(packageJsonPath: string): PiManifest | null {
  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content) as { p?: PiManifest; pi?: PiManifest };
    return pkg.p ?? pkg.pi ?? null;
  } catch {
    return null;
  }
}

export function resolveExtensionEntries(dir: string): string[] | null {
  const packageJsonPath = join(dir, "package.json");
  if (existsSync(packageJsonPath)) {
    const manifest = readPiManifestFile(packageJsonPath);
    if (manifest?.extensions?.length) {
      const entries: string[] = [];
      for (const extPath of manifest.extensions) {
        const resolvedExtPath = resolve(dir, extPath);
        if (existsSync(resolvedExtPath)) {
          entries.push(resolvedExtPath);
        }
      }
      if (entries.length > 0) {
        return entries;
      }
    }
  }

  const indexTs = join(dir, "index.ts");
  const indexJs = join(dir, "index.js");
  if (existsSync(indexTs)) {
    return [indexTs];
  }
  if (existsSync(indexJs)) {
    return [indexJs];
  }

  return null;
}
