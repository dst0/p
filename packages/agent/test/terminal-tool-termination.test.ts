import {
  type AssistantMessage,
  type AssistantMessageEvent,
  EventStream,
  type Message,
  type Model,
  type UserMessage,
} from "@dst0/p-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.ts";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentTool } from "../src/types.ts";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
  constructor(message: AssistantMessage) {
    super(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return event.message;
        if (event.type === "error") return event.error;
        throw new Error("Unexpected event type");
      },
    );
    queueMicrotask(() => this.push({ type: "done", reason: "toolUse", message }));
  }
}

function createUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
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

function createAssistantMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: "terminal-1", name: "terminal_audit", arguments: { value: "exhausted" } }],
    api: "openai-responses",
    provider: "openai",
    model: "mock",
    usage: createUsage(),
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

function createUserMessage(): UserMessage {
  return { role: "user", content: "complete the task", timestamp: Date.now() };
}

function identityConverter(messages: Parameters<AgentLoopConfig["convertToLlm"]>[0]): Message[] {
  return messages.filter(
    (message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult",
  ) as Message[];
}

describe("terminal tool termination", () => {
  it("stops before explicit-finish protocol repair", async () => {
    const toolSchema = Type.Object({ value: Type.String() });
    let executions = 0;
    const terminalTool: AgentTool<typeof toolSchema, { value: string }> = {
      name: "terminal_audit",
      label: "Terminal audit",
      description: "End the current task with a terminal diagnostic.",
      parameters: toolSchema,
      async execute(_toolCallId, params) {
        executions += 1;
        return {
          content: [{ type: "text", text: `terminal: ${params.value}` }],
          details: { value: params.value },
          terminate: true,
        };
      },
    };
    const context: AgentContext = { systemPrompt: "", messages: [], tools: [terminalTool] };
    const config: AgentLoopConfig = {
      model: createModel(),
      completionMode: "explicit_finish",
      convertToLlm: identityConverter,
    };
    const contexts: unknown[] = [];
    const events: AgentEvent[] = [];
    const stream = agentLoop([createUserMessage()], context, config, undefined, (_model, requestContext) => {
      contexts.push(requestContext);
      return new MockAssistantStream(createAssistantMessage());
    });
    for await (const event of stream) events.push(event);

    const messages = await stream.result();
    expect(executions).toBe(1);
    expect(contexts).toHaveLength(1);
    expect(messages.at(-1)).toMatchObject({ role: "toolResult" });
    expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "completion_protocol" && event.event === "finish_work_called"),
    ).toHaveLength(0);
  });
});
