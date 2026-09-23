import { describe, expect, it } from "vitest";
import {
  DEFAULT_TASK_VERIFICATION_CONFIGURATION,
  isTaskVerificationEngine,
  isTaskVerificationPolicy,
  isTaskVerificationSelection,
  migrateLegacyTaskVerificationMode,
  resolveTaskVerificationConfiguration,
  taskVerificationConfigurationFromSettings,
  taskVerificationEngineMode,
} from "../src/core/task-verification/verification-policy.ts";

describe("task verification policy", () => {
  it("defaults to auto with the evidence engine", () => {
    expect(DEFAULT_TASK_VERIFICATION_CONFIGURATION).toEqual({ policy: "auto", engine: "evidence" });
    expect(taskVerificationConfigurationFromSettings(undefined)).toEqual(DEFAULT_TASK_VERIFICATION_CONFIGURATION);
    expect(taskVerificationConfigurationFromSettings("strict")).toEqual(DEFAULT_TASK_VERIFICATION_CONFIGURATION);
  });

  it("reads each settings field independently", () => {
    expect(taskVerificationConfigurationFromSettings({ mode: "light" })).toEqual({
      policy: "light",
      engine: "evidence",
    });
    expect(taskVerificationConfigurationFromSettings({ engine: "audit" })).toEqual({ policy: "auto", engine: "audit" });
    expect(taskVerificationConfigurationFromSettings({ mode: "evidence", engine: "strict" })).toEqual(
      DEFAULT_TASK_VERIFICATION_CONFIGURATION,
    );
  });

  it("keeps the configured settings when no explicit selection is given", () => {
    const configured = { policy: "light", engine: "audit" } as const;
    expect(resolveTaskVerificationConfiguration(undefined, configured)).toBe(configured);
  });

  it("applies a policy selection while keeping the configured engine", () => {
    expect(resolveTaskVerificationConfiguration("strict", { policy: "auto", engine: "audit" })).toEqual({
      policy: "strict",
      engine: "audit",
    });
    expect(resolveTaskVerificationConfiguration("off", DEFAULT_TASK_VERIFICATION_CONFIGURATION)).toEqual({
      policy: "off",
      engine: "evidence",
    });
  });

  it("treats legacy engine selections as forced strict with that engine", () => {
    expect(resolveTaskVerificationConfiguration("evidence", { policy: "light", engine: "audit" })).toEqual({
      policy: "strict",
      engine: "evidence",
    });
    expect(resolveTaskVerificationConfiguration("audit", DEFAULT_TASK_VERIFICATION_CONFIGURATION)).toEqual({
      policy: "strict",
      engine: "audit",
    });
  });

  it("maps configurations to the controller engine mode", () => {
    expect(taskVerificationEngineMode({ policy: "off", engine: "audit" })).toBe("off");
    expect(taskVerificationEngineMode({ policy: "light", engine: "evidence" })).toBe("evidence");
    expect(taskVerificationEngineMode({ policy: "auto", engine: "audit" })).toBe("audit");
  });

  it("migrates only known legacy modes", () => {
    expect(migrateLegacyTaskVerificationMode("evidence")).toEqual({ mode: "strict", engine: "evidence" });
    expect(migrateLegacyTaskVerificationMode("audit")).toEqual({ mode: "strict", engine: "audit" });
    expect(migrateLegacyTaskVerificationMode("off")).toEqual({ mode: "off" });
    expect(migrateLegacyTaskVerificationMode("auto")).toBeUndefined();
    expect(migrateLegacyTaskVerificationMode(undefined)).toBeUndefined();
  });

  it("guards policy, engine, and selection values", () => {
    expect(["auto", "light", "strict", "off"].every(isTaskVerificationPolicy)).toBe(true);
    expect(isTaskVerificationPolicy("evidence")).toBe(false);
    expect(isTaskVerificationEngine("audit")).toBe(true);
    expect(isTaskVerificationEngine("off")).toBe(false);
    expect(isTaskVerificationSelection("evidence")).toBe(true);
    expect(isTaskVerificationSelection("light")).toBe(true);
    expect(isTaskVerificationSelection(3)).toBe(false);
  });
});
