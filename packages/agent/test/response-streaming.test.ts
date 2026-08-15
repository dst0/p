import {
  type AssistantMessage,
  type AssistantMessageEvent,
  EventStream,
  fauxAssistantMessage,
  registerFauxProvider,
} from "@dst0/p-ai";
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentMessage, StreamFn } from "../src/types.ts";
import {
  baseConfig,
  collectEvents,
  createEndingStream,
  createMockStream,
  emptyContext,
  mkAssistant,
} from "./response-streaming-helpers.ts";

describe("streamAssistantResponse", () => {
  it("start + done: emits request_start, message_start, message_end in strict order and replaces partial", async () => {
    const final = mkAssistant("hello");
    const partial: AssistantMessage = { ...final, content: [] };
    const events: AssistantMessageEvent[] = [
      { type: "start", partial },
      { type: "done", reason: "stop", message: final },
    ];
    const ctx = emptyContext();
    const { events: emitted, result } = await collectEvents(ctx, baseConfig(), createMockStream(events));

    expect(emitted.map((e) => e.type)).toEqual(["request_start", "message_start", "message_end"]);
    expect(result.content[0]).toEqual({ type: "text", text: "hello" });
    expect(ctx.messages).toEqual([result]);
  });

  it("done without start: emits start before end and appends final message", async () => {
    const final = mkAssistant("direct");
    const events: AssistantMessageEvent[] = [{ type: "done", reason: "stop", message: final }];
    const ctx = emptyContext();
    const { events: emitted, result } = await collectEvents(ctx, baseConfig(), createMockStream(events));

    expect(emitted.map((e) => e.type)).toEqual(["request_start", "message_start", "message_end"]);
    expect(ctx.messages).toEqual([result]);
  });

  it("error event: normalizes and emits error message", async () => {
    const errorMsg = mkAssistant("", "error");
    const partial: AssistantMessage = { ...errorMsg, content: [] };
    const events: AssistantMessageEvent[] = [
      { type: "start", partial },
      { type: "error", reason: "error", error: errorMsg },
    ];
    const { result } = await collectEvents(emptyContext(), baseConfig(), createMockStream(events));
    expect(result.stopReason).toBe("error");
  });

  it("emits prefill_progress before text_start update on first content block and skips on subsequent blocks", async () => {
    const final = mkAssistant("hi");
    const partial: AssistantMessage = { ...final, content: [] };
    const events: AssistantMessageEvent[] = [
      { type: "start", partial },
      { type: "text_start", contentIndex: 0, partial },
      { type: "thinking_start", contentIndex: 1, partial },
      { type: "text_end", contentIndex: 0, content: "hi", partial: final },
      { type: "done", reason: "stop", message: final },
    ];
    const { events: emitted } = await collectEvents(emptyContext(), baseConfig(), createMockStream(events));
    const updateEventTypes = emitted
      .filter((e): e is Extract<AgentEvent, { type: "message_update" }> => e.type === "message_update")
      .map((e) => e.assistantMessageEvent.type);

    expect(updateEventTypes).toEqual(["prefill_progress", "text_start", "thinking_start", "text_end"]);
  });

  it("skips prefill_progress when content start occurs without prior start event", async () => {
    const final = mkAssistant("hi");
    const partial: AssistantMessage = { ...final, content: [] };
    const events: AssistantMessageEvent[] = [
      { type: "text_start", contentIndex: 0, partial },
      { type: "done", reason: "stop", message: final },
    ];
    const { events: emitted } = await collectEvents(emptyContext(), baseConfig(), createMockStream(events));
    const prefillEvents = emitted.filter(
      (e) => e.type === "message_update" && e.assistantMessageEvent.type === "prefill_progress",
    );
    expect(prefillEvents).toHaveLength(0);
  });

  it("processes delta events arriving before any content start event", async () => {
    const final = mkAssistant("delta-first");
    const partial: AssistantMessage = { ...final, content: [] };
    const events: AssistantMessageEvent[] = [
      { type: "text_delta", contentIndex: 0, delta: "d", partial },
      { type: "done", reason: "stop", message: final },
    ];
    const { events: emitted } = await collectEvents(emptyContext(), baseConfig(), createMockStream(events));
    expect(emitted.some((e) => e.type === "message_update")).toBe(true);
  });

  it("forwards thinking_start, delta, and end events in order", async () => {
    const final = mkAssistant("thought");
    const partial: AssistantMessage = { ...final, content: [] };
    const events: AssistantMessageEvent[] = [
      { type: "start", partial },
      { type: "thinking_start", contentIndex: 0, partial },
      { type: "thinking_delta", contentIndex: 0, delta: "t", partial },
      { type: "thinking_end", contentIndex: 0, content: "thought", partial: final },
      { type: "done", reason: "stop", message: final },
    ];
    const { events: emitted } = await collectEvents(emptyContext(), baseConfig(), createMockStream(events));
    const updateEventTypes = emitted
      .filter((e): e is Extract<AgentEvent, { type: "message_update" }> => e.type === "message_update")
      .map((e) => e.assistantMessageEvent.type);

    expect(updateEventTypes).toEqual(["prefill_progress", "thinking_start", "thinking_delta", "thinking_end"]);
  });

  it("forwards toolcall_start, delta, and end events in order", async () => {
    const toolCall = { type: "toolCall" as const, id: "tc1", name: "test", arguments: {} };
    const final = mkAssistant("", "toolUse", { content: [toolCall] });
    const partial: AssistantMessage = { ...final, content: [] };
    const events: AssistantMessageEvent[] = [
      { type: "start", partial },
      { type: "toolcall_start", contentIndex: 0, partial },
      { type: "toolcall_delta", contentIndex: 0, delta: "{}", partial },
      { type: "toolcall_end", contentIndex: 0, toolCall, partial: final },
      { type: "done", reason: "toolUse", message: final },
    ];
    const { events: emitted } = await collectEvents(emptyContext(), baseConfig(), createMockStream(events));
    const updateEventTypes = emitted
      .filter((e): e is Extract<AgentEvent, { type: "message_update" }> => e.type === "message_update")
      .map((e) => e.assistantMessageEvent.type);

    expect(updateEventTypes).toEqual(["prefill_progress", "toolcall_start", "toolcall_delta", "toolcall_end"]);
  });

  it("forwards queue_progress, model_switch_progress, loading_progress", async () => {
    const final = mkAssistant("ok");
    const partial: AssistantMessage = { ...final, content: [] };
    const events: AssistantMessageEvent[] = [
      { type: "start", partial },
      { type: "queue_progress", queue: "main", position: 1, queuedAhead: 0, partial },
      {
        type: "model_switch_progress",
        phase: "loading",
        fromModel: "a",
        toModel: "b",
        partial,
      } as AssistantMessageEvent,
      { type: "loading_progress", model: "a", partial },
      { type: "done", reason: "stop", message: final },
    ];
    const { events: emitted } = await collectEvents(emptyContext(), baseConfig(), createMockStream(events));
    const updateEventTypes = emitted
      .filter((e): e is Extract<AgentEvent, { type: "message_update" }> => e.type === "message_update")
      .map((e) => e.assistantMessageEvent.type);

    expect(updateEventTypes).toEqual(["queue_progress", "model_switch_progress", "loading_progress"]);
  });

  it("transformContext hook output is passed directly to convertToLlm", async () => {
    const final = mkAssistant("transformed");
    const transformed: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "transformed prompt" }], timestamp: 1 },
    ];
    const convertToLlmSpy = vi.fn().mockReturnValue([]);
    const config = baseConfig({
      transformContext: async () => transformed,
      convertToLlm: convertToLlmSpy,
    });
    await collectEvents(emptyContext(), config, createMockStream([{ type: "done", reason: "stop", message: final }]));
    expect(convertToLlmSpy).toHaveBeenCalledWith(transformed);
  });

  it("resolves dynamic API key via getApiKey hook or falls back to direct apiKey", async () => {
    const final = mkAssistant("keyed");
    let capturedOptions: Record<string, unknown> | undefined;
    const streamFn: StreamFn = (_model, _ctx, options) => {
      capturedOptions = options as Record<string, unknown>;
      const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
        (e) => e.type === "done" || e.type === "error",
        (e) => (e.type === "done" ? e.message : (e as any).error),
      );
      queueMicrotask(() => stream.push({ type: "done", reason: "stop", message: final }));
      return stream;
    };

    await collectEvents(emptyContext(), baseConfig({ getApiKey: async (p) => `dyn-${p}` }), streamFn);
    expect(capturedOptions?.apiKey).toBe("dyn-faux");

    await collectEvents(emptyContext(), baseConfig({ apiKey: "static-key" }), streamFn);
    expect(capturedOptions?.apiKey).toBe("static-key");
  });

  it("maps reasoning off to undefined and preserves other reasoning levels", async () => {
    let capturedReasoning: unknown;
    const final = mkAssistant("ok");
    const streamFn: StreamFn = (model, context, opts) => {
      capturedReasoning = (opts as Record<string, unknown>).reasoning;
      return createMockStream([{ type: "done", reason: "stop", message: final }])(model, context, opts);
    };

    await collectEvents(emptyContext(), baseConfig({ reasoning: "off" }), streamFn);
    expect(capturedReasoning).toBeUndefined();

    await collectEvents(emptyContext(), baseConfig({ reasoning: "high" }), streamFn);
    expect(capturedReasoning).toBe("high");
  });

  it("fallback path when stream completes without done/error: preserves partial replacement invariant", async () => {
    const final = mkAssistant("fallback");
    const partial: AssistantMessage = { ...final, content: [] };
    const nonTerminalEvents: AssistantMessageEvent[] = [
      { type: "start", partial },
      { type: "text_start", contentIndex: 0, partial },
    ];
    const ctx = emptyContext();
    const { events: emitted, result } = await collectEvents(
      ctx,
      baseConfig(),
      createEndingStream(nonTerminalEvents, final),
    );

    expect(emitted.map((e) => e.type)).toEqual([
      "request_start",
      "message_start",
      "message_update",
      "message_update",
      "message_end",
    ]);
    expect(result.content[0]).toEqual({ type: "text", text: "fallback" });
    expect(ctx.messages).toEqual([result]);
  });

  it("fallback path without start event: appends final and emits message_start and message_end", async () => {
    const final = mkAssistant("no-start-fallback");
    const ctx = emptyContext();
    const { events: emitted, result } = await collectEvents(ctx, baseConfig(), createEndingStream([], final));

    expect(emitted.map((e) => e.type)).toEqual(["request_start", "message_start", "message_end"]);
    expect(ctx.messages).toEqual([result]);
  });

  it("dispatches through default streamSimple when streamFn is omitted", async () => {
    const faux = registerFauxProvider();
    faux.setResponses([fauxAssistantMessage("faux stream result")]);

    const ctx = emptyContext();
    const config = baseConfig({
      model: faux.getModel(),
      convertToLlm: (m) => m as any,
    });
    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => {
      events.push(e);
    };

    try {
      const result = await (await import("../src/agent-loop/response-processing.ts")).streamAssistantResponse(
        ctx,
        config,
        undefined,
        emit,
      );
      expect(result.content[0]).toEqual({ type: "text", text: "faux stream result" });
      expect(events.map((e) => e.type)).toEqual([
        "request_start",
        "message_start",
        "message_update",
        "message_update",
        "message_update",
        "message_update",
        "message_end",
      ]);
    } finally {
      faux.unregister();
    }
  });
});
