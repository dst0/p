import { admitModelCall, getModel } from "@dst0/p-ai";
import { describe, expect, it, vi } from "vitest";
import { SessionRunBudget } from "../src/core/run-budget/session-run-budget.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { handleBudgetCommand } from "../src/modes/interactive/interactive-mode/interactivemode-methods/budget-command.ts";

function fixture() {
  const policy = { mode: "limited", unit: "requests", limit: 1 } as const;
  const runBudget = new SessionRunBudget(SessionManager.inMemory(), { runBudget: policy });
  runBudget.run(() =>
    admitModelCall({ kind: "text", model: getModel("openai", "gpt-4o-mini") })?.settle({
      input: 3,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 5,
      cost: { input: 0.0001, output: 0.0001, cacheRead: 0, cacheWrite: 0, total: 0.0002 },
    }),
  );
  const settingsManager = SettingsManager.inMemory({ runBudget: policy });
  const select = vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined);
  const input = vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined);
  const self = {
    session: { runBudget, isStreaming: false, isCompacting: false, isRetrying: false },
    settingsManager,
    createExtensionUIContext: () => ({ select, input }),
    showStatus: vi.fn(),
    showWarning: vi.fn(),
    showError: vi.fn(),
    footer: { invalidate: vi.fn() },
    ui: { requestRender: vi.fn() },
  };
  return { self, select, input };
}

describe("interactive task budget controls", () => {
  it("shows actual exhausted spend without opening a selector or changing policy", async () => {
    const { self, select } = fixture();
    const before = self.session.runBudget.snapshot();
    await handleBudgetCommand(self, "/budget status");
    expect(self.showStatus).toHaveBeenCalledWith(expect.stringContaining("1 model requests; 5 tokens"));
    expect(self.showStatus).toHaveBeenCalledWith(expect.stringContaining("[exhausted]"));
    expect(self.session.runBudget.snapshot()).toEqual(before);
    expect(select).not.toHaveBeenCalled();
    expect(self.ui.requestRender).not.toHaveBeenCalled();
  });

  it("saves Unlimited, preserves exhausted spend and scope, and does not resume work", async () => {
    const { self } = fixture();
    const before = self.session.runBudget.snapshot();
    await handleBudgetCommand(self, "/budget unlimited");
    expect(self.session.runBudget.snapshot()).toMatchObject({
      scopeId: before.scopeId,
      requests: 1,
      tokens: 5,
      usd: before.usd,
      policy: { mode: "unlimited" },
      status: "ready",
    });
    expect(SettingsManager.fromStorage(self.settingsManager.storage).getRunBudgetPolicy()).toEqual({
      mode: "unlimited",
    });
    expect(self.showStatus).toHaveBeenLastCalledWith(expect.stringContaining("work has not resumed"));
    expect(self.ui.requestRender).toHaveBeenCalledOnce();
    expect(self.footer.invalidate).toHaveBeenCalledOnce();
  });

  it("cancels the existing selector without spending or saving a default", async () => {
    const { self, select } = fixture();
    const before = self.session.runBudget.snapshot();
    await handleBudgetCommand(self, "/budget");
    expect(select).toHaveBeenCalledOnce();
    expect(self.session.runBudget.snapshot()).toEqual(before);
    expect(self.settingsManager.getRunBudgetPolicy()).toEqual(before.policy);
    expect(self.showError).not.toHaveBeenCalled();
  });

  it("applies a valid limited selection with retained usage", async () => {
    const { self, select, input } = fixture();
    select.mockResolvedValueOnce("Limited — set a task budget").mockResolvedValueOnce("Cumulative tokens");
    input.mockResolvedValueOnce("20");
    await handleBudgetCommand(self, "/budget");
    expect(self.session.runBudget.snapshot()).toMatchObject({
      requests: 1,
      tokens: 5,
      policy: { mode: "limited", unit: "tokens", limit: 20 },
    });
    expect(self.showError).not.toHaveBeenCalled();
  });

  it.each(["isStreaming", "isCompacting", "isRetrying"] as const)("rejects mutation during %s", async (flag) => {
    const { self, select } = fixture();
    self.session[flag] = true;
    const before = self.session.runBudget.snapshot();
    await handleBudgetCommand(self, "/budget unlimited");
    expect(self.showWarning).toHaveBeenCalledOnce();
    expect(self.session.runBudget.snapshot()).toEqual(before);
    expect(select).not.toHaveBeenCalled();
  });

  it("rejects invalid limits without changing either stored policy", async () => {
    const { self } = fixture();
    const before = self.session.runBudget.snapshot();
    await handleBudgetCommand(self, "/budget requests:-1");
    expect(self.showError).toHaveBeenCalledOnce();
    expect(self.session.runBudget.snapshot()).toEqual(before);
    expect(self.settingsManager.getRunBudgetPolicy()).toEqual(before.policy);
  });

  it("does not relax the active limit when saving the default fails", async () => {
    const { self } = fixture();
    const before = self.session.runBudget.snapshot();
    vi.spyOn(self.settingsManager, "setRunBudgetPolicy").mockRejectedValue(new Error("Settings are read-only"));
    await handleBudgetCommand(self, "/budget unlimited");
    expect(self.session.runBudget.snapshot()).toEqual(before);
    expect(self.showError).toHaveBeenCalledWith("Settings are read-only");
    expect(self.ui.requestRender).not.toHaveBeenCalled();
  });

  it("reports a partially saved default honestly when active ledger persistence fails", async () => {
    const { self } = fixture();
    const before = self.session.runBudget.snapshot();
    vi.spyOn(self.session.runBudget, "setPolicy").mockImplementation(() => {
      throw new Error("Ledger unavailable");
    });
    await handleBudgetCommand(self, "/budget unlimited");
    expect(self.settingsManager.getRunBudgetPolicy()).toEqual({ mode: "unlimited" });
    expect(self.session.runBudget.snapshot()).toEqual(before);
    expect(self.showError).toHaveBeenCalledWith(
      expect.stringContaining("Default saved, but the active task budget could not be changed"),
    );
    expect(self.ui.requestRender).not.toHaveBeenCalled();
  });
});
