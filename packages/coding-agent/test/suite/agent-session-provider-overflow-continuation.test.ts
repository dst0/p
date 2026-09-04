import { type FauxResponseFactory, fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

describe("AgentSession provider overflow during a pending length continuation", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it.each(["implicit", "explicit_finish"] as const)(
    "preserves the %s continuation and queued steering through overflow compaction without duplication",
    async (completionMode) => {
      const harness = await createHarness({
        models: [{ id: "overflow-continuation", contextWindow: 64_000, maxTokens: 16_000 }],
        completionMode,
        settings: {
          compaction: {
            enabled: true,
            triggerReserveTokens: 8_000,
            triggerRatio: 0.9,
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
                summary: "The report has a completed prefix. Resume its pending continuation without repetition.",
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                tokensBefore: event.preparation.tokensBefore,
              },
            }));
          },
        ],
      });
      harnesses.push(harness);
      const prefix = Array.from({ length: 5_000 }, (_value, index) => `report-${index}`).join(" ");
      const continuation = "The remaining report conclusion.";
      const steeringText = "Keep the continuation concise.";
      const expectedControl = [
        "The provider stopped because it reached its output-token limit.",
        "Continue exactly after the final completed content above and finish within the available output budget.",
        "Do not repeat, summarize, restart, or apologize.",
      ].join("\n");
      const requests: Array<{ order: string[]; control: string; compactions: number; hasProviderError: boolean }> = [];
      let queuedSteering: Promise<void> | undefined;
      const unsubscribe = harness.session.subscribe((event) => {
        if (
          event.type === "message_end" &&
          event.message.role === "assistant" &&
          event.message.stopReason === "length" &&
          !queuedSteering
        ) {
          queuedSteering = harness.session.steer(steeringText);
        }
      });
      harness.setResponses([
        fauxAssistantMessage(prefix, { stopReason: "length" }),
        ...["overflow", "retry"].map<FauxResponseFactory>((phase) => (context) => {
          let control = "";
          const order = context.messages.flatMap((message) => {
            if (message.role !== "user") return [];
            if (message.metadata?.pInternal === "provider_length_continuation") {
              control = getMessageText(message);
              return ["continuation"];
            }
            return getMessageText(message) === steeringText ? ["steering"] : [];
          });
          requests.push({
            order,
            control,
            compactions: harness.eventsOfType("compaction_end").length,
            hasProviderError: context.messages.some(
              (message) => message.role === "assistant" && message.stopReason === "error",
            ),
          });
          return phase === "overflow"
            ? fauxAssistantMessage("", { stopReason: "error", errorMessage: "prompt is too long" })
            : fauxAssistantMessage(continuation);
        }),
        ...(completionMode === "explicit_finish"
          ? [
              fauxAssistantMessage(fauxToolCall("finish_work", { status: "success", summary: "done" }), {
                stopReason: "toolUse",
              }),
            ]
          : []),
      ]);

      try {
        await harness.session.prompt("Produce a long report and continue it after the provider output limit.");
        await queuedSteering;
      } finally {
        unsubscribe();
      }

      expect(requests).toEqual([
        { order: ["continuation", "steering"], control: expectedControl, compactions: 0, hasProviderError: false },
        { order: ["continuation", "steering"], control: expectedControl, compactions: 1, hasProviderError: false },
      ]);
      expect(harness.eventsOfType("compaction_end")).toEqual([
        expect.objectContaining({ reason: "overflow", aborted: false, willRetry: true, result: expect.any(Object) }),
      ]);
      expect(harness.getPendingResponseCount()).toBe(0);
      const persistedMessages = harness.sessionManager
        .getEntries()
        .flatMap((entry) => (entry.type === "message" ? [entry.message] : []));
      expect(
        persistedMessages.filter(
          (message) => message.role === "user" && message.metadata?.pInternal === "provider_length_continuation",
        ),
      ).toHaveLength(1);
      expect(
        persistedMessages.filter((message) => message.role === "user" && getMessageText(message) === steeringText),
      ).toHaveLength(1);
      const assistantTexts = persistedMessages.filter((message) => message.role === "assistant").map(getMessageText);
      expect(assistantTexts.filter((text) => text === prefix)).toHaveLength(1);
      expect(assistantTexts.filter((text) => text === continuation)).toHaveLength(1);
      expect(assistantTexts.join("")).toBe(prefix + continuation);
    },
  );
});
