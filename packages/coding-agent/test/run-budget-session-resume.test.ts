import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionRunBudget } from "../src/core/run-budget/session-run-budget.ts";
import { SessionManager } from "../src/core/session-manager.ts";

function createPersistedSession(root: string) {
  const manager = SessionManager.create(root, join(root, "sessions"));
  manager.appendMessage({
    role: "assistant",
    api: "test",
    provider: "test",
    model: "test",
    content: [{ type: "text", text: "Persist session identity" }],
    stopReason: "stop",
    timestamp: 0,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  const path = manager.getSessionFile();
  if (!path) throw new Error("Expected persisted session");
  return { manager, path };
}

describe("persisted session budget resume", () => {
  it("uses every filename-safe session id supported by SessionManager", () => {
    const root = mkdtempSync(join(tmpdir(), "p-budget-custom-id-"));
    try {
      const manager = SessionManager.create(root, join(root, "sessions"), { id: "abc-123_def.456" });
      const budget = new SessionRunBudget(manager, { runBudget: { mode: "unlimited" } });

      expect(budget.policy).toEqual({ mode: "unlimited" });
      expect(readFileSync(join(manager.getSessionDir(), ".budgets", "abc-123_def.456.json"), "utf8")).toContain(
        '"scopeId":"abc-123_def.456"',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(["../escape", "a/b", "a\\b", ".hidden", "trailing."])(
    "rejects a non-filename-safe session budget id: %s",
    (id) => {
      const manager = SessionManager.inMemory();
      manager.sessionId = id;
      expect(() => new SessionRunBudget(manager, { runBudget: { mode: "unlimited" } })).toThrow(/budget_storage_error/);
    },
  );

  it("discovers a persisted policy without changing the ledger", () => {
    const root = mkdtempSync(join(tmpdir(), "p-budget-startup-resume-"));
    try {
      const { manager, path } = createPersistedSession(root);
      const policy = { mode: "limited", unit: "requests", limit: 7 } as const;
      const budget = new SessionRunBudget(manager, { runBudget: policy });
      const before = budget.snapshot();
      const reopened = SessionManager.open(path, manager.getSessionDir());

      expect(SessionRunBudget.getPersistedPolicy(reopened)).toEqual(policy);
      expect(new SessionRunBudget(reopened).snapshot()).toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed if a discovered ledger disappears", () => {
    const root = mkdtempSync(join(tmpdir(), "p-budget-startup-race-"));
    try {
      const { manager, path } = createPersistedSession(root);
      const policy = { mode: "limited", unit: "requests", limit: 7 } as const;
      new SessionRunBudget(manager, { runBudget: policy }).setPolicy(policy);
      const reopened = SessionManager.open(path, manager.getSessionDir());
      expect(SessionRunBudget.getPersistedPolicy(reopened)).toEqual(policy);

      unlinkSync(join(reopened.getSessionDir(), ".budgets", `${reopened.getSessionId()}.json`));
      expect(() =>
        new SessionRunBudget(reopened, {
          defaultRunBudget: { mode: "unlimited" },
          requireDefaultRunBudget: true,
        }).snapshot(),
      ).toThrow(/budget_storage_error/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects replacement of a discovered ledger with lower recorded spend", () => {
    const root = mkdtempSync(join(tmpdir(), "p-budget-startup-replace-"));
    try {
      const { manager, path } = createPersistedSession(root);
      const policy = { mode: "limited", unit: "requests", limit: 7 } as const;
      new SessionRunBudget(manager, { runBudget: policy }).setPolicy(policy);
      const budgetPath = join(manager.getSessionDir(), ".budgets", `${manager.getSessionId()}.json`);
      const spent = JSON.parse(readFileSync(budgetPath, "utf8"));
      spent.requests = 3;
      writeFileSync(budgetPath, `${JSON.stringify(spent)}\n`);
      const reopened = SessionManager.open(path, manager.getSessionDir());
      expect(SessionRunBudget.getPersistedPolicy(reopened)).toEqual(policy);

      spent.requests = 0;
      const replacement = `${budgetPath}.replacement`;
      writeFileSync(replacement, `${JSON.stringify(spent)}\n`);
      renameSync(replacement, budgetPath);
      expect(() => new SessionRunBudget(reopened, { requireDefaultRunBudget: true }).snapshot()).toThrow(
        /budget_storage_error/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(["durable uncertainty", "unresolved call"] as const)(
    "rejects replacement that clears %s after discovery",
    (stateToClear) => {
      const root = mkdtempSync(join(tmpdir(), "p-budget-startup-safety-state-"));
      try {
        const { manager, path } = createPersistedSession(root);
        const policy = { mode: "limited", unit: "usd", limit: 1 } as const;
        new SessionRunBudget(manager, { runBudget: policy }).setPolicy(policy);
        const budgetPath = join(manager.getSessionDir(), ".budgets", `${manager.getSessionId()}.json`);
        const state = JSON.parse(readFileSync(budgetPath, "utf8"));
        if (stateToClear === "durable uncertainty") {
          state.uncertainUsd = true;
        } else {
          state.requests = 1;
          state.pending = ["00000000-0000-4000-8000-000000000000"];
        }
        writeFileSync(budgetPath, `${JSON.stringify(state)}\n`);
        const reopened = SessionManager.open(path, manager.getSessionDir());
        expect(SessionRunBudget.getPersistedPolicy(reopened)).toEqual(policy);

        state.uncertainUsd = false;
        state.pending = [];
        const replacement = `${budgetPath}.replacement`;
        writeFileSync(replacement, `${JSON.stringify(state)}\n`);
        renameSync(replacement, budgetPath);
        expect(() => new SessionRunBudget(reopened, { requireDefaultRunBudget: true }).snapshot()).toThrow(
          /budget_storage_error/,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("distinguishes an absent startup ledger from a corrupt one", () => {
    const root = mkdtempSync(join(tmpdir(), "p-budget-startup-ledger-"));
    try {
      const { manager } = createPersistedSession(root);
      expect(SessionRunBudget.getPersistedPolicy(manager)).toBeUndefined();
      mkdirSync(join(manager.getSessionDir(), ".budgets"), { recursive: true });
      writeFileSync(join(manager.getSessionDir(), ".budgets", `${manager.getSessionId()}.json`), "not-json");
      expect(() => SessionRunBudget.getPersistedPolicy(manager)).toThrow(/budget_storage_error/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
