import type { AssistantMessage, TextContent } from "@dst0/p-ai";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { executePreparedToolCall, finalizeExecutedToolCall } from "../src/agent-loop/streaming-handler.ts";
import type { PreparedToolCall } from "../src/agent-loop/types.ts";
import { resolveToolEffect } from "../src/tool-effects.ts";
import type { AgentContext, AgentLoopConfig, AgentTool, AgentToolCall, AgentToolResult } from "../src/types.ts";

const mockTool: AgentTool = {
  name: "mock_tool",
  label: "Mock Tool",
  description: "test",
  parameters: Type.Object({}),
  execute: vi.fn(),
};
const mockContext: AgentContext = { systemPrompt: "test", messages: [], tools: [mockTool] };
const mockAssistantMessage: AssistantMessage = {
  role: "assistant",
  content: [],
  api: "faux",
  provider: "faux",
  model: "main",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 123,
};
const mockToolCall: AgentToolCall = { type: "toolCall", id: "tc_1", name: "mock_tool", arguments: {} };
const mockPrepared: PreparedToolCall = {
  kind: "prepared",
  toolCall: mockToolCall,
  tool: mockTool,
  args: {},
  effect: resolveToolEffect(mockTool.effect),
};
const textContent = (text: string): TextContent => ({ type: "text", text });

describe("executePreparedToolCall", () => {
  it("resolves and returns the result without error", async () => {
    const emit = vi.fn();
    const result: AgentToolResult<any> = { content: [textContent("ok")], details: {} };
    vi.mocked(mockTool.execute).mockResolvedValueOnce(result);

    const outcome = await executePreparedToolCall(mockPrepared, undefined, emit);
    expect(outcome.result).toBe(result);
    expect(outcome.isError).toBe(false);
  });

  it("handles errors thrown during execution", async () => {
    const emit = vi.fn();
    vi.mocked(mockTool.execute).mockRejectedValueOnce(new Error("Test error"));

    const outcome = await executePreparedToolCall(mockPrepared, undefined, emit);
    expect(outcome.isError).toBe(true);
    expect(outcome.result.content[0]).toMatchObject({ text: "Test error" });
  });

  it("emits tool_execution_update events and ignores updates after settle", async () => {
    const emit = vi.fn();
    const result: AgentToolResult<any> = { content: [], details: {} };
    vi.mocked(mockTool.execute).mockImplementationOnce(async (_id, _args, _sig, onUpdate) => {
      onUpdate?.({ content: [], details: { progress: 50 } });
      setTimeout(() => onUpdate?.({ content: [], details: { progress: 100 } }), 10);
      return result;
    });

    const outcome = await executePreparedToolCall(mockPrepared, undefined, emit);
    expect(outcome.result).toBe(result);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool_execution_update",
        partialResult: { content: [], details: { progress: 50 } },
      }),
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("handles error when update emit rejects", async () => {
    const emit = vi.fn().mockRejectedValue(new Error("emit update failed"));
    vi.mocked(mockTool.execute).mockImplementationOnce(async (_id, _args, _sig, onUpdate) => {
      onUpdate?.({ content: [], details: {} });
      return { content: [], details: {} };
    });
    const outcome = await executePreparedToolCall(mockPrepared, undefined, emit);
    expect(outcome.isError).toBe(true);
    expect(outcome.result.content[0]).toMatchObject({ text: "emit update failed" });
  });

  it("handles non-Error value thrown during tool execution", async () => {
    const emit = vi.fn();
    vi.mocked(mockTool.execute).mockRejectedValueOnce("raw string failure");
    const outcome = await executePreparedToolCall(mockPrepared, undefined, emit);
    expect(outcome.isError).toBe(true);
    expect(outcome.result.content[0]).toMatchObject({ text: "raw string failure" });
  });
});

describe("finalizeExecutedToolCall", () => {
  const executedOutcome = {
    result: { content: [textContent("original")], details: {}, terminate: false },
    isError: false,
  };

  it("returns executed result as-is when no afterToolCall hook exists", async () => {
    const res = await finalizeExecutedToolCall(
      mockContext,
      mockAssistantMessage,
      mockPrepared,
      executedOutcome,
      { model: {} as any, convertToLlm: () => [] },
      undefined,
    );
    expect(res.result.content[0]).toEqual(textContent("original"));
    expect(res.isError).toBe(false);
  });

  it("applies partial overrides from afterToolCall", async () => {
    const config: AgentLoopConfig = {
      model: {} as any,
      convertToLlm: () => [],
      afterToolCall: async () => ({ terminate: true }),
    };
    const res = await finalizeExecutedToolCall(
      mockContext,
      mockAssistantMessage,
      mockPrepared,
      executedOutcome,
      config,
      undefined,
    );
    expect(res.result.content[0]).toEqual(textContent("original"));
    expect(res.result.terminate).toBe(true);
  });

  it("afterToolCall returning undefined keeps original result", async () => {
    const config: AgentLoopConfig = {
      model: {} as any,
      convertToLlm: () => [],
      afterToolCall: async () => undefined,
    };
    const res = await finalizeExecutedToolCall(
      mockContext,
      mockAssistantMessage,
      mockPrepared,
      executedOutcome,
      config,
      undefined,
    );
    expect(res.result.content[0]).toEqual(textContent("original"));
    expect(res.isError).toBe(false);
  });

  it("applies all override fields from afterToolCall and falls back for undefined fields", async () => {
    const config: AgentLoopConfig = {
      model: {} as any,
      convertToLlm: () => [],
      afterToolCall: async () => ({
        content: [textContent("replaced")],
        details: { custom: true },
        progress: "waiting" as const,
        terminate: undefined,
        isError: true,
      }),
    };
    const executedWithTerminate = { ...executedOutcome, result: { ...executedOutcome.result, terminate: true } };
    const res = await finalizeExecutedToolCall(
      mockContext,
      mockAssistantMessage,
      mockPrepared,
      executedWithTerminate,
      config,
      undefined,
    );
    expect(res.result.content[0]).toEqual(textContent("replaced"));
    expect(res.result.details).toEqual({ custom: true });
    expect(res.result.progress).toBe("waiting");
    expect(res.result.terminate).toBe(true);
    expect(res.isError).toBe(true);
  });

  it("catches errors in afterToolCall and returns error result", async () => {
    const config: AgentLoopConfig = {
      model: {} as any,
      convertToLlm: () => [],
      afterToolCall: async () => {
        throw new Error("Hook error");
      },
    };
    const res = await finalizeExecutedToolCall(
      mockContext,
      mockAssistantMessage,
      mockPrepared,
      executedOutcome,
      config,
      undefined,
    );
    expect(res.isError).toBe(true);
    expect(res.result.content[0]).toEqual(expect.objectContaining({ text: "Hook error" }));
  });

  it("handles non-Error thrown in afterToolCall", async () => {
    const config: AgentLoopConfig = {
      model: {} as any,
      convertToLlm: () => [],
      afterToolCall: async () => {
        throw "string hook error";
      },
    };
    const res = await finalizeExecutedToolCall(
      mockContext,
      mockAssistantMessage,
      mockPrepared,
      executedOutcome,
      config,
      undefined,
    );
    expect(res.isError).toBe(true);
    expect(res.result.content[0]).toEqual(expect.objectContaining({ text: "string hook error" }));
  });
});
