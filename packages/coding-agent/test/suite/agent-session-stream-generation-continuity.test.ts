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

  it("protects an implicit length-finished partial tool call and retries it only after compaction", async () => {
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
      completionMode: "implicit",
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
          if (message.metadata?.pInternal === "provider_length_continuation") return ["continuation"];
          return getMessageText(message) === steeringText ? ["steering"] : [];
        });
        return fauxAssistantMessage(fauxToolCall("continuity_write", { content: "bounded retry" }), {
          stopReason: "toolUse",
        });
      },
      fauxAssistantMessage("bounded write completed"),
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
    expect(executedWrites).toEqual(["bounded retry"]);
    expect(retryQueuedMessageOrder).toEqual(["continuation", "steering"]);
    expect(retryObservedPriorCompaction).toBe(true);
  });

  it.each(["implicit", "explicit_finish"] as const)(
    "continues %s tool-less output after compaction without duplicating semantic text or queued steering",
    async (completionMode) => {
      const harness = await createHarness({
        models: [{ id: "stream-text-continuity", contextWindow: 64_000, maxTokens: 16_000 }],
        completionMode,
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
                summary: "Preserve the completed text segment and continue without repetition.",
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                tokensBefore: event.preparation.tokensBefore,
              },
            }));
          },
        ],
      });
      harnesses.push(harness);
      const prefix = Array.from({ length: 5_000 }, (_value, index) => `semantic-${index}`).join(" ");
      const continuation = "semantic continuation without repetition";
      const steeringText = "Keep the continuation concise.";
      let nextRequestOrder: string[] = [];
      let nextRequestObservedCompaction = false;
      let nextContinuationInstruction = "";
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
        fauxAssistantMessage(prefix, { stopReason: "length" }),
        (context) => {
          nextRequestObservedCompaction = harness.eventsOfType("compaction_end").length > 0;
          nextRequestOrder = context.messages.flatMap((message) => {
            if (message.role !== "user") return [];
            if (message.metadata?.pInternal === "provider_length_continuation") {
              nextContinuationInstruction = getMessageText(message);
              return ["continuation"];
            }
            return getMessageText(message) === steeringText ? ["steering"] : [];
          });
          return fauxAssistantMessage(continuation);
        },
        ...(completionMode === "explicit_finish"
          ? [
              fauxAssistantMessage(fauxToolCall("finish_work", { status: "success", summary: "done" }), {
                stopReason: "toolUse",
              }),
            ]
          : []),
      ]);

      await harness.session.prompt("Produce one long non-coding response and continue it after the provider limit.");
      unsubscribe();
      await queuedSteering;

      const persistedAssistantTexts = harness.sessionManager
        .getEntries()
        .flatMap((entry) =>
          entry.type === "message" && entry.message.role === "assistant" ? [getMessageText(entry.message)] : [],
        );
      expect(nextRequestOrder).toEqual(["continuation", "steering"]);
      expect(nextRequestObservedCompaction).toBe(true);
      expect(nextContinuationInstruction).toContain("Continue exactly after the final completed content above");
      expect(nextContinuationInstruction).not.toContain("tool call");
      expect(persistedAssistantTexts.filter((text) => text === prefix)).toHaveLength(1);
      expect(persistedAssistantTexts.filter((text) => text === continuation)).toHaveLength(1);
      expect(persistedAssistantTexts.join("")).toBe(prefix + continuation);
    },
  );

  it("bounds repeated implicit length continuation and reports a terminal error without executing tools", async () => {
    const executed: string[] = [];
    const tool: AgentTool = {
      name: "bounded_write",
      label: "Bounded write",
      description: "Record content",
      parameters: Type.Object({ content: Type.String() }),
      async execute(_toolCallId, args) {
        executed.push(String((args as { content: string }).content));
        return { content: [{ type: "text", text: "recorded" }], details: {} };
      },
    };
    const harness = await createHarness({
      completionMode: "implicit",
      tools: [tool],
      initialActiveToolNames: [tool.name],
    });
    harnesses.push(harness);
    const prefixes = ["segment one", "segment two", "segment three", "segment four"];
    harness.setResponses([
      ...prefixes.map((prefix, index) =>
        fauxAssistantMessage(
          [
            { type: "text" as const, text: prefix },
            fauxToolCall(tool.name, { content: `partial-${index}` }, { id: `partial-${index}` }),
          ],
          { stopReason: "length" },
        ),
      ),
      fauxAssistantMessage("must remain unrequested"),
    ]);

    await harness.session.prompt("Keep generating bounded segments until the runtime continuation limit is reached.");

    const persisted = harness.sessionManager
      .getEntries()
      .flatMap((entry) => (entry.type === "message" ? [entry.message] : []));
    const lengthMessages = persisted.flatMap((message) =>
      message.role === "assistant" && message.stopReason === "length" ? [message as AssistantMessage] : [],
    );
    const terminal = persisted.at(-1);
    expect(executed).toEqual([]);
    expect(lengthMessages.map(getMessageText)).toEqual(prefixes);
    expect(
      lengthMessages.map((message) => message.content.find((part) => part.type === "toolCall")?.arguments),
    ).toEqual(prefixes.map((_prefix, index) => ({ content: `partial-${index}` })));
    expect(
      persisted.filter(
        (message) => message.role === "user" && message.metadata?.pInternal === "provider_length_continuation",
      ),
    ).toHaveLength(3);
    expect(terminal?.role === "assistant" ? terminal.stopReason : undefined).toBe("error");
    expect(getMessageText(terminal)).toContain("3 consecutive output-limit continuations");
    expect(harness.getPendingResponseCount()).toBe(1);
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
