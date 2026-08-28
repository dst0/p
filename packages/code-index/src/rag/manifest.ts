import fs from "node:fs";
import path from "node:path";
import type { IndexManifest } from "./types.ts";

export const INDEX_MANIFEST_SCHEMA_VERSION = 1;
export const CHUNKER_NAME = "p-symbol-lines";
export const CHUNKER_VERSION = "2";

function isManifest(value: unknown): value is IndexManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<IndexManifest>;
  return (
    candidate.schemaVersion === INDEX_MANIFEST_SCHEMA_VERSION &&
    typeof candidate.repoId === "string" &&
    typeof candidate.root === "string" &&
    typeof candidate.collection === "string" &&
    typeof candidate.generation === "string" &&
    candidate.files !== undefined &&
    typeof candidate.files === "object" &&
    candidate.chunker?.name === CHUNKER_NAME &&
    typeof candidate.chunker.version === "string" &&
    typeof candidate.embedding?.dimensions === "number" &&
    candidate.sparse?.strategy === "frozen-bm25"
  );
}

export function loadManifest(manifestPath: string): IndexManifest | undefined {
  if (!fs.existsSync(manifestPath)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read code RAG manifest: ${message}`);
  }
  if (!isManifest(value)) {
    throw new Error("Code RAG manifest is incompatible or malformed");
  }
  return value;
}

export function writeManifestAtomic(manifestPath: string, manifest: IndexManifest): void {
  const directory = path.dirname(manifestPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
  const file = fs.openSync(temporaryPath, "w", 0o600);
  try {
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    fs.fsyncSync(file);
  } finally {
    fs.closeSync(file);
  }
  fs.renameSync(temporaryPath, manifestPath);
}

export interface RepositoryLock {
  release(): void;
}

export type RepositoryRefreshLockState = "absent" | "active" | "stale";

const DEFAULT_REPOSITORY_LOCK_STALE_AFTER_MS = 10 * 60_000;

export function getRepositoryRefreshLockState(
  directory: string,
  staleAfterMs: number = DEFAULT_REPOSITORY_LOCK_STALE_AFTER_MS,
): RepositoryRefreshLockState {
  const lockPath = path.join(directory, "refresh.lock");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(lockPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "absent";
    throw error;
  }
  let lock: { pid: number } | undefined;
  try {
    lock = readLock(lockPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "absent";
    throw error;
  }
  if (lock) return isProcessAlive(lock.pid) ? "active" : "stale";
  return Date.now() - stat.mtimeMs > staleAfterMs ? "stale" : "active";
}

export function acquireRepositoryLock(
  directory: string,
  staleAfterMs: number = DEFAULT_REPOSITORY_LOCK_STALE_AFTER_MS,
): RepositoryLock {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, "refresh.lock");
  try {
    if (getRepositoryRefreshLockState(directory, staleAfterMs) === "stale") fs.unlinkSync(lockPath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  let file: number;
  try {
    file = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("A code RAG refresh is already running for this workspace");
    }
    throw error;
  }
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  fs.closeSync(file);

  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      try {
        fs.unlinkSync(lockPath);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    },
  };
}

function readLock(lockPath: string): { pid: number } | undefined {
  const contents = fs.readFileSync(lockPath, "utf-8");
  try {
    const value = JSON.parse(contents) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const pid = (value as { pid?: unknown }).pid;
    return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? { pid } : undefined;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}
