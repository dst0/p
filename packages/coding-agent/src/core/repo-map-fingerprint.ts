import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { join, relative } from "node:path";
import { listIndexableFiles, SKIP_DIRS } from "./repo-map-helpers.ts";

export function getGitSha(root: string): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

export function getWorktreeFingerprint(root: string): string {
  const result = spawnSync("git", ["status", "--short", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  if (result.status === 0) {
    return fingerprintGitStatus(root, result.stdout);
  }
  return `non-git:${listIndexableFiles(root)
    .map((path) => {
      const stat = statSync(path);
      return `${relative(root, path)}:${stat.size}:${stat.mtimeMs}`;
    })
    .join("|")}`;
}

function fingerprintGitStatus(root: string, status: string): string {
  const lines = status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const dirtyPaths = [
    ...new Set(
      lines
        .flatMap(parseGitStatusPaths)
        .filter((path) => !isSkippedRelativePath(path))
        .sort(),
    ),
  ];
  const visibleLines = lines.filter((line) => {
    const paths = parseGitStatusPaths(line);
    return paths.length === 0 || paths.some((path) => !isSkippedRelativePath(path));
  });
  const stats = dirtyPaths.map((path) => {
    try {
      const stat = statSync(join(root, path));
      return `${path}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return `${path}:missing`;
    }
  });
  return [...visibleLines, ...stats].join("\n");
}

function parseGitStatusPaths(line: string): string[] {
  const path = line.slice(3).trim();
  if (path.length === 0) return [];
  const renameSeparator = " -> ";
  const renamedPath = path.includes(renameSeparator) ? (path.split(renameSeparator).at(-1) ?? path) : path;
  return [normalizeGitStatusPath(renamedPath)];
}

function normalizeGitStatusPath(path: string): string {
  if (path.startsWith('"') && path.endsWith('"')) {
    try {
      const parsed = JSON.parse(path) as unknown;
      if (typeof parsed === "string") return parsed;
    } catch {
      return path;
    }
  }
  return path;
}

function isSkippedRelativePath(path: string): boolean {
  return path.split(/[\\/]/)[0] ? SKIP_DIRS.has(path.split(/[\\/]/)[0]) : false;
}
