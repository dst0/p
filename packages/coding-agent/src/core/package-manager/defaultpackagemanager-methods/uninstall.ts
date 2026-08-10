import { maxSatisfying, rcompare } from "semver";
import { NETWORK_TIMEOUT_MS } from "../constants.ts";
import type { DefaultPackageManager } from "../defaultpackagemanager.ts";
import { isOfflineModeEnabled } from "../version-resolution.ts";

export async function do_getLatestNpmVersion(
  self: DefaultPackageManager,
  packageSpec: string,
  range?: string,
): Promise<string> {
  const npmCommand = self.getNpmCommand();
  const stdout = await self.runCommandCapture(
    npmCommand.command,
    [...npmCommand.args, "view", packageSpec, "version", "--json"],
    { cwd: self.cwd, timeoutMs: NETWORK_TIMEOUT_MS },
  );
  const raw = stdout.trim();
  if (!raw) throw new Error("Empty response from npm view");
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed === "string") {
    return parsed;
  }
  if (Array.isArray(parsed)) {
    const versions = parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
    const latest = range ? maxSatisfying(versions, range) : [...versions].sort(rcompare)[0];
    if (latest) return latest;
  }
  throw new Error("Unexpected response from npm view");
}

export async function do_gitHasAvailableUpdate(self: DefaultPackageManager, installedPath: string): Promise<boolean> {
  if (isOfflineModeEnabled()) {
    return false;
  }

  try {
    const localHead = await self.runCommandCapture("git", ["rev-parse", "HEAD"], {
      cwd: installedPath,
      timeoutMs: NETWORK_TIMEOUT_MS,
    });
    const remoteHead = await self.getRemoteGitHead(installedPath);
    return localHead.trim() !== remoteHead.trim();
  } catch {
    return false;
  }
}

export async function do_getRemoteGitHead(self: DefaultPackageManager, installedPath: string): Promise<string> {
  const upstreamRef = await self.getGitUpstreamRef(installedPath);
  if (upstreamRef) {
    const remoteHead = await self.runGitRemoteCommand(installedPath, ["ls-remote", "origin", upstreamRef]);
    const match = remoteHead.match(/^([0-9a-f]{40})\s+/m);
    if (match?.[1]) {
      return match[1];
    }
  }

  const remoteHead = await self.runGitRemoteCommand(installedPath, ["ls-remote", "origin", "HEAD"]);
  const match = remoteHead.match(/^([0-9a-f]{40})\s+HEAD$/m);
  if (!match?.[1]) {
    throw new Error("Failed to determine remote HEAD");
  }
  return match[1];
}

export async function do_getLocalGitUpdateTarget(
  self: DefaultPackageManager,
  installedPath: string,
): Promise<{ ref: string; head: string; fetchArgs: string[] }> {
  try {
    const upstream = await self.runCommandCapture("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], {
      cwd: installedPath,
      timeoutMs: NETWORK_TIMEOUT_MS,
    });
    const trimmedUpstream = upstream.trim();
    if (!trimmedUpstream.startsWith("origin/")) {
      throw new Error(`Unsupported upstream remote: ${trimmedUpstream}`);
    }
    const branch = trimmedUpstream.slice("origin/".length);
    if (!branch) {
      throw new Error("Missing upstream branch name");
    }
    const head = await self.runCommandCapture("git", ["rev-parse", "@{upstream}"], {
      cwd: installedPath,
      timeoutMs: NETWORK_TIMEOUT_MS,
    });
    return {
      ref: "@{upstream}",
      head,
      fetchArgs: ["fetch", "--prune", "--no-tags", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`],
    };
  } catch {
    await self.runCommand("git", ["remote", "set-head", "origin", "-a"], { cwd: installedPath }).catch(() => {});
    const head = await self.runCommandCapture("git", ["rev-parse", "origin/HEAD"], {
      cwd: installedPath,
      timeoutMs: NETWORK_TIMEOUT_MS,
    });
    const originHeadRef = await self
      .runCommandCapture("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
        cwd: installedPath,
        timeoutMs: NETWORK_TIMEOUT_MS,
      })
      .catch(() => "");
    const branch = originHeadRef.trim().replace(/^refs\/remotes\/origin\//, "");
    if (branch) {
      return {
        ref: "origin/HEAD",
        head,
        fetchArgs: ["fetch", "--prune", "--no-tags", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`],
      };
    }
    return {
      ref: "origin/HEAD",
      head,
      fetchArgs: ["fetch", "--prune", "--no-tags", "origin", "+HEAD:refs/remotes/origin/HEAD"],
    };
  }
}

export async function do_getGitUpstreamRef(
  self: DefaultPackageManager,
  installedPath: string,
): Promise<string | undefined> {
  try {
    const upstream = await self.runCommandCapture("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], {
      cwd: installedPath,
      timeoutMs: NETWORK_TIMEOUT_MS,
    });
    const trimmed = upstream.trim();
    if (!trimmed.startsWith("origin/")) {
      return undefined;
    }
    const branch = trimmed.slice("origin/".length);
    return branch ? `refs/heads/${branch}` : undefined;
  } catch {
    return undefined;
  }
}

export function do_runGitRemoteCommand(
  self: DefaultPackageManager,
  installedPath: string,
  args: string[],
): Promise<string> {
  return self.runCommandCapture("git", args, {
    cwd: installedPath,
    timeoutMs: NETWORK_TIMEOUT_MS,
    env: {
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

export async function do_runWithConcurrency<T>(
  _self: DefaultPackageManager,
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  if (tasks.length === 0) {
    return [];
  }

  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, tasks.length));

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) {
        return;
      }
      results[index] = await tasks[index]();
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
