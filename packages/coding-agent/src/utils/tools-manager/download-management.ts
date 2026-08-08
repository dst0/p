import { type SpawnSyncReturns, spawnSync } from "child_process";
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readdirSync, statSync, unlinkSync } from "fs";
import { platform } from "os";
import { join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { APP_NAME } from "../../config.ts";
import {
  DOWNLOAD_LOCK_POLL_MS,
  DOWNLOAD_LOCK_STALE_MS,
  DOWNLOAD_TIMEOUT_MS,
  NETWORK_TIMEOUT_MS,
  TOOLS,
  TOOLS_DIR,
} from "./constants.ts";
import type { DownloadLockOptions } from "./types.ts";

export function isOfflineModeEnabled(): boolean {
  const value = process.env.P_OFFLINE;
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export function removeDownloadLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

export async function acquireDownloadLock(
  tool: "fd" | "rg",
  options: DownloadLockOptions = {},
): Promise<{ fd: number; path: string }> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const staleMs = options.staleMs ?? DOWNLOAD_LOCK_STALE_MS;
  mkdirSync(TOOLS_DIR, { recursive: true });
  const lockPath = join(TOOLS_DIR, `.${tool}.download.lock`);
  const deadline = now() + staleMs;
  while (true) {
    try {
      return { fd: openSync(lockPath, "wx", 0o600), path: lockPath };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      try {
        if (now() - statSync(lockPath).mtimeMs >= staleMs) {
          removeDownloadLock(lockPath);
          continue;
        }
      } catch {
        removeDownloadLock(lockPath);
        continue;
      }
      if (now() >= deadline) throw new Error(`Timed out waiting for the ${tool} download lock`);
      await sleep(DOWNLOAD_LOCK_POLL_MS);
    }
  }
}

export function releaseDownloadLock(lock: { fd: number; path: string }): void {
  closeSync(lock.fd);
  removeDownloadLock(lock.path);
}

export function commandExists(cmd: string): boolean {
  try {
    const result = spawnSync(cmd, ["--version"], { stdio: "pipe" });
    // Check for ENOENT error (command not found)
    return result.error === undefined || result.error === null;
  } catch {
    return false;
  }
}

export function getToolPath(tool: "fd" | "rg"): string | null {
  const config = TOOLS[tool];
  if (!config) return null;

  // Check our tools directory first
  const localPath = join(TOOLS_DIR, config.binaryName + (platform() === "win32" ? ".exe" : ""));
  if (existsSync(localPath)) {
    return localPath;
  }

  // Check system PATH - if found, just return the command name (it's in PATH)
  const systemBinaryNames = config.systemBinaryNames ?? [config.binaryName];
  for (const systemBinaryName of systemBinaryNames) {
    if (commandExists(systemBinaryName)) {
      return systemBinaryName;
    }
  }

  return null;
}

export async function getLatestVersion(repo: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { "User-Agent": `${APP_NAME}-coding-agent` },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = (await response.json()) as { tag_name: string };
  return data.tag_name.replace(/^v/, "");
}

export async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }

  if (!response.body) {
    throw new Error("No response body");
  }

  const fileStream = createWriteStream(dest);
  await pipeline(Readable.fromWeb(response.body as any), fileStream);
}

export function findBinaryRecursively(rootDir: string, binaryFileName: string): string | null {
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isFile() && entry.name === binaryFileName) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
    }
  }

  return null;
}

export function formatSpawnFailure(result: SpawnSyncReturns<Buffer>): string {
  if (result.error?.message) {
    return result.error.message;
  }
  const stderr = result.stderr?.toString().trim();
  if (stderr) {
    return stderr;
  }
  const stdout = result.stdout?.toString().trim();
  if (stdout) {
    return stdout;
  }
  return `exit status ${result.status ?? "unknown"}`;
}

export function runExtractionCommand(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, { stdio: "pipe" });
  if (!result.error && result.status === 0) {
    return null;
  }
  return `${command}: ${formatSpawnFailure(result)}`;
}

export function getTarExtractionArgs(archivePath: string, extractDir: string): string[] {
  return ["xzf", archivePath, "--no-same-owner", "-C", extractDir];
}
