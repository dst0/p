import fs from "node:fs";
import path from "node:path";

export function findWorkspaceRoot(cwd: string): string {
  const canonicalCwd = canonicalizePath(cwd);
  let current = canonicalCwd;
  while (true) {
    if (isGitMetadataPath(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return canonicalCwd;
    current = parent;
  }
}

export function isGitMetadataPath(gitPath: string): boolean {
  if (fs.existsSync(path.join(gitPath, "HEAD"))) return true;
  try {
    return fs.readFileSync(gitPath, "utf8").trimStart().startsWith("gitdir:");
  } catch {
    return false;
  }
}

export function canonicalizePath(value: string): string {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}
