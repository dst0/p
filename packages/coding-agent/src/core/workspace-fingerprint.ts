import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_UNTRACKED_FILES = 2_000;

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  return String(result.stdout);
}

/**
 * Return a stable digest of the git-visible workspace state.
 *
 * The fingerprint includes HEAD/branch/status, the full tracked diff against
 * HEAD, and size/mtime metadata for untracked files. It intentionally ignores
 * git-ignored build output so normal tests do not invalidate verification.
 */
export async function captureWorkspaceFingerprint(cwd: string): Promise<string | undefined> {
  try {
    const [statusOutput, diffOutput, untrackedOutput] = await Promise.all([
      runGit(cwd, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]),
      runGit(cwd, ["diff", "--no-ext-diff", "--binary", "HEAD", "--"]),
      runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
    const hash = createHash("sha256");
    hash.update(statusOutput);
    hash.update("\0tracked-diff\0");
    hash.update(diffOutput);
    hash.update("\0untracked-metadata\0");

    const untrackedPaths = untrackedOutput.split("\0").filter(Boolean);
    hash.update(String(untrackedPaths.length));
    for (const filePath of untrackedPaths.slice(0, MAX_UNTRACKED_FILES)) {
      try {
        const fileStat = await stat(resolve(cwd, filePath), { bigint: true });
        hash.update("\0");
        hash.update(filePath);
        hash.update("\0");
        hash.update(String(fileStat.size));
        hash.update("\0");
        hash.update(String(fileStat.mtimeNs));
      } catch {
        hash.update(`\0${filePath}\0missing`);
      }
    }
    return hash.digest("hex");
  } catch {
    return undefined;
  }
}
