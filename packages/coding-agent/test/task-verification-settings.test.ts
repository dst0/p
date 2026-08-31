import { describe, expect, it } from "vitest";
import { InMemorySettingsStorage, SettingsManager } from "../src/core/settings-manager.ts";

describe("task verification settings", () => {
  it("defaults to evidence mode", () => {
    expect(SettingsManager.inMemory().getTaskVerificationMode()).toBe("evidence");
  });

  it.each(["evidence", "audit", "off"] as const)("reads %s mode", (taskVerificationMode) => {
    const manager = SettingsManager.inMemory({ taskVerificationMode });

    expect(manager.getTaskVerificationMode()).toBe(taskVerificationMode);
  });

  it("falls back to evidence for an invalid mode", () => {
    const manager = SettingsManager.inMemory({ taskVerificationMode: "full" } as never);

    expect(manager.getTaskVerificationMode()).toBe("evidence");
  });

  it("does not allow project settings to override the global safety policy", () => {
    const storage = new InMemorySettingsStorage();
    storage.withLock("global", () => JSON.stringify({ taskVerificationMode: "audit" }));
    storage.withLock("project", () => JSON.stringify({ taskVerificationMode: "off" }));

    expect(SettingsManager.fromStorage(storage).getTaskVerificationMode()).toBe("audit");

    const defaultStorage = new InMemorySettingsStorage();
    defaultStorage.withLock("project", () => JSON.stringify({ taskVerificationMode: "off" }));
    expect(SettingsManager.fromStorage(defaultStorage).getTaskVerificationMode()).toBe("evidence");
  });
});
