import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseRunBudget, resolveStartupRunBudget } from "../src/cli/run-budget-choice.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("explicit first-use budget choice", () => {
  it("offers Unlimited without requiring a numeric limit", async () => {
    const select = vi.fn(async (_title: string, choices: string[]) => choices[0]);
    const input = vi.fn();
    expect(await chooseRunBudget({ select, input })).toEqual({ mode: "unlimited" });
    expect(select.mock.calls[0][1]).toEqual(["Unlimited — no spending ceiling", "Limited — set a task budget"]);
    expect(input).not.toHaveBeenCalled();
  });

  it.each(["requests", "tokens", "usd"] as const)("validates the %s amount and preserves cancel", async (unit) => {
    const select = vi
      .fn()
      .mockResolvedValueOnce("Limited — set a task budget")
      .mockImplementationOnce(
        async (_title: string, choices: string[]) => choices[["requests", "tokens", "usd"].indexOf(unit)],
      );
    const input = vi
      .fn()
      .mockResolvedValueOnce("0")
      .mockResolvedValueOnce(unit === "usd" ? "0.50" : "100");
    expect(await chooseRunBudget({ select, input })).toEqual({
      mode: "limited",
      unit,
      limit: unit === "usd" ? 0.5 : 100,
    });
    expect(input).toHaveBeenCalledTimes(2);
    expect(input.mock.calls[1][0]).toContain("Invalid");
  });

  it.each(["mode", "unit", "amount"])("does not authorize Unlimited when cancelling at %s", async (stage) => {
    const select = vi
      .fn()
      .mockResolvedValueOnce(stage === "mode" ? undefined : "Limited — set a task budget")
      .mockResolvedValueOnce(stage === "unit" ? undefined : "Model requests");
    expect(await chooseRunBudget({ select, input: vi.fn().mockResolvedValue(undefined) })).toBeUndefined();
  });

  it("reuses only the saved global choice in noninteractive mode", async () => {
    const settings = SettingsManager.inMemory({ runBudget: { mode: "unlimited" } });
    expect(await resolveStartupRunBudget(settings, "print")).toEqual({ mode: "unlimited" });
    expect(await resolveStartupRunBudget(settings, "json", { mode: "limited", unit: "requests", limit: 3 })).toEqual({
      mode: "limited",
      unit: "requests",
      limit: 3,
    });
    expect(settings.getRunBudgetPolicy()).toEqual({ mode: "unlimited" });
  });

  it("returns an actionable machine-readable error before a noninteractive task without a choice", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resolveStartupRunBudget(SettingsManager.inMemory(), "json")).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ type: "error", code: "budget_required" });
  });
});
