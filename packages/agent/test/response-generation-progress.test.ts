import type { AssistantMessage, AssistantMessageEvent } from "@dst0/p-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../src/types.ts";
import {
  baseConfig,
  collectEvents,
  createMockStream,
  emptyContext,
  mkAssistant,
} from "./response-streaming-helpers.ts";

describe("response generation progress telemetry", () => {
  let dateNowSpy: ReturnType<typeof vi.spyOn>;
  let now: number;

  beforeEach(() => {
    now = 1000;
    dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  it("calculates tokens per second and emits gen_progress when interval threshold is exceeded", async () => {
    const final = mkAssistant("abcdef");
    const partial: AssistantMessage = { ...final, content: [] };
    const events: AssistantMessageEvent[] = [
      { type: "start", partial },
      { type: "text_start", contentIndex: 0, partial },
    ];
    for (let i = 0; i < 6; i++) {
      events.push({
        type: "text_delta",
        contentIndex: 0,
        delta: "x",
        partial: { ...partial, content: [{ type: "text", text: "x".repeat(i + 1) }] },
      });
    }
    events.push(
      { type: "text_end", contentIndex: 0, content: "xxxxxx", partial: final },
      { type: "done", reason: "stop", message: final },
    );

    let callIndex = 0;
    dateNowSpy.mockImplementation(() => {
      callIndex++;
      // Advance time past 1000ms after several tokens have been processed
      if (callIndex > 6) return 1000 + 2000;
      return 1000;
    });

    const { events: emitted } = await collectEvents(emptyContext(), baseConfig(), createMockStream(events));
    const genProgressEvents = emitted
      .filter((e): e is Extract<AgentEvent, { type: "message_update" }> => e.type === "message_update")
      .filter((e) => e.assistantMessageEvent.type === "gen_progress");

    expect(genProgressEvents.length).toBeGreaterThanOrEqual(1);
    const progress = genProgressEvents[0].assistantMessageEvent;
    if (progress.type === "gen_progress") {
      expect(progress.tokens).toBeGreaterThan(0);
      expect(progress.tokensPerSecond).toBeGreaterThan(0);
    }
  });

  it("does not emit gen_progress when time between delta events is below interval threshold", async () => {
    const final = mkAssistant("fast");
    const partial: AssistantMessage = { ...final, content: [] };
    const events: AssistantMessageEvent[] = [
      { type: "start", partial },
      { type: "text_start", contentIndex: 0, partial },
      { type: "text_delta", contentIndex: 0, delta: "f", partial },
      { type: "text_delta", contentIndex: 0, delta: "a", partial },
      { type: "text_end", contentIndex: 0, content: "fa", partial: final },
      { type: "done", reason: "stop", message: final },
    ];

    // Constant time — 0ms elapsed
    dateNowSpy.mockImplementation(() => 1000);

    const { events: emitted } = await collectEvents(emptyContext(), baseConfig(), createMockStream(events));
    const genProgressEvents = emitted
      .filter((e): e is Extract<AgentEvent, { type: "message_update" }> => e.type === "message_update")
      .filter((e) => e.assistantMessageEvent.type === "gen_progress");

    expect(genProgressEvents).toHaveLength(0);
  });
});
