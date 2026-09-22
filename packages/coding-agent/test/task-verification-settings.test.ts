import { describe, expect, it } from "vitest";
import { InMemorySettingsStorage, SettingsManager } from "../src/core/settings-manager.ts";

describe("task verification settings", () => {
  it("defaults to the auto policy with the evidence engine", () => {
    expect(SettingsManager.inMemory().getTaskVerificationConfiguration()).toEqual({
      policy: "auto",
      engine: "evidence",
    });
  });

  it.each([
    ["auto", "evidence"],
    ["light", "evidence"],
    ["strict", "audit"],
    ["off", "evidence"],
  ] as const)("reads mode %s with engine %s", (mode, engine) => {
    const manager = SettingsManager.inMemory({ taskVerification: { mode, engine } });

    expect(manager.getTaskVerificationConfiguration()).toEqual({ policy: mode, engine });
  });

  it("falls back field by field for invalid values", () => {
    const manager = SettingsManager.inMemory({ taskVerification: { mode: "full", engine: "semantic" } } as never);

    expect(manager.getTaskVerificationConfiguration()).toEqual({ policy: "auto", engine: "evidence" });
  });

  it.each([
    ["evidence", { mode: "strict", engine: "evidence" }],
    ["audit", { mode: "strict", engine: "audit" }],
    ["off", { mode: "off" }],
  ] as const)("migrates the legacy %s mode", (legacyMode, migrated) => {
    const storage = new InMemorySettingsStorage();
    storage.withLock("global", () => JSON.stringify({ taskVerificationMode: legacyMode }));
    const manager = SettingsManager.fromStorage(storage);

    expect(manager.globalSettings.taskVerification).toEqual(migrated);
    expect("taskVerificationMode" in manager.globalSettings).toBe(false);
  });

  it("drops an invalid legacy mode and keeps an explicit new block over the legacy key", () => {
    const invalid = new InMemorySettingsStorage();
    invalid.withLock("global", () => JSON.stringify({ taskVerificationMode: "full" }));
    const invalidManager = SettingsManager.fromStorage(invalid);
    expect(invalidManager.globalSettings.taskVerification).toBeUndefined();
    expect(invalidManager.getTaskVerificationConfiguration().policy).toBe("auto");

    const both = new InMemorySettingsStorage();
    both.withLock("global", () =>
      JSON.stringify({ taskVerificationMode: "audit", taskVerification: { mode: "light" } }),
    );
    expect(SettingsManager.fromStorage(both).getTaskVerificationConfiguration()).toEqual({
      policy: "light",
      engine: "evidence",
    });
  });

  it("does not allow project settings to override the global safety policy", () => {
    const storage = new InMemorySettingsStorage();
    storage.withLock("global", () => JSON.stringify({ taskVerification: { mode: "strict", engine: "audit" } }));
    storage.withLock("project", () => JSON.stringify({ taskVerification: { mode: "off" } }));

    expect(SettingsManager.fromStorage(storage).getTaskVerificationConfiguration()).toEqual({
      policy: "strict",
      engine: "audit",
    });

    const defaultStorage = new InMemorySettingsStorage();
    defaultStorage.withLock("project", () => JSON.stringify({ taskVerification: { mode: "off" } }));
    expect(SettingsManager.fromStorage(defaultStorage).getTaskVerificationConfiguration().policy).toBe("auto");
  });
});
