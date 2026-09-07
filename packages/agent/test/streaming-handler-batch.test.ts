import type { AssistantMessage, ToolResultMessage } from "@dst0/p-ai";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { executeToolCallsParallel } from "../src/agent-loop/context-management.ts";
import {
  createExecutedToolCallBatch,
  createToolResultMessage,
  emitToolExecutionEnd,
  emitToolResultMessage,
  executeToolCallsSequential,
  shouldTerminateToolBatch,
} from "../src/agent-loop/streaming-handler.ts";
import type { FinalizedToolCallOutcome } from "../src/agent-loop/types.ts";
import type { AgentContext, AgentLoopConfig, AgentTool, AgentToolCall } from "../src/types.ts";

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

describe("emitToolExecutionEnd", () => {
  it("emits the correct tool_execution_end event", async () => {
    const emit = vi.fn();
    const finalized = {
      toolCall: mockToolCall,
      result: { content: [], details: {} },
      isError: true,
      executed: true,
    } as FinalizedToolCallOutcome & { executed: boolean };
    await emitToolExecutionEnd(finalized, emit);
    expect(emit).toHaveBeenCalledWith({
      type: "tool_execution_end",
      toolCallId: "tc_1",
      toolName: "mock_tool",
      result: finalized.result,
      isError: true,
      executed: true,
    });
  });
});

describe("createToolResultMessage", () => {
  it("creates a ToolResultMessage shape correctly", () => {
    const finalized: FinalizedToolCallOutcome = {
      toolCall: mockToolCall,
      result: { content: [], details: { a: 1 } },
      isError: false,
      executed: true,
    };
    const msg = createToolResultMessage(finalized);
    expect(msg.role).toBe("toolResult");
    expect(msg.toolCallId).toBe("tc_1");
    expect(msg.toolName).toBe("mock_tool");
    expect(msg.content).toEqual([]);
    expect(msg.details).toEqual({ a: 1 });
    expect(msg.isError).toBe(false);
    expect(typeof msg.timestamp).toBe("number");
  });
});

describe("emitToolResultMessage", () => {
  it("emits message_start and message_end events sequentially", async () => {
    const emit = vi.fn();
    const msg: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "1",
      toolName: "test",
      content: [],
      isError: false,
      timestamp: 123,
    };
    await emitToolResultMessage(msg, emit);
    expect(emit).toHaveBeenNthCalledWith(1, { type: "message_start", message: msg });
    expect(emit).toHaveBeenNthCalledWith(2, { type: "message_end", message: msg });
  });
});

describe("shouldTerminateToolBatch", () => {
  it("returns false for empty array", () => {
    expect(shouldTerminateToolBatch([])).toBe(false);
  });

  it("returns true if all entries have terminate: true", () => {
    const list: FinalizedToolCallOutcome[] = [
      { toolCall: mockToolCall, result: { content: [], details: {}, terminate: true }, isError: false, executed: true },
      { toolCall: mockToolCall, result: { content: [], details: {}, terminate: true }, isError: false, executed: true },
    ];
    expect(shouldTerminateToolBatch(list)).toBe(true);
  });

  it("returns false if mixed or some undefined", () => {
    const list: FinalizedToolCallOutcome[] = [
      { toolCall: mockToolCall, result: { content: [], details: {}, terminate: true }, isError: false, executed: true },
      { toolCall: mockToolCall, result: { content: [], details: {} }, isError: false, executed: true },
    ];
    expect(shouldTerminateToolBatch(list)).toBe(false);
  });
});

describe("createExecutedToolCallBatch", () => {
  it("identifies madeProgress", () => {
    const finalized: FinalizedToolCallOutcome[] = [
      {
        toolCall: mockToolCall,
        result: { content: [], details: {}, progress: "made_progress" },
        isError: false,
        executed: true,
      },
    ];
    const batch = createExecutedToolCallBatch([], finalized);
    expect(batch.madeProgress).toBe(true);
    expect(batch.waiting).toBe(false);
  });

  it("identifies waiting", () => {
    const finalized: FinalizedToolCallOutcome[] = [
      {
        toolCall: mockToolCall,
        result: { content: [], details: {}, progress: "waiting" },
        isError: false,
        executed: true,
      },
    ];
    const batch = createExecutedToolCallBatch([], finalized);
    expect(batch.madeProgress).toBe(false);
    expect(batch.waiting).toBe(true);
  });

  it("handles errors as neither progress nor waiting", () => {
    const finalized: FinalizedToolCallOutcome[] = [
      { toolCall: mockToolCall, result: { content: [], details: {} }, isError: true, executed: true },
    ];
    const batch = createExecutedToolCallBatch([], finalized);
    expect(batch.madeProgress).toBe(false);
    expect(batch.waiting).toBe(false);
  });
});

describe("executeToolCallsSequential", () => {
  const config: AgentLoopConfig = { model: {} as any, convertToLlm: () => [] };

  it("executes full sequential flow", async () => {
    const emit = vi.fn();
    const tc1: AgentToolCall = { type: "toolCall", id: "tc1", name: "mock_tool", arguments: {} };
    const tc2: AgentToolCall = { type: "toolCall", id: "tc2", name: "mock_tool", arguments: {} };
    vi.mocked(mockTool.execute).mockResolvedValue({ content: [], details: {} });

    const batch = await executeToolCallsSequential(
      mockContext,
      mockAssistantMessage,
      [tc1, tc2],
      config,
      undefined,
      emit,
    );
    expect(batch.messages).toHaveLength(2);
    expect(emit.mock.calls.filter((c) => c[0].type === "tool_execution_start")).toHaveLength(2);
    expect(emit.mock.calls.filter((c) => c[0].type === "tool_execution_end")).toHaveLength(2);
  });

  it("handles immediate outcome path (tool not found)", async () => {
    const emit = vi.fn();
    const badTc: AgentToolCall = { type: "toolCall", id: "bad", name: "missing_tool", arguments: {} };
    const batch = await executeToolCallsSequential(mockContext, mockAssistantMessage, [badTc], config, undefined, emit);
    expect(batch.messages).toHaveLength(1);
    expect(batch.messages[0].isError).toBe(true);
    const endEvents = emit.mock.calls.filter((c) => c[0].type === "tool_execution_end");
    expect(endEvents).toHaveLength(1);
    expect(endEvents[0]?.[0]).toMatchObject({ executed: false });
  });

  it("aborts mid-batch", async () => {
    const emit = vi.fn();
    const tc1: AgentToolCall = { type: "toolCall", id: "tc1", name: "mock_tool", arguments: {} };
    const tc2: AgentToolCall = { type: "toolCall", id: "tc2", name: "mock_tool", arguments: {} };
    const ac = new AbortController();

    vi.mocked(mockTool.execute).mockImplementationOnce(async () => {
      ac.abort();
      return { content: [], details: {} };
    });

    const batch = await executeToolCallsSequential(
      mockContext,
      mockAssistantMessage,
      [tc1, tc2],
      config,
      ac.signal,
      emit,
    );
    expect(batch.messages).toHaveLength(1);
    expect(emit.mock.calls.filter((c) => c[0].type === "tool_execution_start")).toHaveLength(1);
  });
});

describe("executeToolCallsParallel", () => {
  it("distinguishes blocked calls from successful and throwing executions", async () => {
    const emit = vi.fn();
    const toolCalls: AgentToolCall[] = [
      { type: "toolCall", id: "blocked", name: "mock_tool", arguments: {} },
      { type: "toolCall", id: "successful", name: "mock_tool", arguments: {} },
      { type: "toolCall", id: "throwing", name: "mock_tool", arguments: {} },
    ];
    vi.mocked(mockTool.execute).mockReset();
    vi.mocked(mockTool.execute).mockImplementation(async (toolCallId) => {
      if (toolCallId === "throwing") throw new Error("expected failure");
      return { content: [], details: {} };
    });

    const batch = await executeToolCallsParallel(
      mockContext,
      mockAssistantMessage,
      toolCalls,
      {
        model: {} as any,
        convertToLlm: () => [],
        beforeToolCall: async ({ toolCall }) =>
          toolCall.id === "blocked" ? { block: true, reason: "verification required" } : undefined,
      },
      undefined,
      emit,
    );

    expect(batch.messages).toHaveLength(3);
    expect(vi.mocked(mockTool.execute).mock.calls.map(([toolCallId]) => toolCallId)).toEqual([
      "successful",
      "throwing",
    ]);
    const endEvents = emit.mock.calls.map(([event]) => event).filter((event) => event.type === "tool_execution_end");
    expect(endEvents).toHaveLength(3);
    expect(endEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolCallId: "blocked", isError: true, executed: false }),
        expect.objectContaining({ toolCallId: "successful", isError: false, executed: true }),
        expect.objectContaining({ toolCallId: "throwing", isError: true, executed: true }),
      ]),
    );
  });
});
