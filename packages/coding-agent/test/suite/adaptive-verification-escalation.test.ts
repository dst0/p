import { readFileSync } from "node:fs";
import { join } from "node:path";
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

const VERIFY_A =
  "node -e \"const fs=require('fs');if(!fs.readFileSync('src/a.js','utf8').includes('value = 2'))process.exit(1);console.log('value is 2')\"";

describe("adaptive verification: escalation to STRICT", () => {
  const harnesses: AdaptiveHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.harness.cleanup();
  });

  async function setupRepository(): Promise<AdaptiveHarness> {
    const adaptive = await createAdaptiveHarness();
    harnesses.push(adaptive);
    writeWorkspaceFile(adaptive.harness.tempDir, "src/a.js", "export const value = 1;\n");
    initGitRepository(adaptive.harness.tempDir);
    return adaptive;
  }

  function protocolEvents(adaptive: AdaptiveHarness): string[] {
    return adaptive.harness.eventsOfType("completion_protocol").map((event) => event.event);
  }

  it("escalates an undeclared source edit mid-run and then requires evidence before finish", async () => {
    const adaptive = await setupRepository();
    adaptive.respond(
      tools(fauxToolCall("write", { path: "src/a.js", content: "export const value = 2;\n" })),
      fauxAssistantMessage("Changed src/a.js."),
      tools(
        fauxToolCall("record_task_verification", {
          action: "record_completion_checklist",
          completion_checklist: ["src/a.js exports value 2"],
        }),
      ),
      tools(fauxToolCall("bash", { command: VERIFY_A })),
      tools(fauxToolCall("record_task_verification", { action: "ready_to_finish", unresolved_failures: [] })),
      tools(fauxToolCall("finish_work", { status: "success", summary: "src/a.js now exports value 2." })),
    );

    await adaptive.harness.session.prompt("Look at src/a.js.");

    const [light, escalated] = adaptive.requests;
    expect(light?.toolNames).not.toContain("record_task_verification");
    expect(escalated?.toolNames).toEqual(expect.arrayContaining(["record_task_verification", "finish_work"]));
    expect(escalated?.toolNames).not.toContain(BEGIN_CODE_TASK_TOOL_NAME);
    expect(escalated?.systemPrompt).toContain("explicit completion mode");
    const notice = escalated?.messageTexts.at(-1) ?? "";
    expect(notice).toContain("<verification_tier>");
    expect(notice).toContain("source change: src/a.js");
    expect(adaptive.harness.eventsOfType("verification_tier_changed")).toMatchObject([
      { tier: "strict", previousTier: "light", reason: "effect_source", trigger: "src/a.js" },
    ]);
    expect(protocolEvents(adaptive)).toEqual(["completion_mode", "missing_finish_work_retry", "finish_work_called"]);
    expect(adaptive.requests).toHaveLength(6);
    const finish = adaptive.harness
      .eventsOfType("tool_execution_end")
      .find((event) => event.toolName === "finish_work");
    expect(finish?.isError).toBe(false);
    expect(adaptive.harness.getPendingResponseCount()).toBe(0);
  });

  it("escalates a bash in-place edit of source", async () => {
    const adaptive = await setupRepository();
    adaptive.respond(
      tools(fauxToolCall("bash", { command: "perl -pi -e 's/value = 1/value = 2/' src/a.js" })),
      tools(fauxToolCall("finish_work", { status: "partial", summary: "Edited src/a.js; verification pending." })),
    );

    await adaptive.harness.session.prompt("Look at src/a.js.");

    expect(readFileSync(join(adaptive.harness.tempDir, "src/a.js"), "utf8")).toContain("value = 2");
    expect(adaptive.harness.session.getVerificationTierStatus()).toMatchObject({
      tier: "strict",
      reason: "effect_source",
      trigger: "src/a.js",
    });
    expect(adaptive.requests[1]?.toolNames).toContain("finish_work");
  });

  it.each([
    ["package.json", '{"name":"demo","version":"1.0.1"}\n', "effect_config"],
    ["src/a.test.js", "import './a.js';\n", "effect_test"],
  ] as const)("escalates an edit of %s", async (path, content, reason) => {
    const adaptive = await setupRepository();
    adaptive.respond(
      tools(fauxToolCall("write", { path, content })),
      tools(fauxToolCall("finish_work", { status: "partial", summary: `Edited ${path}.` })),
    );

    await adaptive.harness.session.prompt("Look around this project.");

    expect(adaptive.harness.session.getVerificationTierStatus()).toMatchObject({
      tier: "strict",
      reason,
      trigger: path,
    });
  });

  it("does not escalate when the mutating tool call fails", async () => {
    const adaptive = await setupRepository();
    adaptive.respond(
      tools(fauxToolCall("edit", { path: "src/missing.js", edits: [{ oldText: "a", newText: "b" }] })),
      fauxAssistantMessage("src/missing.js does not exist."),
    );

    await adaptive.harness.session.prompt("Look at src/missing.js.");

    expect(adaptive.requests).toHaveLength(2);
    expect(adaptive.harness.session.getVerificationTierStatus()?.tier).toBe("light");
    expect(protocolEvents(adaptive)).toEqual([]);
  });

  it("returns to LIGHT for the next question and re-escalates a later edit with earlier paths still owed", async () => {
    const adaptive = await setupRepository();
    adaptive.respond(
      tools(fauxToolCall("write", { path: "src/a.js", content: "export const value = 2;\n" })),
      tools(fauxToolCall("finish_work", { status: "partial", summary: "Edited src/a.js; not verified." })),
      fauxAssistantMessage("value is exported from src/a.js."),
      tools(fauxToolCall("write", { path: "src/b.js", content: "export const other = 3;\n" })),
      tools(fauxToolCall("finish_work", { status: "partial", summary: "Added src/b.js." })),
    );
    const session = adaptive.harness.session;

    await session.prompt("Look at src/a.js.");
    await session.prompt("Where is value exported?");
    const questionRequest = adaptive.requests[2];
    await session.prompt("Look at src/b.js.");

    expect(questionRequest?.toolNames).not.toContain("finish_work");
    expect(session._taskVerificationRuntime?.controller.state.taskOwnedPaths).toEqual(["src/a.js", "src/b.js"]);
    expect(session.getVerificationTierStatus()).toMatchObject({ tier: "strict", trigger: "src/b.js" });
  });

  it("keeps STRICT and the owed paths for a continuation nudge after a partial finish", async () => {
    const adaptive = await setupRepository();
    adaptive.respond(
      tools(fauxToolCall("write", { path: "src/a.js", content: "export const value = 2;\n" })),
      tools(fauxToolCall("finish_work", { status: "partial", summary: "Edited src/a.js; not verified." })),
      fauxAssistantMessage("Still verifying."),
      tools(fauxToolCall("finish_work", { status: "partial", summary: "Verification pending." })),
    );
    const session = adaptive.harness.session;

    await session.prompt("Look at src/a.js.");
    await session.prompt("continue");

    expect(session.getVerificationTierStatus()).toMatchObject({ tier: "strict", reason: "effect_source" });
    expect(adaptive.requests[2]?.toolNames).toContain("finish_work");
    expect(protocolEvents(adaptive)).toContain("missing_finish_work_retry");
    expect(session._taskVerificationRuntime?.controller.state.taskOwnedPaths).toEqual(["src/a.js"]);
  });
});
