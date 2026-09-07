import { fauxAssistantMessage } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { estimatePreparedModelCallTokens } from "../../src/core/compaction/index.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("AgentSession dynamic output cap", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });

  it("reduces an advertised full-window cap without compacting a first request", async () => {
    let providerCalls = 0;
    let requestMaxTokens: number | undefined;
    let requestInputTokens = 0;
    let toolCount = 0;
    const harness = await createHarness({
      completionMode: "implicit",
      models: [{ id: "full-window-output", contextWindow: 16_384, maxTokens: 16_384 }],
    });
    harnesses.push(harness);
    harness.setResponses([
      (context, options) => {
        providerCalls++;
        requestMaxTokens = options?.maxTokens;
        requestInputTokens = estimatePreparedModelCallTokens(context);
        toolCount = (context.tools ?? []).length;
        return fauxAssistantMessage("first request completed");
      },
    ]);

    await harness.session.prompt("Inspect the project safely with the available tools");

    expect(providerCalls).toBe(1);
    expect(toolCount).toBeGreaterThan(5);
    expect(requestMaxTokens).toBeGreaterThan(0);
    expect(requestMaxTokens).toBeLessThan(16_384);
    expect(requestInputTokens + (requestMaxTokens ?? 0) + 1024).toBeLessThanOrEqual(16_384);
    expect(harness.eventsOfType("compaction_start")).toHaveLength(0);
  });

  it("restores the desired cap after compaction frees enough prompt capacity", async () => {
    let providerCalls = 0;
    let requestMaxTokens: number | undefined;
    const preflightInputTokens: number[] = [];
    const preflightResultCaps: Array<number | undefined> = [];
    const harness = await createHarness({
      completionMode: "implicit",
      models: [{ id: "bounded-output", contextWindow: 65_536, maxTokens: 16_384 }],
      settings: { compaction: { keepRecentTokens: 1 } },
      extensionFactories: [
        (pi) => {
          pi.on("session_before_compact", async (event) => ({
            compaction: {
              summary: "Older large history was compacted before the request.",
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore,
            },
          }));
        },
      ],
    });
    harnesses.push(harness);
    const prepareModelCall = harness.session.agent.prepareModelCall;
    if (!prepareModelCall) throw new Error("Expected AgentSession model-call preflight");
    harness.session.agent.prepareModelCall = async (input, signal) => {
      preflightInputTokens.push(estimatePreparedModelCallTokens(input.context));
      const result = await prepareModelCall(input, signal);
      preflightResultCaps.push(result?.maxTokens);
      return result;
    };
    harness.sessionManager.appendMessage({
      role: "user",
      content: `old request ${"h".repeat(180_000)}`,
      timestamp: Date.now() - 4,
    });
    harness.sessionManager.appendMessage(fauxAssistantMessage("old response", { timestamp: Date.now() - 3 }));
    harness.sessionManager.appendMessage({
      role: "user",
      content: "recent request that should remain after compaction",
      timestamp: Date.now() - 2,
    });
    harness.sessionManager.appendMessage(fauxAssistantMessage("recent response", { timestamp: Date.now() - 1 }));
    harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
    harness.setResponses([
      (_context, options) => {
        providerCalls++;
        requestMaxTokens = options?.maxTokens;
        return fauxAssistantMessage("request completed after compaction");
      },
    ]);

    await harness.session.prompt("Continue after compacting the old history");

    expect(providerCalls).toBe(1);
    expect(preflightInputTokens[0]).toBeGreaterThan(48_128);
    expect(preflightInputTokens[1]).toBeLessThanOrEqual(48_128);
    expect(preflightResultCaps).toEqual([16_384, 16_384]);
    expect(requestMaxTokens).toBe(16_384);
    expect(harness.eventsOfType("compaction_start").map((event) => event.reason)).toEqual(["threshold"]);
  });
});
