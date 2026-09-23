import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const GIT_COMMON_DIR_TIMEOUT_MS = 2_000;

// Resolving the main worktree shells out to git; a repo's worktree topology never changes
// for the lifetime of this process, so cache it (including the "not a worktree" outcome)
// to keep frequent pollers (e.g. the footer's 500ms indexing-status refresh) from spawning
// git on every tick.
const mainWorktreePathCache = new Map<string, string | undefined>();

/**
 * Resolves the main working tree of a linked `git worktree`, so a fresh worktree can
 * inherit its indexing decision instead of prompting again. Returns undefined unless
 * `workspaceRoot` is a linked worktree of a real (non-bare) working tree: bare repos,
 * `--separate-git-dir` checkouts, and submodule gitdirs under `.git/modules` never have a
 * `.git` directory at the resolved common-dir's parent, so they fall back to prompting.
 */
export function findMainWorktreePath(workspaceRoot: string): string | undefined {
  const canonicalWorkspaceRoot = canonicalizePath(workspaceRoot);
  if (mainWorktreePathCache.has(canonicalWorkspaceRoot)) return mainWorktreePathCache.get(canonicalWorkspaceRoot);
  const resolved = resolveMainWorktreePath(canonicalWorkspaceRoot);
  mainWorktreePathCache.set(canonicalWorkspaceRoot, resolved);
  return resolved;
}

function resolveMainWorktreePath(canonicalWorkspaceRoot: string): string | undefined {
  let gitCommonDir: string;
  try {
    const output = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: canonicalWorkspaceRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: GIT_COMMON_DIR_TIMEOUT_MS,
    }).trim();
    if (!output) return undefined;
    gitCommonDir = fs.realpathSync(path.resolve(canonicalWorkspaceRoot, output));
  } catch {
    return undefined;
  }
  if (path.basename(gitCommonDir) !== ".git") return undefined;
  const candidateRoot = path.dirname(gitCommonDir);
  if (canonicalizePath(candidateRoot) === canonicalWorkspaceRoot) return undefined;
  try {
    const dotGit = path.join(candidateRoot, ".git");
    if (!fs.statSync(dotGit).isDirectory()) return undefined;
    if (!fs.existsSync(path.join(dotGit, "HEAD"))) return undefined;
  } catch {
    return undefined;
  }
  return candidateRoot;
}

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
