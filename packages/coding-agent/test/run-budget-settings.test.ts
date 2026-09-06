import { describe, expect, it } from "vitest";
import { InMemorySettingsStorage, SettingsManager, type SettingsStorage } from "../src/core/settings-manager.ts";

const limited = { mode: "limited", unit: "requests", limit: 8 } as const;

describe("user-owned run budget settings", () => {
  it("requires a choice when only a project policy exists, and ignores project relaxation", () => {
    const storage = new InMemorySettingsStorage();
    storage.withLock("project", () => JSON.stringify({ runBudget: { mode: "unlimited" } }));
    expect(SettingsManager.fromStorage(storage).getRunBudgetPolicy()).toBeUndefined();
    storage.withLock("global", () => JSON.stringify({ runBudget: limited }));
    const manager = SettingsManager.fromStorage(storage);
    manager.applyOverrides({ runBudget: { mode: "unlimited" } });
    expect(manager.getRunBudgetPolicy()).toEqual(limited);
  });

  it("persists Unlimited as a complete replacement and preserves unrelated settings", async () => {
    const manager = SettingsManager.inMemory({ runBudget: limited, theme: "light" });
    await manager.setRunBudgetPolicy({ mode: "unlimited" });
    const reloaded = SettingsManager.fromStorage(manager.storage);
    expect(reloaded.getRunBudgetPolicy()).toEqual({ mode: "unlimited" });
    expect(reloaded.getGlobalSettings()).toEqual({ runBudget: { mode: "unlimited" }, theme: "light" });
    expect(manager.drainErrors()).toEqual([]);
  });

  it("does not let callers mutate the saved policy through either API boundary", async () => {
    const manager = SettingsManager.inMemory();
    const policy = { mode: "limited", unit: "tokens", limit: 1000 } as const;
    await manager.setRunBudgetPolicy(policy);
    const read = manager.getRunBudgetPolicy();
    if (read?.mode !== "limited") throw new Error("Expected limited policy");
    read.limit = 9999;
    expect(manager.getRunBudgetPolicy()).toEqual({ mode: "limited", unit: "tokens", limit: 1000 });
  });

  it.each(["throw", "discard"] as const)(
    "rejects a %s write instead of authorizing unsaved Unlimited",
    async (failure) => {
      const content = JSON.stringify({ runBudget: limited });
      const storage: SettingsStorage = {
        withLock(scope, callback) {
          if (scope === "project") {
            callback(undefined);
            return;
          }
          const next = callback(content);
          if (next === undefined) return;
          if (failure === "throw") throw new Error("Read-only settings storage");
        },
      };
      const manager = SettingsManager.fromStorage(storage);
      await expect(manager.setRunBudgetPolicy({ mode: "unlimited" })).rejects.toThrow(/budget|settings/i);
      expect(SettingsManager.fromStorage(storage).getRunBudgetPolicy()).toEqual(limited);
      expect(manager.getRunBudgetPolicy()).toEqual(limited);
    },
  );

  it("fails closed on malformed global policy and unreadable settings", () => {
    const storage = new InMemorySettingsStorage();
    storage.withLock("global", () => JSON.stringify({ runBudget: { mode: "limited", unit: "usd", limit: -1 } }));
    expect(() => SettingsManager.fromStorage(storage).getRunBudgetPolicy()).toThrow();
    storage.withLock("global", () => "{");
    expect(() => SettingsManager.fromStorage(storage).getRunBudgetPolicy()).toThrow();
  });
});
