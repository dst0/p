import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { validateRunBudgetPolicy } from "../run-budget-policy.ts";
import { RunBudgetError } from "./error.ts";
import type { RunBudgetState } from "./types.ts";

interface PersistedObservation {
  content?: string;
  identity?: string;
  version?: string;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function fileIdentity(fd: number): string {
  const stat = fstatSync(fd, { bigint: true });
  return [stat.dev, stat.ino].join(":");
}

function fileVersion(fd: number): string {
  const stat = fstatSync(fd, { bigint: true });
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

function observePersistedFile(path: string): PersistedObservation {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fileVersion(fd);
    const content = readFileSync(fd, "utf8");
    const after = fileVersion(fd);
    if (before !== after) throw new Error("Budget record changed while being read");
    return { content, identity: fileIdentity(fd), version: after };
  } catch (error) {
    if (fd === undefined && isMissingFileError(error)) return {};
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function observationsMatch(left: PersistedObservation, right: PersistedObservation): boolean {
  return left.content === right.content && left.identity === right.identity && left.version === right.version;
}

function canonicalizePossiblyMissing(path: string): string {
  const missing: string[] = [];
  let current = resolve(path);
  while (true) {
    try {
      return join(realpathSync(current), ...missing);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

function escapesRoot(child: string): boolean {
  return child === ".." || child.startsWith("../") || child.startsWith("..\\") || isAbsolute(child);
}

function resolveBoundPath(path: string, intendedRoot?: string): { path: string; root: string } {
  const absolutePath = resolve(path);
  const absoluteRoot = resolve(intendedRoot ?? dirname(absolutePath));
  const child = relative(absoluteRoot, absolutePath);
  if (!child || escapesRoot(child)) {
    throw new Error("Budget path escapes its intended storage root");
  }
  const root = canonicalizePossiblyMissing(absoluteRoot);
  return { path: join(root, child), root };
}

function assertSafeStorageAncestors(root: string, path: string): void {
  const parentPath = dirname(path);
  const child = relative(root, parentPath);
  if (escapesRoot(child)) {
    throw new Error("Budget path escapes its intended storage root");
  }
  try {
    const rootStat = lstatSync(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("Unsafe budget storage root");
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
  let current = root;
  for (const segment of child.split(/[\\/]/).filter(Boolean)) {
    current = join(current, segment);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Unsafe budget storage ancestor");
    } catch (error) {
      if (isMissingFileError(error)) return;
      throw error;
    }
  }
}

function syncParentDirectory(path: string): void {
  // Windows does not support opening a directory handle through fs.openSync().
  // The replacement file itself is still fsynced before the atomic rename.
  if (process.platform === "win32") return;
  const directory = openSync(dirname(path), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

/** Small, frequently updated state: atomic JSON, never a buffered session entry. */
export class RunBudgetStorage {
  private state: RunBudgetState;
  private readonly path: string | undefined;
  private readonly root: string | undefined;
  private observation: PersistedObservation = {};
  private persisted = false;

  constructor(initial: RunBudgetState, path?: string, intendedRoot?: string) {
    this.state = structuredClone(initial);
    const bound = path ? resolveBoundPath(path, intendedRoot) : undefined;
    this.path = bound?.path;
    this.root = bound?.root;
    this.read();
  }

  get hasPersistedState(): boolean {
    return this.persisted;
  }

  read(): RunBudgetState {
    if (!this.path) return structuredClone(this.state);
    try {
      assertSafeStorageAncestors(this.root!, this.path);
      const observation = observePersistedFile(this.path);
      if (observation.content === undefined) {
        if (!this.persisted) {
          this.observation = observation;
          return structuredClone(this.state);
        }
        throw new Error("Persisted budget record disappeared");
      }
      const value: unknown = JSON.parse(observation.content);
      if (!value || typeof value !== "object") throw new Error("Invalid budget record");
      const record = value as Record<string, unknown>;
      if (
        record.version !== 1 ||
        record.scopeId !== this.state.scopeId ||
        typeof record.uncertainTokens !== "boolean" ||
        typeof record.uncertainUsd !== "boolean"
      ) {
        throw new Error("Invalid budget identity");
      }
      for (const key of ["requests", "tokens", "usd"] as const) {
        const amount = record[key];
        if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) throw new Error("Invalid spend");
        if (key !== "usd" && !Number.isSafeInteger(amount)) throw new Error("Invalid count");
      }
      if (
        !Array.isArray(record.pending) ||
        !record.pending.every((id) => typeof id === "string" && /^[\da-f-]{36}$/i.test(id)) ||
        new Set(record.pending).size !== record.pending.length ||
        record.pending.length > Number(record.requests)
      ) {
        throw new Error("Invalid pending receipts");
      }
      const next: RunBudgetState = {
        version: 1,
        scopeId: this.state.scopeId,
        policy: validateRunBudgetPolicy(record.policy),
        requests: Number(record.requests),
        tokens: Number(record.tokens),
        usd: Number(record.usd),
        pending: record.pending,
        uncertainTokens: record.uncertainTokens,
        uncertainUsd: record.uncertainUsd,
      };
      const unresolvedCallCleared =
        this.state.pending.some((id) => !next.pending.includes(id)) &&
        next.tokens === this.state.tokens &&
        !next.uncertainTokens;
      if (
        this.persisted &&
        (next.requests < this.state.requests ||
          next.tokens < this.state.tokens ||
          next.usd < this.state.usd ||
          (this.state.uncertainTokens && !next.uncertainTokens) ||
          (this.state.uncertainUsd && !next.uncertainUsd) ||
          unresolvedCallCleared)
      ) {
        throw new Error("Budget accounting cannot roll back");
      }
      this.state = next;
      this.observation = observation;
      this.persisted = true;
      return structuredClone(this.state);
    } catch {
      throw new RunBudgetError(
        "budget_storage_error",
        "Cannot verify the saved task budget; no new model call was admitted.",
      );
    }
  }

  update(change: (state: RunBudgetState) => void): RunBudgetState {
    let release: (() => void) | undefined;
    let temporary: string | undefined;
    let temporaryCreated = false;
    try {
      if (this.path) {
        assertSafeStorageAncestors(this.root!, this.path);
        mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
        assertSafeStorageAncestors(this.root!, this.path);
        release = lockfile.lockSync(this.path, { realpath: false });
      }
      const next = this.read();
      const expected = this.observation;
      change(next);
      if (this.path) {
        const content = `${JSON.stringify(next)}\n`;
        temporary = `${this.path}.${randomUUID()}.tmp`;
        const fd = openSync(temporary, "wx", 0o600);
        temporaryCreated = true;
        let temporaryIdentity: string;
        try {
          writeFileSync(fd, content);
          fsyncSync(fd);
          temporaryIdentity = fileIdentity(fd);
        } finally {
          closeSync(fd);
        }
        assertSafeStorageAncestors(this.root!, this.path);
        if (!observationsMatch(observePersistedFile(this.path), expected)) {
          throw new Error("Budget record changed before publication");
        }
        renameSync(temporary, this.path);
        this.persisted = true;
        temporary = undefined;
        syncParentDirectory(this.path);
        assertSafeStorageAncestors(this.root!, this.path);
        const published = observePersistedFile(this.path);
        if (published.content !== content || published.identity !== temporaryIdentity) {
          throw new Error("Budget record changed during publication");
        }
        this.observation = published;
      }
      this.state = next;
      return structuredClone(next);
    } catch (error) {
      if (error instanceof RunBudgetError) throw error;
      throw new RunBudgetError(
        "budget_storage_error",
        "Could not durably update the task budget; no new model call was admitted.",
      );
    } finally {
      try {
        if (temporary && temporaryCreated) unlinkSync(temporary);
      } finally {
        release?.();
      }
    }
  }
}
