import { execFileSync } from "node:child_process";

function git(repoRoot, args, options = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  }).trim();
}

function hasCommit(repoRoot, sha) {
  try {
    git(repoRoot, ["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function isAncestor(repoRoot, ancestor, descendant) {
  try {
    git(repoRoot, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

export function assertReleaseOnOriginMain(repoRoot, tagSha) {
  const output = git(repoRoot, ["ls-remote", "--refs", "origin", "refs/heads/main"]);
  const remoteMainSha = output.split(/\s+/, 1)[0];
  if (!/^[a-f0-9]{40}$/.test(remoteMainSha)) {
    throw new Error("Cannot resolve current origin/main for release verification");
  }
  if (!hasCommit(repoRoot, remoteMainSha)) {
    execFileSync("git", ["fetch", "--no-tags", "origin", "main"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
  }
  if (!hasCommit(repoRoot, remoteMainSha) || !isAncestor(repoRoot, tagSha, remoteMainSha)) {
    throw new Error(`Release tag ${tagSha} is not contained in current origin main ${remoteMainSha}`);
  }
  return remoteMainSha;
}
