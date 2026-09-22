import { execFileSync } from "node:child_process";

export interface ReleaseBenchmarkBaseRevision {
  headSha: string;
  originMainSha: string;
}

export function requireCleanReleaseBenchmarkBase(repoRoot: string): ReleaseBenchmarkBaseRevision {
  git(repoRoot, ["fetch", "--quiet", "origin", "main"]);
  const revision = {
    headSha: git(repoRoot, ["rev-parse", "HEAD"]),
    originMainSha: git(repoRoot, ["rev-parse", "refs/remotes/origin/main"]),
  };
  if (revision.headSha !== revision.originMainSha || git(repoRoot, ["status", "--porcelain"])) {
    throw new Error("Benchmark certification requires a clean exact origin/main worktree");
  }
  return revision;
}

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}
