import { lstatSync, realpathSync } from "node:fs";
import { dirname } from "node:path";

export function assertCandidateExecutableSafety(executablePath: string): void {
  const stat = lstatSync(executablePath);

  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Candidate executable must be a regular, non-symlink file: ${executablePath}`);
  }
  if (stat.nlink !== 1) {
    throw new Error(`Candidate executable must not have multiple hard links: ${executablePath}`);
  }
  if ((stat.mode & 0o111) === 0) {
    throw new Error(`Candidate executable must have execute permissions: ${executablePath}`);
  }
  if ((stat.mode & 0o022) !== 0) {
    throw new Error(`Candidate executable must not be group- or world-writable: ${executablePath}`);
  }

  if (typeof process.getuid === "function") {
    const currentUid = process.getuid();
    const isOwner = stat.uid === currentUid;
    const isRoot = stat.uid === 0;
    if (!isOwner && !isRoot) {
      throw new Error(
        `Candidate executable must be owned by current user (${currentUid}) or root (0), found UID ${stat.uid}: ${executablePath}`,
      );
    }
  }

  const directory = dirname(realpathSync(executablePath));
  const dirStat = lstatSync(directory);
  if ((dirStat.mode & 0o002) !== 0 && (dirStat.mode & 0o1000) === 0) {
    throw new Error(`Candidate executable directory must not be world-writable without sticky bit: ${directory}`);
  }
}
