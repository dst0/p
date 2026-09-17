import {
  type AssistantMessage,
  type AssistantMessageEvent,
  EventStream,
  type Message,
  type Model,
  type ToolResultMessage,
  type UserMessage,
} from "@dst0/p-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { extractMisplacedJsonToolCalls, extractMisplacedToolCalls } from "../src/agent-loop/tool-dispatch.ts";
import { recoverMisplacedToolCalls } from "../src/agent-loop/tool-execution.ts";
import { agentLoop } from "../src/agent-loop.ts";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool } from "../src/types.ts";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
  constructor() {
    super(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return event.message;
        if (event.type === "error") return event.error;
        throw new Error("Unexpected event type");
      },
    );
  }
}

function createModel(): Model<"openai-responses"> {
  return {
    id: "mock",
    name: "mock",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 2048,
  };
}

function createAssistantMessage(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-responses",
    provider: "openai",
    model: "mock",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function createUserMessage(text: string): UserMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

function identityConverter(messages: AgentMessage[]): Message[] {
  return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
}

const echoToolSchema = Type.Object({ value: Type.String() });

function createEchoTool(executed: string[]): AgentTool<typeof echoToolSchema, { value: string }> {
  return {
    name: "echo",
    label: "Echo",
    description: "Echo tool",
    parameters: echoToolSchema,
    async execute(_toolCallId, params) {
      executed.push(params.value);
      return {
        content: [{ type: "text", text: `echoed: ${params.value}` }],
        details: { value: params.value },
      };
    },
  };
}

function isToolResultMessageEnd(
  event: AgentEvent,
): event is Extract<AgentEvent, { type: "message_end" }> & { message: ToolResultMessage } {
  return event.type === "message_end" && event.message.role === "toolResult";
}

async function runRecoveryLoop(
  firstContent: AssistantMessage["content"],
  tools: AgentTool[] | undefined,
): Promise<{ events: AgentEvent[]; callIndex: number }> {
  const context: AgentContext = { systemPrompt: "", messages: [], tools };
  const config: AgentLoopConfig = {
    model: createModel(),
    completionMode: "implicit",
    convertToLlm: identityConverter,
  };
  let callIndex = 0;
  const stream = agentLoop([createUserMessage("test prompt")], context, config, undefined, () => {
    const mockStream = new MockAssistantStream();
    queueMicrotask(() => {
      if (callIndex === 0) {
        mockStream.push({ type: "done", reason: "stop", message: createAssistantMessage(firstContent) });
      } else {
        mockStream.push({
          type: "done",
          reason: "stop",
          message: createAssistantMessage([{ type: "text", text: "done" }]),
        });
      }
      callIndex++;
    });
    return mockStream;
  });
  const events: AgentEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return { events, callIndex };
}

describe("misplaced JSON tool recovery filtering", () => {
  it("should not recover raw thinking JSON using an unknown tool name", async () => {
    const executed: string[] = [];
    const thinking = JSON.stringify({ name: "hypothetical_tool", arguments: { target: "test" } });
    const { events, callIndex } = await runRecoveryLoop([{ type: "thinking", thinking }], [createEchoTool(executed)]);
    expect(executed).toEqual([]);
    expect(events.some(isToolResultMessageEnd)).toBe(false);
    expect(callIndex).toBe(1);
  });

  it("should not recover fenced markdown JSON using an unknown tool name", async () => {
    const executed: string[] = [];
    const fence = `\`\`\`json\n${JSON.stringify({ name: "hypothetical_tool", arguments: {} })}\n\`\`\``;
    const { events, callIndex } = await runRecoveryLoop([{ type: "text", text: fence }], [createEchoTool(executed)]);
    expect(executed).toEqual([]);
    expect(events.some(isToolResultMessageEnd)).toBe(false);
    expect(callIndex).toBe(1);
  });

  it("should not recover fenced markdown JSONC using an unknown tool name", async () => {
    const executed: string[] = [];
    const fence = `\`\`\`jsonc\n${JSON.stringify({ name: "hypothetical_tool", arguments: {} })}\n\`\`\``;
    const { events, callIndex } = await runRecoveryLoop([{ type: "text", text: fence }], [createEchoTool(executed)]);
    expect(executed).toEqual([]);
    expect(events.some(isToolResultMessageEnd)).toBe(false);
    expect(callIndex).toBe(1);
  });

  it("should not recover JSON tool calls when registered tool set is empty", async () => {
    const fence = `\`\`\`json\n${JSON.stringify({ name: "echo", arguments: { value: "x" } })}\n\`\`\``;
    const { events, callIndex } = await runRecoveryLoop([{ type: "text", text: fence }], []);
    expect(events.some(isToolResultMessageEnd)).toBe(false);
    expect(callIndex).toBe(1);
  });

  it("should still recover and execute a registered tool call from fenced JSON", async () => {
    const executed: string[] = [];
    const fence = `\`\`\`json\n${JSON.stringify({ name: "echo", arguments: { value: "recovered" } })}\n\`\`\``;
    const { events, callIndex } = await runRecoveryLoop([{ type: "text", text: fence }], [createEchoTool(executed)]);
    expect(executed).toEqual(["recovered"]);
    expect(events.find(isToolResultMessageEnd)?.message.isError).toBe(false);
    expect(callIndex).toBe(2);
  });

  it("should still recover and execute a registered tool call from raw thinking JSON", async () => {
    const executed: string[] = [];
    const thinking = JSON.stringify({ name: "echo", arguments: { value: "from thinking" } });
    const { events, callIndex } = await runRecoveryLoop([{ type: "thinking", thinking }], [createEchoTool(executed)]);
    expect(executed).toEqual(["from thinking"]);
    expect(events.find(isToolResultMessageEnd)?.message.isError).toBe(false);
    expect(callIndex).toBe(2);
  });

  it("should preserve explicit XML unknown tool recovery as an error tool result", async () => {
    const executed: string[] = [];
    const xml = "<tool_call><function=missing><parameter=value>x</parameter></function></tool_call>";
    const { events, callIndex } = await runRecoveryLoop([{ type: "text", text: xml }], [createEchoTool(executed)]);
    expect(executed).toEqual([]);
    expect(events.find(isToolResultMessageEnd)?.message.isError).toBe(true);
    expect(callIndex).toBe(2);
  });

  it("should filter unknown tool names in direct extract functions", () => {
    const text = `\`\`\`json\n${JSON.stringify({ name: "hypothetical_tool", arguments: {} })}\n\`\`\``;
    const toolNames = new Set(["echo"]);
    expect(extractMisplacedJsonToolCalls(text, toolNames)).toEqual([]);
    expect(extractMisplacedJsonToolCalls(text, new Set())).toEqual([]);

    const validText = `\`\`\`json\n${JSON.stringify({ name: "echo", arguments: { value: "ok" } })}\n\`\`\``;
    expect(extractMisplacedJsonToolCalls(validText, toolNames)).toEqual([{ name: "echo", arguments: { value: "ok" } }]);

    const msg = createAssistantMessage([{ type: "text", text }]);
    expect(extractMisplacedToolCalls(msg, [createEchoTool([])])).toEqual([]);
  });

  it("removes only recovered JSON tool blocks from assistant text while preserving surrounding prose", () => {
    const text = `Prose before tool call\n\`\`\`json\n${JSON.stringify({ name: "echo", arguments: { value: "first" } })}\n\`\`\`\nProse after tool call`;
    const msg = createAssistantMessage([{ type: "text", text }]);
    const recovered = recoverMisplacedToolCalls(msg, [createEchoTool([])]);

    expect(recovered.content).toHaveLength(2);
    expect(recovered.content[0]).toEqual({
      type: "text",
      text: "Prose before tool call\n\nProse after tool call",
    });
    expect(recovered.content[1]).toMatchObject({
      type: "toolCall",
      name: "echo",
      arguments: { value: "first" },
    });
  });

  it("preserves repeated JSON calls as distinct actions", () => {
    const calls = ["call_1", "call_2"].map((id) => ({
      id,
      type: "function",
      function: { name: "echo", arguments: JSON.stringify({ value: "same" }) },
    }));
    const fence = `\`\`\`json\n${JSON.stringify({ tool_calls: calls })}\n\`\`\``;
    const recovered = recoverMisplacedToolCalls(createAssistantMessage([{ type: "text", text: fence }]), [
      createEchoTool([]),
    ]);

    expect(recovered.content.filter((block) => block.type === "text")).toEqual([]);
    expect(recovered.content.filter((block) => block.type === "toolCall")).toHaveLength(2);
  });

  it("deduplicates matching XML and JSON calls one-to-one", () => {
    const xml = `<tool_call><function=echo><arguments>${JSON.stringify({ value: "same" })}</arguments></function></tool_call>`;
    const calls = ["call_1", "call_2"].map((id) => ({
      id,
      type: "function",
      function: { name: "echo", arguments: JSON.stringify({ value: "same" }) },
    }));
    const json = `\`\`\`json\n${JSON.stringify({ tool_calls: calls })}\n\`\`\``;
    const recovered = recoverMisplacedToolCalls(createAssistantMessage([{ type: "text", text: `${xml}\n${json}` }]), [
      createEchoTool([]),
    ]);

    expect(recovered.content.filter((block) => block.type === "text")).toEqual([]);
    expect(recovered.content.filter((block) => block.type === "toolCall")).toHaveLength(2);
  });

  it("deduplicates cross-format arguments regardless of object key order", () => {
    const xmlArguments = { value: "same", metadata: { first: 1, second: 2 } };
    const jsonArguments = { metadata: { second: 2, first: 1 }, value: "same" };
    const xml = `<tool_call><function=echo><arguments>${JSON.stringify(xmlArguments)}</arguments></function></tool_call>`;
    const json = `\`\`\`json\n${JSON.stringify({
      tool_calls: [{ id: "call_1", type: "function", function: { name: "echo", arguments: jsonArguments } }],
    })}\n\`\`\``;
    const recovered = recoverMisplacedToolCalls(createAssistantMessage([{ type: "text", text: `${xml}\n${json}` }]), [
      createEchoTool([]),
    ]);

    expect(recovered.content.filter((block) => block.type === "toolCall")).toHaveLength(1);
  });

  it("does not canonicalize deeply nested arguments when no XML call needs deduplication", () => {
    const nestedArguments = `${'{"child":'.repeat(6_000)}0${"}".repeat(6_000)}`;
    const fence = `\`\`\`json\n${JSON.stringify({ name: "echo", arguments: nestedArguments })}\n\`\`\``;

    let recovered: AssistantMessage | undefined;
    expect(() => {
      recovered = recoverMisplacedToolCalls(createAssistantMessage([{ type: "text", text: fence }]), [
        createEchoTool([]),
      ]);
    }).not.toThrow();
    expect(recovered?.content.filter((block) => block.type === "toolCall")).toHaveLength(1);
  });

  it("removes the text block entirely when it contains only the recovered JSON tool block", () => {
    const fence = `\`\`\`json\n${JSON.stringify({ name: "echo", arguments: { value: "only" } })}\n\`\`\``;
    const msg = createAssistantMessage([{ type: "text", text: fence }]);
    const recovered = recoverMisplacedToolCalls(msg, [createEchoTool([])]);

    expect(recovered.content).toHaveLength(1);
    expect(recovered.content[0]).toMatchObject({
      type: "toolCall",
      name: "echo",
      arguments: { value: "only" },
    });
  });
});
