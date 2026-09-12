import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSubagentExecutor } from "../../examples/extensions/subagent/executor.ts";
import { SubagentParams } from "../../examples/extensions/subagent/parameters.ts";
import type { ExtensionFactory } from "../../src/index.ts";
import type { Harness } from "./harness.ts";
import { createHarness } from "./harness.ts";

vi.mock("../../examples/extensions/subagent/agents.ts", () => ({
  discoverAgents: () => ({ agents: [], projectAgentsDir: null }),
}));

const subagentExtension: ExtensionFactory = (p) => {
  p.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Run a test subagent",
    parameters: SubagentParams,
    execute: createSubagentExecutor(p),
  });
};

describe("subagent extension failure semantics", () => {
  let harness: Harness | undefined;

  afterEach(() => harness?.cleanup());

  it("marks a failed single-agent invocation as a tool error", async () => {
    harness = await createHarness({
      completionMode: "implicit",
      extensionFactories: [subagentExtension],
      initialActiveToolNames: ["subagent"],
    });
    harness.setResponses([
      fauxAssistantMessage(fauxToolCall("subagent", { agent: "missing", task: "Inspect the change" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Failure observed"),
    ]);

    await harness.session.prompt("Delegate this inspection to the missing agent");

    const result = harness.eventsOfType("tool_execution_end").find((event) => event.toolName === "subagent");
    expect(result?.isError).toBe(true);
    expect(JSON.stringify(result?.result.content)).toContain("Unknown agent");
  });
});
