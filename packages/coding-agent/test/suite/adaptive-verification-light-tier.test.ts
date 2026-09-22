import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { BEGIN_CODE_TASK_TOOL_NAME } from "../../src/core/tools/begin-code-task.ts";
import {
  type AdaptiveHarness,
  CEREMONY_TOOL_NAMES,
  createAdaptiveHarness,
  initGitRepository,
  tools,
  writeWorkspaceFile,
} from "./adaptive-verification-fixture.ts";

describe("adaptive verification: LIGHT tier", () => {
  const harnesses: AdaptiveHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.harness.cleanup();
  });

  async function setup(): Promise<AdaptiveHarness> {
    const adaptive = await createAdaptiveHarness();
    harnesses.push(adaptive);
    return adaptive;
  }

  function retries(adaptive: AdaptiveHarness): string[] {
    return adaptive.harness
      .eventsOfType("completion_protocol")
      .map((event) => event.event)
      .filter((event) => event.endsWith("_retry"));
  }

  it("answers a question in one request that carries no verification ceremony", async () => {
    const adaptive = await setup();
    adaptive.respond(fauxAssistantMessage("391"));

    await adaptive.harness.session.prompt("What is 17*23? Reply with just the number.");

    expect(adaptive.requests).toHaveLength(1);
    const [request] = adaptive.requests;
    for (const ceremonyTool of CEREMONY_TOOL_NAMES) expect(request?.toolNames).not.toContain(ceremonyTool);
    expect(request?.toolNames).toContain(BEGIN_CODE_TASK_TOOL_NAME);
    expect(request?.systemPrompt).not.toContain("explicit completion mode");
    expect(request?.systemPrompt).not.toContain("<session_state_protocol>");
    expect(request?.systemPrompt).not.toContain("record_task_verification");
    expect(retries(adaptive)).toEqual([]);
    expect(adaptive.harness.eventsOfType("agent_end")).toHaveLength(1);
    expect(adaptive.harness.session.getVerificationTierStatus()).toMatchObject({ policy: "auto", tier: "light" });
  });

  it("reads a file and answers in two requests without a success checkpoint", async () => {
    const adaptive = await setup();
    writeWorkspaceFile(adaptive.harness.tempDir, "package.json", '{"scripts":{"test":"vitest"}}\n');
    adaptive.respond(tools(fauxToolCall("read", { path: "package.json" })), fauxAssistantMessage("test: vitest"));

    await adaptive.harness.session.prompt("read package.json and report one script");

    expect(adaptive.requests).toHaveLength(2);
    expect(adaptive.requests[1]?.messageTexts.join("\n")).not.toContain("<turn_checkpoint>");
    expect(retries(adaptive)).toEqual([]);
  });

  it("still reports a failed tool call through the turn checkpoint", async () => {
    const adaptive = await setup();
    adaptive.respond(tools(fauxToolCall("read", { path: "missing.json" })), fauxAssistantMessage("It is missing."));

    await adaptive.harness.session.prompt("read missing.json and report its version");

    expect(adaptive.requests).toHaveLength(2);
    expect(adaptive.requests[1]?.messageTexts.join("\n")).toContain("- ERROR read");
  });

  it("keeps a README-only edit LIGHT and ends on the text answer", async () => {
    const adaptive = await setup();
    initGitRepository(adaptive.harness.tempDir);
    adaptive.respond(
      tools(fauxToolCall("write", { path: "README.md", content: "# Demo\n\nhello\n" })),
      fauxAssistantMessage("Added the line to README.md."),
    );

    await adaptive.harness.session.prompt("Add a line to README.md that says hello");

    expect(readFileSync(join(adaptive.harness.tempDir, "README.md"), "utf8")).toContain("hello");
    expect(adaptive.requests).toHaveLength(2);
    expect(adaptive.requests[1]?.toolNames).not.toContain("finish_work");
    expect(adaptive.harness.eventsOfType("verification_tier_changed")).toEqual([]);
    expect(adaptive.harness.session._taskVerificationRuntime?.controller.state.taskOwnedPaths).toEqual(["README.md"]);
  });

  it("does not escalate for test runs and read-only searches through bash", async () => {
    const adaptive = await setup();
    writeWorkspaceFile(
      adaptive.harness.tempDir,
      "package.json",
      '{"scripts":{"test":"node -e \\"process.exit(0)\\""}}\n',
    );
    writeWorkspaceFile(adaptive.harness.tempDir, "src/a.js", "export const value = 1;\n");
    initGitRepository(adaptive.harness.tempDir);
    adaptive.respond(
      tools(fauxToolCall("bash", { command: "npm test" })),
      tools(fauxToolCall("bash", { command: "rg value src || grep -rn value src" })),
      fauxAssistantMessage("Tests pass and src/a.js defines value."),
    );

    await adaptive.harness.session.prompt("Run npm test and report failures");

    expect(adaptive.requests).toHaveLength(3);
    expect(adaptive.harness.eventsOfType("verification_tier_changed")).toEqual([]);
    expect(adaptive.harness.session.getVerificationTierStatus()?.tier).toBe("light");
    expect(retries(adaptive)).toEqual([]);
  });

  it("defers rare default tools and restores them when a code task starts", async () => {
    const adaptive = await setup();
    const session = adaptive.harness.session;

    expect(session.getActiveToolNames()).not.toContain("sleep");
    expect(session.getActiveToolNames()).not.toContain("update_session_state");
    adaptive.respond(fauxAssistantMessage("Which module should hold the helper?"));
    await session.prompt("Implement a slugify helper with tests");

    expect(session.getActiveToolNames()).toEqual(expect.arrayContaining(["sleep", "update_session_state"]));
    expect(session.getActiveToolNames()).not.toContain(BEGIN_CODE_TASK_TOOL_NAME);
  });

  it("finds deferred built-in tools through tool_search but never exposes verification controls", async () => {
    const adaptive = await setup();
    adaptive.respond(
      tools(fauxToolCall("tool_search", { query: "process", names: ["record_task_verification", "finish_work"] })),
      fauxAssistantMessage("The process tool is available now."),
    );

    await adaptive.harness.session.prompt("Which tool waits for a background process?");

    const search = adaptive.harness
      .eventsOfType("tool_execution_end")
      .find((event) => event.toolName === "tool_search");
    const activated = (search?.result.details as { activated: string[] }).activated;
    expect(activated).toContain("process");
    expect(activated).not.toContain("record_task_verification");
    expect(activated).not.toContain("finish_work");
    expect(adaptive.requests[1]?.toolNames).toContain("process");
    expect(adaptive.requests[1]?.toolNames).not.toContain("record_task_verification");
    expect(adaptive.harness.session.getVerificationTierStatus()?.tier).toBe("light");
  });

  it("starts a fresh controller task for the next substantive prompt after a LIGHT docs edit", async () => {
    const adaptive = await setup();
    initGitRepository(adaptive.harness.tempDir);
    adaptive.respond(
      tools(fauxToolCall("write", { path: "NOTES.md", content: "note\n" })),
      fauxAssistantMessage("Wrote NOTES.md."),
      fauxAssistantMessage("It contains one note."),
    );
    await adaptive.harness.session.prompt("Document the setup steps in NOTES.md");
    await adaptive.harness.session.prompt("What does NOTES.md contain?");

    const state = adaptive.harness.session._taskVerificationRuntime?.controller.state;
    expect(state?.taskOwnedPaths ?? []).toEqual([]);
    expect(state?.taskPrompts?.map((prompt) => prompt.text)).toEqual(["What does NOTES.md contain?"]);
    expect(existsSync(join(adaptive.harness.tempDir, "NOTES.md"))).toBe(true);
  });

  it("keeps the LIGHT tier and its ledger across a continuation nudge", async () => {
    const adaptive = await setup();
    initGitRepository(adaptive.harness.tempDir);
    adaptive.respond(
      tools(fauxToolCall("write", { path: "NOTES.md", content: "note\n" })),
      fauxAssistantMessage("Wrote NOTES.md."),
      fauxAssistantMessage("Nothing else is pending."),
    );
    await adaptive.harness.session.prompt("Document the setup steps in NOTES.md");
    await adaptive.harness.session.prompt("continue");

    expect(adaptive.harness.session.getVerificationTierStatus()?.tier).toBe("light");
    expect(adaptive.harness.session._taskVerificationRuntime?.controller.state.taskOwnedPaths).toEqual(["NOTES.md"]);
    expect(adaptive.requests).toHaveLength(3);
  });
});
