import type { Model } from "@dst0/p-ai";
import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
  TASK_VERIFICATION_TIER_CUSTOM_TYPE,
  TaskVerificationTierRuntime,
} from "../../src/core/task-verification-tier-runtime.ts";
import { BEGIN_CODE_TASK_TOOL_NAME } from "../../src/core/tools/begin-code-task.ts";
import {
  type AdaptiveHarness,
  createAdaptiveHarness,
  initGitRepository,
  tools,
  writeWorkspaceFile,
} from "./adaptive-verification-fixture.ts";

describe("adaptive verification: persistence and overrides", () => {
  const harnesses: AdaptiveHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.harness.cleanup();
  });

  async function setup(options: Parameters<typeof createAdaptiveHarness>[0] = {}): Promise<AdaptiveHarness> {
    const adaptive = await createAdaptiveHarness({ settings: { compaction: { keepRecentTokens: 10 } }, ...options });
    harnesses.push(adaptive);
    writeWorkspaceFile(adaptive.harness.tempDir, "src/a.js", "export const value = 1;\n");
    initGitRepository(adaptive.harness.tempDir);
    return adaptive;
  }

  function restoredRuntime(adaptive: AdaptiveHarness): TaskVerificationTierRuntime {
    const runtime = new TaskVerificationTierRuntime({ configuredPolicy: "auto", persist: () => undefined });
    runtime.restore(adaptive.harness.sessionManager.getBranch());
    return runtime;
  }

  it("keeps the escalated tier restorable after compaction", async () => {
    const adaptive = await setup();
    adaptive.respond(
      tools(fauxToolCall("write", { path: "src/a.js", content: "export const value = 2;\n" })),
      tools(fauxToolCall("finish_work", { status: "partial", summary: "Edited src/a.js." })),
    );
    await adaptive.harness.session.prompt("Look at src/a.js.");
    adaptive.harness.session.agent.state.model = undefined as unknown as Model<string>;

    await adaptive.harness.session.compact();

    const tierEntries = adaptive.harness.sessionManager
      .getEntries()
      .filter((entry) => entry.type === "custom" && entry.customType === TASK_VERIFICATION_TIER_CUSTOM_TYPE);
    expect(tierEntries).toHaveLength(1);
    expect(adaptive.harness.sessionManager.getEntries().some((entry) => entry.type === "compaction")).toBe(true);
    const restored = restoredRuntime(adaptive);
    expect([restored.tier, restored.reason, restored.trigger]).toEqual(["strict", "effect_source", "src/a.js"]);
  });

  it("switches a live session to STRICT with /verify strict and persists the override", async () => {
    const adaptive = await setup();
    const session = adaptive.harness.session;

    expect(session.setVerificationPolicy("strict")).toMatchObject({
      policy: "strict",
      policyOverridden: true,
      tier: "strict",
      reason: "user_override",
    });
    expect(session.getActiveToolNames()).toEqual(
      expect.arrayContaining(["record_task_verification", "update_session_state", "sleep"]),
    );
    expect(session.getActiveToolNames()).not.toContain(BEGIN_CODE_TASK_TOOL_NAME);
    expect(session.agent.completionMode).toBe("explicit_finish");
    expect(session.systemPrompt).toContain("You must not end the task with a normal assistant message");
    expect(adaptive.harness.eventsOfType("verification_tier_changed")).toMatchObject([
      { policy: "strict", tier: "strict", previousTier: "light", reason: "user_override" },
    ]);

    adaptive.respond(
      fauxAssistantMessage("391"),
      tools(
        fauxToolCall("record_task_verification", {
          action: "record_completion_checklist",
          completion_checklist: ["The answer states 391"],
          verification_scope: "response_only",
        }),
      ),
      tools(fauxToolCall("finish_work", { status: "success", summary: "391" })),
    );
    await session.prompt("What is 17*23? Reply with just the number.");

    expect(adaptive.requests).toHaveLength(3);
    expect(
      adaptive.harness.eventsOfType("completion_protocol").some((event) => event.event === "missing_finish_work_retry"),
    ).toBe(true);
    const restored = restoredRuntime(adaptive);
    expect([restored.policy, restored.policyOverridden, restored.tier]).toEqual(["strict", true, "strict"]);
  });

  it("keeps a forced LIGHT session LIGHT after a source edit", async () => {
    const adaptive = await setup();
    const session = adaptive.harness.session;
    session.setVerificationPolicy("light");
    adaptive.respond(
      tools(fauxToolCall("write", { path: "src/a.js", content: "export const value = 2;\n" })),
      fauxAssistantMessage("Changed src/a.js."),
    );

    expect(session.getActiveToolNames()).not.toContain(BEGIN_CODE_TASK_TOOL_NAME);
    await session.prompt("Fix the off-by-one bug in src/a.js");

    expect(adaptive.requests).toHaveLength(2);
    expect(adaptive.requests[1]?.toolNames).not.toContain("finish_work");
    expect(session.getVerificationTierStatus()).toMatchObject({ policy: "light", tier: "light" });
    expect(session._taskVerificationRuntime?.controller.state.taskOwnedPaths).toEqual(["src/a.js"]);

    adaptive.respond(fauxAssistantMessage("value is 2."));
    await session.prompt("What is value now?");
    expect(session._taskVerificationRuntime?.controller.state.taskOwnedPaths ?? []).toEqual([]);
  });

  it("makes a session lighter than LIGHT when verification is switched off", async () => {
    const adaptive = await setup();
    const session = adaptive.harness.session;
    session.setVerificationPolicy("off");
    adaptive.respond(
      tools(fauxToolCall("write", { path: "src/a.js", content: "export const value = 2;\n" })),
      fauxAssistantMessage("Changed src/a.js."),
    );

    expect(session.getActiveToolNames()).not.toContain("sleep");
    expect(session.getActiveToolNames()).not.toContain(BEGIN_CODE_TASK_TOOL_NAME);
    await session.prompt("Fix the off-by-one bug in src/a.js");

    expect(session._taskVerificationRuntime?.enabled).toBe(false);
    expect(session.agent.completionMode).toBe("implicit");
    expect(session._taskVerificationRuntime?.controller.state.taskOwnedPaths ?? []).toEqual([]);
    expect(session.getVerificationTierStatus()).toMatchObject({ policy: "off", tier: "light", active: false });
    expect(adaptive.requests).toHaveLength(2);
    expect(adaptive.requests[1]?.toolNames).not.toContain("finish_work");
    expect(adaptive.requests[1]?.systemPrompt).not.toContain("<session_state_protocol>");
  });

  it("returns to the prior-driven tier after /verify auto", async () => {
    const adaptive = await setup();
    const session = adaptive.harness.session;
    session.setVerificationPolicy("strict");
    session.setVerificationPolicy("auto");
    adaptive.respond(fauxAssistantMessage("391"));

    await session.prompt("What is 17*23? Reply with just the number.");

    expect(session.getVerificationTierStatus()).toMatchObject({ policy: "auto", tier: "light", reason: "prior" });
    expect(adaptive.requests).toHaveLength(1);
    expect(adaptive.requests[0]?.toolNames).toContain(BEGIN_CODE_TASK_TOOL_NAME);
  });

  it("returns to the tier recorded on the branch selected by tree navigation", async () => {
    const adaptive = await setup();
    const session = adaptive.harness.session;
    adaptive.respond(
      fauxAssistantMessage("It exports value."),
      tools(fauxToolCall("write", { path: "src/a.js", content: "export const value = 2;\n" })),
      tools(fauxToolCall("finish_work", { status: "partial", summary: "Edited src/a.js." })),
    );
    await session.prompt("What does src/a.js export?");
    await session.prompt("Look at src/a.js.");
    expect(session.getVerificationTierStatus()?.tier).toBe("strict");

    const secondPrompt = adaptive.harness.sessionManager
      .getEntries()
      .filter((entry) => entry.type === "message" && entry.message.role === "user")[1];
    await session.navigateTree(secondPrompt!.id);

    expect(session.getVerificationTierStatus()).toMatchObject({ tier: "light", reason: "default" });
    expect(session.getActiveToolNames()).toContain(BEGIN_CODE_TASK_TOOL_NAME);
    expect(session.agent.completionMode).toBe("implicit");
  });
});
