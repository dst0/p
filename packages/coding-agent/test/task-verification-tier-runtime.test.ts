import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import type { TaskVerificationPolicy } from "../src/core/task-verification/verification-policy.ts";
import {
  describeTierCause,
  TASK_VERIFICATION_TIER_CUSTOM_TYPE,
  type TaskVerificationTierEntry,
  TaskVerificationTierRuntime,
  type VerificationTierTransition,
} from "../src/core/task-verification-tier-runtime.ts";

const CODE_PROMPT = "Fix the off-by-one bug in src/range.ts";
const QUESTION = "What is 17*23? Reply with just the number.";

function createRuntime(configuredPolicy: TaskVerificationPolicy, sessionManager = SessionManager.inMemory()) {
  const transitions: VerificationTierTransition[] = [];
  const runtime = new TaskVerificationTierRuntime({
    configuredPolicy,
    persist: (entry) => sessionManager.appendCustomEntry(TASK_VERIFICATION_TIER_CUSTOM_TYPE, entry),
  });
  runtime.setTransitionListener((transition) => transitions.push(transition));
  return { runtime, sessionManager, transitions };
}

function tierEntries(sessionManager: SessionManager): TaskVerificationTierEntry[] {
  return sessionManager
    .getBranch()
    .filter((entry) => entry.type === "custom" && entry.customType === TASK_VERIFICATION_TIER_CUSTOM_TYPE)
    .map((entry) => (entry as { data: TaskVerificationTierEntry }).data);
}

describe("verification tier runtime", () => {
  it.each([
    ["auto", "light"],
    ["light", "light"],
    ["off", "light"],
    ["strict", "strict"],
  ] as const)("starts %s sessions %s without persisting", (policy, tier) => {
    const { runtime, sessionManager } = createRuntime(policy);
    expect(runtime.tier).toBe(tier);
    expect(runtime.reason).toBe("default");
    expect(runtime.escalationEnabled).toBe(policy === "auto");
    expect(tierEntries(sessionManager)).toEqual([]);
  });

  it("recomputes the tier from the prior for each new prompt and persists only changes", () => {
    const { runtime, sessionManager, transitions } = createRuntime("auto");

    expect(runtime.beginPrompt(CODE_PROMPT, false)).toEqual({
      tier: "strict",
      reason: "prior",
      previousTier: "light",
      policy: "auto",
    });
    expect(runtime.beginPrompt("Refactor the loader to use async iterators", false)).toBeUndefined();
    expect(runtime.beginPrompt(QUESTION, false)).toMatchObject({ tier: "light", previousTier: "strict" });

    expect(tierEntries(sessionManager)).toEqual([
      { version: 1, policy: "auto", policyOverride: false, tier: "strict", reason: "prior" },
      { version: 1, policy: "auto", policyOverride: false, tier: "light", reason: "prior" },
    ]);
    expect(transitions.map((transition) => transition.tier)).toEqual(["strict", "light"]);
  });

  it("keeps the current tier for continuation nudges", () => {
    const { runtime, sessionManager } = createRuntime("auto");
    runtime.beginPrompt(CODE_PROMPT, false);

    expect(runtime.beginPrompt(QUESTION, true)).toBeUndefined();
    expect(runtime.tier).toBe("strict");
    expect(tierEntries(sessionManager)).toHaveLength(1);
  });

  it("escalates LIGHT to STRICT once and queues a bounded notice for effect escalations", () => {
    const { runtime, transitions } = createRuntime("auto");
    const longPath = `src/${"deep/".repeat(40)}file.ts`;

    const transition = runtime.escalate("effect_source", longPath);

    expect(transition).toMatchObject({ tier: "strict", reason: "effect_source", trigger: longPath });
    expect(runtime.trigger).toBe(longPath);
    const notice = runtime.takeNotice();
    expect(notice).toContain("<verification_tier>");
    expect(notice).toContain("Verification is now STRICT (source change: src/deep/");
    expect(notice?.length).toBeLessThanOrEqual(300);
    expect(runtime.takeNotice()).toBeUndefined();
    expect(runtime.escalate("effect_test", "src/a.test.ts")).toBeUndefined();
    expect(transitions).toHaveLength(1);
  });

  it("does not queue a notice for model-declared escalation", () => {
    const { runtime } = createRuntime("auto");

    expect(runtime.escalate("model_declared", "add slugify")).toMatchObject({ reason: "model_declared" });
    expect(runtime.takeNotice()).toBeUndefined();
  });

  it("drops a pending notice when a new prompt de-escalates before it was delivered", () => {
    const { runtime } = createRuntime("auto");
    runtime.escalate("effect_config", "package.json");

    runtime.beginPrompt(QUESTION, false);

    expect(runtime.tier).toBe("light");
    expect(runtime.takeNotice()).toBeUndefined();
  });

  it.each(["light", "strict", "off"] as const)("never escalates under the %s policy", (policy) => {
    const { runtime, sessionManager } = createRuntime(policy);
    const before = runtime.tier;

    expect(runtime.escalate("effect_source", "src/a.ts")).toBeUndefined();
    expect(runtime.tier).toBe(before);
    expect(tierEntries(sessionManager)).toEqual([]);
  });

  it("keeps forced policies stable across prompts", () => {
    const light = createRuntime("light");
    const strict = createRuntime("strict");

    expect(light.runtime.beginPrompt(CODE_PROMPT, false)).toBeUndefined();
    expect(strict.runtime.beginPrompt(QUESTION, false)).toBeUndefined();
    expect(light.runtime.tier).toBe("light");
    expect(strict.runtime.tier).toBe("strict");
  });

  it("applies and persists session overrides even when the tier does not change", () => {
    const { runtime, sessionManager } = createRuntime("auto");

    expect(runtime.setPolicyOverride("auto")).toMatchObject({ tier: "light", previousTier: "light", policy: "auto" });
    expect(runtime.setPolicyOverride("strict")).toMatchObject({ tier: "strict", previousTier: "light" });
    expect(runtime.policy).toBe("strict");
    expect(runtime.policyOverridden).toBe(true);
    expect(runtime.setPolicyOverride("off")).toMatchObject({ tier: "light", policy: "off" });
    expect(runtime.beginPrompt(CODE_PROMPT, false)).toBeUndefined();
    expect(runtime.reason).toBe("user_override");

    expect(tierEntries(sessionManager).map((entry) => [entry.policy, entry.policyOverride, entry.tier])).toEqual([
      ["auto", true, "light"],
      ["strict", true, "strict"],
      ["off", true, "light"],
    ]);
  });

  it("keeps the current tier when switching back to auto", () => {
    const { runtime } = createRuntime("strict");

    expect(runtime.setPolicyOverride("auto")).toMatchObject({ tier: "strict", previousTier: "strict" });
    expect(runtime.escalationEnabled).toBe(true);
  });

  it("restores the latest valid entry on the branch", () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendCustomEntry(TASK_VERIFICATION_TIER_CUSTOM_TYPE, {
      version: 1,
      policy: "auto",
      policyOverride: false,
      tier: "strict",
      reason: "effect_source",
      trigger: "src/a.ts",
    });
    sessionManager.appendCustomEntry(TASK_VERIFICATION_TIER_CUSTOM_TYPE, { version: 2, tier: "light" });
    sessionManager.appendCustomEntry("unrelated", { tier: "light" });

    const restored = createRuntime("auto", sessionManager).runtime;
    restored.restore(sessionManager.getBranch());

    expect(restored.tier).toBe("strict");
    expect(restored.reason).toBe("effect_source");
    expect(restored.trigger).toBe("src/a.ts");
    expect(restored.policyOverridden).toBe(false);
  });

  it("restores a session override and lets it decide the tier", () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendCustomEntry(TASK_VERIFICATION_TIER_CUSTOM_TYPE, {
      version: 1,
      policy: "strict",
      policyOverride: true,
      tier: "light",
      reason: "user_override",
    });

    const restored = createRuntime("auto", sessionManager).runtime;
    restored.restore(sessionManager.getBranch());

    expect(restored.policy).toBe("strict");
    expect(restored.tier).toBe("strict");
  });

  it("lets a changed configured policy win over a restored auto tier", () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendCustomEntry(TASK_VERIFICATION_TIER_CUSTOM_TYPE, {
      version: 1,
      policy: "auto",
      policyOverride: false,
      tier: "strict",
      reason: "prior",
    });

    const restored = createRuntime("light", sessionManager).runtime;
    restored.restore(sessionManager.getBranch());

    expect(restored.policy).toBe("light");
    expect(restored.tier).toBe("light");
  });

  it("leaves the initial state when nothing valid was persisted", () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendCustomEntry(TASK_VERIFICATION_TIER_CUSTOM_TYPE, "corrupt");
    const restored = createRuntime("strict", sessionManager).runtime;

    restored.restore(sessionManager.getBranch());

    expect(restored.tier).toBe("strict");
    expect(restored.reason).toBe("default");
  });

  it("describes causes for UI notes", () => {
    expect(describeTierCause("effect_test", "src/a.test.ts")).toBe("test change: src/a.test.ts");
    expect(describeTierCause("prior")).toBe("code task");
    expect(describeTierCause("default")).toBe("default");
  });
});
