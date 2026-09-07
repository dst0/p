import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
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

  it("rejects a symlinked ledger without modifying its target", () => {
    const directory = temporaryDirectory();
    const target = join(directory, "other.json");
    const path = join(directory, "budget.json");
    writeFileSync(target, JSON.stringify(initial));
    symlinkSync(target, path);
    expect(() => new RunBudgetStorage(initial, path)).toThrow(/budget_storage_error/);
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(initial);
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
