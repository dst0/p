import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { BEGIN_CODE_TASK_TOOL_NAME } from "../../src/core/tools/begin-code-task.ts";
import {
  type AdaptiveHarness,
  createAdaptiveHarness,
  initGitRepository,
  tools,
  writeWorkspaceFile,
} from "./adaptive-verification-fixture.ts";

const BEGIN = fauxToolCall(BEGIN_CODE_TASK_TOOL_NAME, {
  goal: "Make src/a.js export value 2",
  checklist: ["src/a.js exports value 2"],
});
const WRITE_A = fauxToolCall("write", { path: "src/a.js", content: "export const value = 2;\n" });

describe("adaptive verification: begin_code_task", () => {
  const harnesses: AdaptiveHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.harness.cleanup();
  });

  async function setupRepository(options: Parameters<typeof createAdaptiveHarness>[0] = {}): Promise<AdaptiveHarness> {
    const adaptive = await createAdaptiveHarness(options);
    harnesses.push(adaptive);
    writeWorkspaceFile(adaptive.harness.tempDir, "src/a.js", "export const value = 1;\n");
    initGitRepository(adaptive.harness.tempDir);
    return adaptive;
  }

  function toolOutcomes(adaptive: AdaptiveHarness): Array<[string, boolean]> {
    return adaptive.harness.eventsOfType("tool_execution_end").map((event) => [event.toolName, event.isError]);
  }

  it("escalates, records the checklist, and unblocks the edit batched after it", async () => {
    const adaptive = await setupRepository();
    adaptive.respond(
      tools(BEGIN, WRITE_A),
      tools(fauxToolCall("finish_work", { status: "partial", summary: "Changed src/a.js; tests pending." })),
    );

    await adaptive.harness.session.prompt("Look at src/a.js.");

    expect(toolOutcomes(adaptive).slice(0, 2)).toEqual([
      [BEGIN_CODE_TASK_TOOL_NAME, false],
      ["write", false],
    ]);
    expect(adaptive.harness.session._taskVerificationRuntime?.controller.state.completionChecklist?.criteria).toEqual([
      "src/a.js exports value 2",
    ]);
    const escalated = adaptive.requests[1];
    expect(escalated?.toolNames).toEqual(expect.arrayContaining(["record_task_verification", "finish_work"]));
    expect(escalated?.toolNames).not.toContain(BEGIN_CODE_TASK_TOOL_NAME);
    expect(escalated?.messageTexts.join("\n")).not.toContain("<verification_tier>");
    expect(adaptive.harness.session.getVerificationTierStatus()).toMatchObject({
      tier: "strict",
      reason: "model_declared",
      trigger: "Make src/a.js export value 2",
    });
  });

  it("drops the effect notice when begin_code_task follows the edit in the same batch", async () => {
    const adaptive = await setupRepository();
    adaptive.respond(
      tools(WRITE_A, BEGIN),
      tools(fauxToolCall("finish_work", { status: "partial", summary: "Changed src/a.js; tests pending." })),
    );

    await adaptive.harness.session.prompt("Look at src/a.js.");

    expect(toolOutcomes(adaptive).slice(0, 2)).toEqual([
      ["write", false],
      [BEGIN_CODE_TASK_TOOL_NAME, false],
    ]);
    expect(adaptive.harness.session.getVerificationTierStatus()?.reason).toBe("effect_source");
    expect(adaptive.harness.session._taskVerificationRuntime?.controller.state.completionChecklist).toBeDefined();
    expect(adaptive.requests[1]?.messageTexts.join("\n")).not.toContain("<verification_tier>");
  });

  it("reports a rejected checklist but still escalates", async () => {
    const adaptive = await setupRepository();
    adaptive.respond(
      tools(fauxToolCall(BEGIN_CODE_TASK_TOOL_NAME, { goal: "Fix a.js", checklist: ["All tests pass"] })),
      fauxAssistantMessage("I will ask first: which behavior is wrong?"),
    );

    await adaptive.harness.session.prompt("Look at src/a.js.");

    const result = adaptive.harness.eventsOfType("tool_execution_end")[0];
    expect(JSON.stringify(result?.result.content)).toContain("The checklist was not recorded");
    expect(adaptive.harness.session._taskVerificationRuntime?.controller.state.completionChecklist).toBeUndefined();
    expect(adaptive.harness.session.getVerificationTierStatus()?.tier).toBe("strict");
    expect(adaptive.requests).toHaveLength(2);
  });

  it("leaves the audit engine's checklist protocol to record_task_verification", async () => {
    const adaptive = await setupRepository({ settings: { taskVerification: { engine: "audit" } } });
    adaptive.respond(tools(BEGIN), fauxAssistantMessage("Which behavior should change?"));

    await adaptive.harness.session.prompt("Look at src/a.js.");

    const result = adaptive.harness.eventsOfType("tool_execution_end")[0];
    expect(JSON.stringify(result?.result.content)).toContain("Follow the record_task_verification guidance");
    expect(adaptive.harness.session.getVerificationTierStatus()).toMatchObject({ policy: "auto", tier: "strict" });
    expect(adaptive.requests[1]?.toolNames).toEqual(
      expect.arrayContaining(["record_task_verification", "record_requirement_audit"]),
    );
  });
});
