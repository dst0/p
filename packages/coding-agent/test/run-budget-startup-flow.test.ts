import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStartupChoices } from "../src/cli/run-budget-choice.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const ui = vi.hoisted(() => ({ required: vi.fn(), select: vi.fn(), input: vi.fn(), setup: vi.fn() }));
vi.mock("../src/cli/startup-ui.ts", () => ({
  shouldRunFirstTimeSetup: ui.required,
  showStartupSelector: ui.select,
  showStartupInput: ui.input,
  showFirstTimeSetup: ui.setup,
}));
beforeEach(() => {
  vi.resetAllMocks();
  ui.required.mockReturnValue(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("budget-first startup sequencing", () => {
  it("records first-use eligibility before saving a budget and shows other setup only afterward", async () => {
    const settings = SettingsManager.inMemory();
    ui.required.mockImplementation(() => settings.getRunBudgetPolicy() === undefined);
    ui.select.mockResolvedValueOnce("Limited — set a task budget").mockResolvedValueOnce("Cumulative tokens");
    ui.input.mockResolvedValueOnce("1200");
    ui.setup.mockImplementation(async () => {
      expect(SettingsManager.fromStorage(settings.storage).getRunBudgetPolicy()).toEqual({
        mode: "limited",
        unit: "tokens",
        limit: 1200,
      });
    });
    expect(await resolveStartupChoices(settings, "interactive")).toEqual({
      mode: "limited",
      unit: "tokens",
      limit: 1200,
    });
    expect(ui.required).toHaveBeenCalledOnce();
    expect(ui.setup).toHaveBeenCalledOnce();
    expect(ui.select.mock.calls[0][2]).toEqual([
      { label: "Unlimited — no spending ceiling", value: "Unlimited — no spending ceiling" },
      { label: "Limited — set a task budget", value: "Limited — set a task budget" },
    ]);
    expect(ui.input.mock.calls[0][1]).toContain("final response can exceed");
  });

  it("keeps Unlimited on later launches without showing any new picker", async () => {
    const settings = SettingsManager.inMemory();
    ui.select.mockResolvedValue("Unlimited — no spending ceiling");
    await resolveStartupChoices(settings, "interactive");
    ui.select.mockClear();
    expect(await resolveStartupChoices(SettingsManager.fromStorage(settings.storage), "interactive")).toEqual({
      mode: "unlimited",
    });
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.setup).not.toHaveBeenCalled();
  });

  it("does not run further setup or save permission after cancellation", async () => {
    const settings = SettingsManager.inMemory();
    ui.required.mockReturnValue(true);
    ui.select.mockResolvedValue(undefined);
    expect(await resolveStartupChoices(settings, "interactive")).toBeUndefined();
    expect(settings.getRunBudgetPolicy()).toBeUndefined();
    expect(ui.setup).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("does not authorize a task or open further setup if the selected policy cannot be saved", async () => {
    const settings = SettingsManager.inMemory();
    ui.required.mockReturnValue(true);
    ui.select.mockResolvedValue("Unlimited — no spending ceiling");
    vi.spyOn(settings, "setRunBudgetPolicy").mockRejectedValue(new Error("Budget settings storage denied"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resolveStartupChoices(settings, "interactive")).toBeUndefined();
    expect(error).toHaveBeenCalledWith("Budget settings storage denied");
    expect(ui.setup).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("never opens terminal UI for explicit automation policies", async () => {
    expect(await resolveStartupChoices(SettingsManager.inMemory(), "rpc", { mode: "unlimited" })).toEqual({
      mode: "unlimited",
    });
    expect(ui.required).not.toHaveBeenCalled();
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.setup).not.toHaveBeenCalled();
  });
});
