import { type ExecFileException, execFile, spawnSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import type { IndexStatus } from "../indexing-service.ts";
import type { GitPaths } from "./types.ts";

export function findGitPaths(cwd: string): GitPaths | null {
  let dir = cwd;
  while (true) {
    const gitPath = join(dir, ".git");
    if (existsSync(gitPath)) {
      try {
        const stat = statSync(gitPath);
        if (stat.isFile()) {
          const content = readFileSync(gitPath, "utf8").trim();
          if (content.startsWith("gitdir: ")) {
            const gitDir = resolve(dir, content.slice(8).trim());
            const headPath = join(gitDir, "HEAD");
            if (!existsSync(headPath)) return null;
            const commonDirPath = join(gitDir, "commondir");
            const commonGitDir = existsSync(commonDirPath)
              ? resolve(gitDir, readFileSync(commonDirPath, "utf8").trim())
              : gitDir;
            return { repoDir: dir, commonGitDir, headPath };
          }
        } else if (stat.isDirectory()) {
          const headPath = join(gitPath, "HEAD");
          if (!existsSync(headPath)) return null;
          return { repoDir: dir, commonGitDir: gitPath, headPath };
        }
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function resolveBranchWithGitSync(repoDir: string): string | null {
  const result = spawnSync("git", ["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd: repoDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const branch = result.status === 0 ? result.stdout.trim() : "";
  return branch || null;
}

export function resolveBranchWithGitAsync(repoDir: string): Promise<string | null> {
  return new Promise((resolvePromise) => {
    execFile(
      "git",
      ["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"],
      {
        cwd: repoDir,
        encoding: "utf8",
      },
      (error: ExecFileException | null, stdout: string) => {
        if (error) {
          resolvePromise(null);
          return;
        }
        const branch = stdout.trim();
        resolvePromise(branch || null);
      },
    );
  });
}

export function isWslEnvironment(): boolean {
  return process.platform === "linux" && !!(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
}

export function isWindowsMountedRepoPath(repoDir: string): boolean {
  return /^\/mnt\/[a-z](?:\/|$)/i.test(repoDir);
}

export function shouldPollGitHead(repoDir: string): boolean {
  return isWslEnvironment() && isWindowsMountedRepoPath(repoDir);
}

export function sameIndexingStatus(left: IndexStatus, right: IndexStatus): boolean {
  return (
    left.decision === right.decision &&
    left.indexed === right.indexed &&
    left.serviceRunning === right.serviceRunning &&
    left.ragState === right.ragState &&
    left.ragFiles === right.ragFiles &&
    left.ragChunks === right.ragChunks &&
    left.progress?.phase === right.progress?.phase &&
    left.progress?.percent === right.progress?.percent &&
    left.lastError === right.lastError
  );
}
