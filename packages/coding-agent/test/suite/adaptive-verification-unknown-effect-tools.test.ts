import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionFactory } from "../../src/index.ts";
import {
  type AdaptiveHarness,
  createAdaptiveHarness,
  initGitRepository,
  tools,
  writeWorkspaceFile,
} from "./adaptive-verification-fixture.ts";

/**
 * Regression for a read-only hardware investigation that was forced into STRICT evidence: MCP-style
 * workspace-tracker and web-search tools without declared effects were counted as mutations, and the
 * finish gate then demanded a "broad test run" although no source or test file had changed.
 */
/** Lets the slow tool finish only after a parallel edit escalated the tier (bounded to avoid hangs). */
let releaseSlowTool: Promise<void> = Promise.resolve();

const mcpLikeExtension: ExtensionFactory = (p) => {
  for (const name of ["secure_hub_workspace_task_write", "web_search_exa", "slow_tracker_update"]) {
    p.registerTool({
      name,
      label: name,
      description: `MCP-style ${name} without a declared effect`,
      promptSnippet: `${name}(input): external service call`,
      parameters: Type.Object({ input: Type.String() }),
      execute: async (_toolCallId, params) => {
        if (name === "slow_tracker_update") await releaseSlowTool;
        return { content: [{ type: "text", text: `${name} ok: ${params.input}` }], details: {} };
      },
    });
  }
};

describe("adaptive verification: unknown-effect tools", () => {
  const harnesses: AdaptiveHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.harness.cleanup();
  });

  it("keeps a read-only investigation with MCP-style tools LIGHT and ends on plain text", async () => {
    const adaptive = await createAdaptiveHarness({ extensionFactories: [mcpLikeExtension] });
    harnesses.push(adaptive);
    adaptive.respond(
      tools(fauxToolCall("bash", { command: "node -e \"console.log(require('os').cpus().length)\"" })),
      tools(
        fauxToolCall("web_search_exa", { input: "M3 Max memory bandwidth" }),
        fauxToolCall("secure_hub_workspace_task_write", { input: "hardware findings recorded" }),
      ),
      fauxAssistantMessage("The machine has the reported CPU count; findings are recorded in the tracker."),
    );

    await adaptive.harness.session.prompt(
      "Investigate this machine's hardware and record the findings in the tracker.",
    );

    const session = adaptive.harness.session;
    expect(adaptive.requests).toHaveLength(3);
    expect(adaptive.requests.at(-1)?.toolNames).not.toContain("finish_work");
    expect(session.getVerificationTierStatus()).toMatchObject({ policy: "auto", tier: "light" });
    expect(adaptive.harness.eventsOfType("verification_tier_changed")).toEqual([]);
    expect(adaptive.harness.eventsOfType("completion_protocol")).toEqual([]);
    const toolResults = adaptive.harness.eventsOfType("tool_execution_end");
    expect(toolResults.map((event) => [event.toolName, event.isError])).toEqual([
      ["bash", false],
      ["web_search_exa", false],
      ["secure_hub_workspace_task_write", false],
    ]);
    expect(JSON.stringify(toolResults.map((event) => event.result.content))).not.toMatch(/broad test|pathless/u);
    const state = session._taskVerificationRuntime?.controller.state;
    expect(state?.mutationRevision).toBe(0);
    expect(state?.externalEffectReceipts ?? []).toEqual([]);
    expect(state?.unverifiedTestPathOverflow ?? false).toBe(false);
  });

  it("keeps an unobserved tool unobserved when a parallel edit escalates before it finishes", async () => {
    const adaptive = await createAdaptiveHarness({ extensionFactories: [mcpLikeExtension] });
    harnesses.push(adaptive);
    writeWorkspaceFile(adaptive.harness.tempDir, "src/a.js", "export const value = 1;\n");
    initGitRepository(adaptive.harness.tempDir);
    releaseSlowTool = new Promise((resolve) => {
      const timeout = setTimeout(resolve, 10_000);
      adaptive.harness.session.subscribe((event) => {
        if (event.type !== "verification_tier_changed") return;
        clearTimeout(timeout);
        resolve();
      });
    });
    adaptive.respond(
      tools(
        fauxToolCall("write", { path: "src/a.js", content: "export const value = 2;\n" }),
        fauxToolCall("slow_tracker_update", { input: "value changed" }),
      ),
      tools(fauxToolCall("finish_work", { status: "partial", summary: "Changed src/a.js; tests pending." })),
    );

    await adaptive.harness.session.prompt("Look at src/a.js.");

    const finished = adaptive.harness.eventsOfType("tool_execution_end").map((event) => event.toolName);
    expect(finished.slice(0, 2)).toEqual(["write", "slow_tracker_update"]);
    expect(adaptive.harness.session.getVerificationTierStatus()?.reason).toBe("effect_source");
    const state = adaptive.harness.session._taskVerificationRuntime?.controller.state;
    expect(state?.mutationRevision).toBe(1);
    expect(state?.externalEffectReceipts ?? []).toEqual([]);
  });
});
