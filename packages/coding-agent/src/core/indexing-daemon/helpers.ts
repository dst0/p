import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RagStatus } from "@dst0/p-code-index";
import { DAEMON_LOCK_INITIALIZATION_GRACE_MS, MANUAL_PRIORITY_OFFSET } from "./constants.ts";
import type { DaemonLock, RepositoryRuntime } from "./types.ts";

const IGNORED_WATCH_PATH_PATTERN =
  /(?:^|[\\/])(?:\.git|\.hg|\.p|\.svn|\.venv|build|coverage|dist|node_modules|storage|target)(?:[\\/]|$)/;

export function isResourceFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && Reflect.get(error, "kind") === "resource") return true;
  // Match resource error messages by content
  return (
    /\b(out of memory|oom|OOM)\b/i.test(message) ||
    /\bno space left on device\b/i.test(message) ||
    /\bfailed to allocate\b/i.test(message) ||
    /\b(EMFILE|ENOSPC|ENFILE)\b/i.test(message) ||
    /(?:Aborted \(core dumped\)|process died with exit code \d+ and signal SIGABRT)/i.test(message)
  );
}

export function isReusableReadyStatus(status: RagStatus): boolean {
  return status.state === "ready" && typeof status.collection === "string" && typeof status.generation === "string";
}

export function shouldRefreshRuntime(runtime: RepositoryRuntime, status: RagStatus): boolean {
  if (status.state === "disabled") return false;
  if (status.state !== "ready") return true;
  return !runtime.readyValidated;
}

export function isDirectory(value: string): boolean {
  try {
    return fs.statSync(value).isDirectory();
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

export function isIgnoredWatchPath(filename: string): boolean {
  return IGNORED_WATCH_PATH_PATTERN.test(filename);
}

export function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 500);
}

export function parseRequestPriority(updatedAt: string): number {
  const parsed = Date.parse(updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseManualRequestPriority(requestedAt: string): number {
  return MANUAL_PRIORITY_OFFSET + parseRequestPriority(requestedAt);
}

export function readDaemonLock(lockPath: string): { pid: number; token: string } | undefined {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
    if (typeof value !== "object" || value === null) return undefined;
    const pid = Reflect.get(value, "pid");
    const token = Reflect.get(value, "token");
    if (!Number.isSafeInteger(pid) || typeof token !== "string") return undefined;
    return { pid: Number(pid), token };
  } catch {
    return undefined;
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

export function acquireDaemonLock(agentDir: string): DaemonLock {
  const lockPath = path.join(agentDir, "indexing-service", "daemon.lock");
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  for (;;) {
    const token = randomUUID();
    try {
      const descriptor = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(
          descriptor,
          `${JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() })}\n`,
        );
      } finally {
        fs.closeSync(descriptor);
      }
      return { path: lockPath, token };
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      const owner = readDaemonLock(lockPath);
      if (owner && isProcessRunning(owner.pid)) {
        throw new Error(`Code indexing daemon is already running with pid ${owner.pid}`);
      }
      if (!owner) {
        let ageMs: number;
        try {
          ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
        } catch (statError) {
          if (statError instanceof Error && "code" in statError && statError.code === "ENOENT") continue;
          throw statError;
        }
        if (ageMs < DAEMON_LOCK_INITIALIZATION_GRACE_MS) {
          throw new Error("Code indexing daemon lock is being initialized");
        }
      }
      fs.rmSync(lockPath, { force: true });
    }
  }
}

export function releaseDaemonLock(lock: DaemonLock): void {
  const owner = readDaemonLock(lock.path);
  if (owner?.token === lock.token) fs.rmSync(lock.path, { force: true });
}
