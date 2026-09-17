import { fauxAssistantMessage } from "@dst0/p-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import planModeExtension from "../../examples/extensions/plan-mode/index.ts";
import { noOpUIContext } from "../../src/core/extensions/runner/constants.ts";
import type { Harness } from "./harness.ts";
import { createHarness, getMessageText } from "./harness.ts";

describe("plan mode extension lifecycle", () => {
  let harness: Harness | undefined;

  afterEach(() => harness?.cleanup());

  it("delivers exactly one execution roadmap after before_agent_start and context transforms", async () => {
    const executionContexts: string[][] = [];
    const select = vi.fn(async () => "Execute the plan (track progress)");
    harness = await createHarness({
      completionMode: "implicit",
      extensionFactories: [planModeExtension],
    });
    await harness.session.bindExtensions({
      mode: "tui",
      uiContext: { ...noOpUIContext, select },
    });
    harness.setResponses([
      fauxAssistantMessage("Plan:\n1. Inspect the baseline\n2. Verify the result"),
      (context) => {
        executionContexts.push(context.messages.map(getMessageText));
        return fauxAssistantMessage("Finished [DONE:1] [DONE:2]");
      },
    ]);

    await harness.session.prompt("/plan");
    await harness.session.prompt("Create the plan");

    expect(select).toHaveBeenCalledTimes(1);
    expect(executionContexts).toHaveLength(1);
    const delivered = executionContexts[0].filter((text) => text.includes("[EXECUTING PLAN"));
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toContain("1. Inspect the baseline");
    expect(delivered[0]).toContain("2. Result");
    expect(delivered[0]).toContain("[DONE:n]");
  });
});
