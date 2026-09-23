import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionProjectInstructionController } from "../../src/core/project-instructions/session-controller.ts";
import { BEGIN_CODE_TASK_TOOL_NAME } from "../../src/core/tools/begin-code-task.ts";
import {
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
} from "../project-instruction-delivery-fixture.ts";
import {
  type AdaptiveHarness,
  CEREMONY_TOOL_NAMES,
  createAdaptiveHarness,
  tools,
} from "./adaptive-verification-fixture.ts";

/**
 * Compiled project instructions that fall back (compiler endpoint down) are delivered as legacy AGENTS.md context.
 * The LIGHT tier must compose with that delivery: the context stays, ceremony tools and read_rules gates do not.
 */
const GATE_TEXT = /Call read_rules|project_rule_routes|Do not mutate|mode legacy before mutating/u;

describe("adaptive verification with compiled-instruction fallback", () => {
  const harnesses: AdaptiveHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.harness.cleanup();
    cleanupProjectInstructionModeWorkspaces();
  });

  async function setupFallback() {
    const workspace = createProjectInstructionModeWorkspace();
    const adaptive = await createAdaptiveHarness({
      tempRoot: workspace.root,
      resourceLoader: workspace.resourceLoader,
      projectInstructions: (context) =>
        createSessionProjectInstructionController({
          ...context,
          cwd: workspace.root,
          compiler: async () => {
            throw new Error("connect ECONNREFUSED 127.0.0.1:8080");
          },
        }),
    });
    harnesses.push(adaptive);
    expect(adaptive.harness.session._projectInstructions.state.current?.manifest.mode).toBe("fallback");
    return { adaptive, workspace };
  }

  it("answers a LIGHT question in one call with AGENTS.md context and no ceremony or rule gate", async () => {
    const { adaptive, workspace } = await setupFallback();
    adaptive.respond(fauxAssistantMessage("391"));

    await adaptive.harness.session.prompt("What is 17*23? Reply with just the number.");

    expect(adaptive.requests).toHaveLength(1);
    const [request] = adaptive.requests;
    expect(request?.systemPrompt).toContain(`<project_instructions path="${workspace.agentsPath}">`);
    expect(request?.systemPrompt).toContain("Always protect credentials before edits.");
    expect(request?.systemPrompt).not.toMatch(GATE_TEXT);
    expect(request?.messageTexts.join("\n")).not.toMatch(GATE_TEXT);
    for (const ceremonyTool of CEREMONY_TOOL_NAMES) expect(request?.toolNames).not.toContain(ceremonyTool);
    expect(request?.toolNames).toContain(BEGIN_CODE_TASK_TOOL_NAME);
    expect(request?.systemPrompt).not.toContain("explicit completion mode");
    expect(adaptive.harness.eventsOfType("completion_protocol")).toEqual([]);
    expect(adaptive.harness.session.getVerificationTierStatus()).toMatchObject({ policy: "auto", tier: "light" });
    expect(adaptive.harness.events.some((event) => event.type === "project_instructions_fallback")).toBe(true);
  });

  it("lets LIGHT edit without a read_rules gate and still escalates a source change", async () => {
    const { adaptive } = await setupFallback();
    const cwd = adaptive.harness.tempDir;
    adaptive.respond(
      tools(fauxToolCall("write", { path: "NOTES.md", content: "setup notes\n" })),
      fauxAssistantMessage("Wrote NOTES.md."),
      tools(fauxToolCall("write", { path: "src/a.js", content: "export const value = 2;\n" })),
      tools(fauxToolCall("finish_work", { status: "partial", summary: "Changed src/a.js; tests pending." })),
    );

    await adaptive.harness.session.prompt("Document the setup steps in NOTES.md");
    await adaptive.harness.session.prompt("Look at src/a.js.");

    const writes = adaptive.harness.eventsOfType("tool_execution_end").filter((event) => event.toolName === "write");
    expect(writes.map((event) => event.isError)).toEqual([false, false]);
    expect(readFileSync(join(cwd, "NOTES.md"), "utf8")).toBe("setup notes\n");
    expect(adaptive.requests).toHaveLength(4);
    expect(adaptive.requests[3]?.toolNames).toEqual(
      expect.arrayContaining(["record_task_verification", "finish_work"]),
    );
    expect(adaptive.harness.session.getVerificationTierStatus()).toMatchObject({
      tier: "strict",
      reason: "effect_source",
      trigger: "src/a.js",
    });
  });
});
