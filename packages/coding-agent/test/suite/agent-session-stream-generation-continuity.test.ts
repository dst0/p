import type { AgentTool } from "@dst0/p-agent-core";
import { type AssistantMessage, fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

describe("AgentSession streamed generation continuity", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it("persists a length-finished response, compacts before retry, and never executes its partial tool call", async () => {
    const executedWrites: string[] = [];
    const writeTool: AgentTool = {
      name: "continuity_write",
      label: "Continuity write",
      description: "Record one bounded payload",
      parameters: Type.Object({ content: Type.String() }),
      async execute(_toolCallId, args) {
        const content = typeof args === "object" && args !== null && "content" in args ? String(args.content) : "";
        executedWrites.push(content);
        return { content: [{ type: "text", text: "recorded" }], details: { content } };
      },
    };
    const harness = await createHarness({
      models: [{ id: "stream-continuity", contextWindow: 64_000, maxTokens: 16_000 }],
      tools: [writeTool],
      initialActiveToolNames: [writeTool.name],
      settings: {
        compaction: {
          enabled: true,
          triggerReserveTokens: 8_000,
          triggerRatio: 0.2,
          targetContextTokens: 3_000,
          keepRecentMinTokens: 200,
          keepRecentMaxTokens: 500,
          summaryMaxTokens: 500,
          renderedStateMaxTokens: 500,
        },
      },
      extensionFactories: [
        (pi) => {
          pi.on("session_before_compact", async (event) => ({
            compaction: {
              summary: "The completed length-finished response was persisted before this compaction boundary.",
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore,
            },
          }));
        },
      ],
    });
    harnesses.push(harness);
    const completedPrefix = "completed streamed output before the provider length finish";
    const oversizedArguments = "x".repeat(58_000);
    const steeringText = "Use the bounded retry once after preserving the completed response.";
    let retryObservedPriorCompaction = false;
    let retryQueuedMessageOrder: string[] = [];
    let queuedSteering: Promise<void> | undefined;
    const unsubscribe = harness.session.subscribe((event) => {
      if (
        event.type !== "message_end" ||
        event.message.role !== "assistant" ||
        event.message.stopReason !== "length" ||
        queuedSteering
      ) {
        return;
      }
      queuedSteering = harness.session.steer(steeringText);
    });
    harness.setResponses([
      fauxAssistantMessage(
        [
          { type: "text", text: completedPrefix },
          fauxToolCall("continuity_write", { content: oversizedArguments }, { id: "partial-write" }),
        ],
        { stopReason: "length" },
      ),
      (context) => {
        retryObservedPriorCompaction = harness.eventsOfType("compaction_end").length > 0;
        retryQueuedMessageOrder = context.messages.flatMap((message) => {
          if (message.role !== "user") return [];
          if (message.metadata?.pInternal === "completion_protocol_repair") return ["repair"];
          return getMessageText(message) === steeringText ? ["steering"] : [];
        });
        return fauxAssistantMessage(fauxToolCall("continuity_write", { content: "bounded retry" }), {
          stopReason: "toolUse",
        });
      },
      fauxAssistantMessage(fauxToolCall("finish_work", { status: "success", summary: "done" }), {
        stopReason: "toolUse",
      }),
    ]);

    await harness.session.prompt("Persist the complete response, compact, then retry the pending bounded write once.");
    unsubscribe();
    await queuedSteering;

    const persistedLengthResponse = harness.sessionManager
      .getEntries()
      .flatMap((entry) =>
        entry.type === "message" && entry.message.role === "assistant" ? [entry.message as AssistantMessage] : [],
      )
      .find((message) => message.stopReason === "length");
    expect(getMessageText(persistedLengthResponse)).toContain(completedPrefix);
    expect(persistedLengthResponse?.content.find((part) => part.type === "toolCall")?.arguments).toEqual({
      content: oversizedArguments,
    });
    expect(harness.eventsOfType("compaction_start").map((event) => event.reason)).toContain("threshold");
    expect(retryQueuedMessageOrder).toEqual(["repair", "steering"]);
    expect(retryObservedPriorCompaction).toBe(true);
    expect(executedWrites).toEqual(["bounded retry"]);
  });

  it("keeps explicit cancellation terminal and persists the streamed prefix", async () => {
    const harness = await createHarness({
      models: [{ id: "stream-cancel", contextWindow: 64_000, maxTokens: 16_000 }],
      completionMode: "implicit",
    });
    harnesses.push(harness);
    harness.setResponses([fauxAssistantMessage("streamed prefix ".repeat(2_000))]);
    const sawDelta = new Promise<void>((resolve) => {
      const unsubscribe = harness.session.subscribe((event) => {
        if (event.type !== "message_update" || event.assistantMessageEvent.type !== "text_delta") return;
        unsubscribe();
        resolve();
      });
    });

    const prompt = harness.session.prompt("Start a response that I will cancel explicitly.");
    await sawDelta;
    await harness.session.abort();
    await prompt;

    const persisted = harness.sessionManager
      .getEntries()
      .flatMap((entry) =>
        entry.type === "message" && entry.message.role === "assistant" ? [entry.message as AssistantMessage] : [],
      )
      .at(-1);
    expect(persisted?.stopReason).toBe("aborted");
    expect(getMessageText(persisted).length).toBeGreaterThan(0);
    expect(harness.eventsOfType("compaction_start")).toHaveLength(0);
  });
});
