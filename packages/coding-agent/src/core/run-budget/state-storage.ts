import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import { validateRunBudgetPolicy } from "../run-budget-policy.ts";
import { RunBudgetError } from "./error.ts";
import type { RunBudgetState } from "./types.ts";

/** Small, frequently updated state: atomic JSON, never a buffered session entry. */
export class RunBudgetStorage {
  private state: RunBudgetState;
  private readonly path: string | undefined;
  private persisted = false;

  constructor(initial: RunBudgetState, path?: string) {
    this.state = structuredClone(initial);
    this.path = path;
    this.read();
  }

  read(): RunBudgetState {
    if (!this.path) return structuredClone(this.state);
    let fd: number | undefined;
    try {
      fd = openSync(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const value: unknown = JSON.parse(readFileSync(fd, "utf8"));
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
      this.state = {
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
      this.persisted = true;
      return structuredClone(this.state);
    } catch (error) {
      if (
        !this.persisted &&
        fd === undefined &&
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return structuredClone(this.state);
      }
      throw new RunBudgetError(
        "budget_storage_error",
        "Cannot verify the saved task budget; no new model call was admitted.",
      );
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  update(change: (state: RunBudgetState) => void): RunBudgetState {
    let release: (() => void) | undefined;
    let temporary: string | undefined;
    let temporaryCreated = false;
    try {
      if (this.path) {
        mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
        release = lockfile.lockSync(this.path, { realpath: false });
      }
      const next = this.read();
      change(next);
      if (this.path) {
        temporary = `${this.path}.${randomUUID()}.tmp`;
        const fd = openSync(temporary, "wx", 0o600);
        temporaryCreated = true;
        try {
          writeFileSync(fd, `${JSON.stringify(next)}\n`);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        renameSync(temporary, this.path);
        this.persisted = true;
        temporary = undefined;
        const directory = openSync(dirname(this.path), "r");
        try {
          fsyncSync(directory);
        } finally {
          closeSync(directory);
        }
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
      if (temporary && temporaryCreated) unlinkSync(temporary);
      release?.();
    }
  }
}
