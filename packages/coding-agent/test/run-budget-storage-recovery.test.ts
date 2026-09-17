import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunBudgetStorage } from "../src/core/run-budget/state-storage.ts";
import type { RunBudgetState } from "../src/core/run-budget/types.ts";

const initial: RunBudgetState = {
  version: 1,
  scopeId: "task",
  policy: { mode: "unlimited" },
  requests: 0,
  tokens: 0,
  usd: 0,
  pending: [],
  uncertainTokens: false,
  uncertainUsd: false,
};
const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "p-budget-storage-"));
  paths.push(path);
  return path;
}

describe("durable budget storage recovery", () => {
  it("rejects a ledger path that names its intended storage root", () => {
    const directory = temporaryDirectory();

    expect(() => new RunBudgetStorage(initial, directory, directory)).toThrow(
      "Budget path escapes its intended storage root",
    );
  });

  it("rejects a regular file used as the intended storage root", () => {
    const directory = temporaryDirectory();
    const root = join(directory, "not-a-directory");
    writeFileSync(root, "not a directory");

    expect(() => new RunBudgetStorage(initial, join(root, "budget.json"), root)).toThrow(/budget_storage_error/);
  });

  it("revalidates the bound root before reading a retargeted ledger path", () => {
    const directory = temporaryDirectory();
    const storage = new RunBudgetStorage(initial, join(directory, "budget.json"), directory);
    const internals = storage as unknown as { path: string };
    internals.path = join(directory, "..", "escaped-budget.json");

    expect(() => storage.read()).toThrow(/budget_storage_error/);
  });

  it("does not silently recreate a previously persisted ledger after deletion", () => {
    const path = join(temporaryDirectory(), "budget.json");
    const storage = new RunBudgetStorage(initial, path);
    storage.update((state) => {
      state.requests = 7;
    });
    unlinkSync(path);
    expect(() => storage.read()).toThrow(/budget_storage_error/);
    expect(() =>
      storage.update((state) => {
        state.requests++;
      }),
    ).toThrow(/budget_storage_error/);
  });

  it("reports a durable storage failure when the unique replacement path cannot be created", () => {
    const path = join(temporaryDirectory(), "b".repeat(230));
    const storage = new RunBudgetStorage(initial, path);
    expect(() =>
      storage.update((state) => {
        state.requests++;
      }),
    ).toThrow(/budget_storage_error/);
  });

  it("flushes the parent after creating the first budget directory", () => {
    const sessionDir = join(temporaryDirectory(), "session");
    mkdirSync(sessionDir);
    const budgetDir = join(sessionDir, ".budgets");
    const events: string[] = [];
    const storage = new RunBudgetStorage(initial, join(budgetDir, "budget.json"), undefined, {
      closeSync,
      existsSync,
      fsyncSync: (fd) => {
        events.push("fsync-parent");
        fsyncSync(fd);
      },
      mkdirSync: (path, options) => {
        events.push(`mkdir:${path}`);
        mkdirSync(path, options);
      },
      openSync: (path, flags, mode) => {
        events.push(`open:${path}`);
        return openSync(path, flags, mode);
      },
    });

    storage.update((state) => {
      state.requests++;
    });

    const canonicalSessionDir = realpathSync(sessionDir);
    expect(events.slice(0, 3)).toEqual([
      `mkdir:${join(canonicalSessionDir, ".budgets")}`,
      `open:${canonicalSessionDir}`,
      "fsync-parent",
    ]);
  });

  it("rejects a symlinked ledger without modifying its target", () => {
    const directory = temporaryDirectory();
    const target = join(directory, "other.json");
    const path = join(directory, "budget.json");
    writeFileSync(target, JSON.stringify(initial));
    symlinkSync(target, path);
    expect(() => new RunBudgetStorage(initial, path)).toThrow(/budget_storage_error/);
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(initial);
  });

  it("rejects a symlinked storage ancestor without writing outside the session tree", () => {
    const directory = temporaryDirectory();
    const outside = temporaryDirectory();
    const budgetDirectory = join(directory, ".budgets");
    const path = join(budgetDirectory, "task.json");
    symlinkSync(outside, budgetDirectory, "dir");

    expect(() => new RunBudgetStorage(initial, path, directory)).toThrow(/budget_storage_error/);
    expect(existsSync(join(outside, "task.json"))).toBe(false);
  });

  it("does not publish a stale update over an atomically replaced higher-spend ledger", () => {
    const directory = temporaryDirectory();
    const path = join(directory, "budget.json");
    const storage = new RunBudgetStorage(initial, path);
    storage.update((state) => {
      state.requests = 3;
    });

    expect(() =>
      storage.update((state) => {
        const replacement = { ...state, requests: 10 };
        const replacementPath = join(directory, "replacement.json");
        writeFileSync(replacementPath, `${JSON.stringify(replacement)}\n`);
        renameSync(replacementPath, path);
        state.requests = 4;
      }),
    ).toThrow(/budget_storage_error/);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ requests: 10 });
    expect(storage.read().requests).toBe(10);
  });

  it.each([
    null,
    { ...initial, scopeId: "another-task" },
    { ...initial, requests: -1 },
    { ...initial, tokens: 0.5 },
    { ...initial, pending: ["not-a-receipt"] },
    { ...initial, pending: ["00000000-0000-0000-0000-000000000000"] },
    {
      ...initial,
      requests: 2,
      pending: ["00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000"],
    },
    { ...initial, policy: { mode: "limited", unit: "requests", limit: 0 } },
  ])("rejects corrupt or foreign budget state rather than replacing it: %j", (record) => {
    const path = join(temporaryDirectory(), "budget.json");
    writeFileSync(path, JSON.stringify(record));
    expect(() => new RunBudgetStorage(initial, path)).toThrow(/budget_storage_error/);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(record);
  });
});
