import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  EventStream,
  type Message,
  type Model,
  type UserMessage,
} from "@dst0/p-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.ts";
import { FINISH_WORK_TOOL_NAME } from "../src/completion-protocol.ts";
import type { AgentContext, AgentEvent, AgentMessage, AgentTool, AgentToolCall } from "../src/types.ts";

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
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

function createToolCall(id: string, name: string, args: Record<string, unknown> = {}): AgentToolCall {
  return { type: "toolCall", id, name, arguments: args };
}

function createUserMessage(): UserMessage {
  return { role: "user", content: "complete the task", timestamp: Date.now() };
}

function identityConverter(messages: AgentMessage[]): Message[] {
  return messages.filter((message) => ["user", "assistant", "toolResult"].includes(message.role)) as Message[];
}

async function runWaitScript(
  responses: AssistantMessage[],
  tools: AgentTool[],
  maxConsecutiveWaitingTurns = 3,
): Promise<{ events: AgentEvent[]; contexts: Context[] }> {
  let callIndex = 0;
  const contexts: Context[] = [];
  const stream = agentLoop(
    [createUserMessage()],
    { systemPrompt: "", messages: [], tools } satisfies AgentContext,
    {
      model: createModel(),
      completionMode: "explicit_finish",
      completionLimits: {
        maxConsecutiveWaitingTurns,
        maxMalformedToolRetries: 1,
        maxNoProgressTurns: 20,
      },
      convertToLlm: identityConverter,
    },
    undefined,
    (_model, context) => {
      contexts.push(context);
      const response = responses[callIndex++];
      if (!response) throw new Error(`Missing scripted response ${callIndex}`);
      const assistantStream = new MockAssistantStream();
      queueMicrotask(() => assistantStream.push({ type: "done", reason: "toolUse", message: response }));
      return assistantStream;
    },
  );
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  await stream.result();
  return { events, contexts };
}

function createTestTools(executed: string[]): AgentTool[] {
  const sleepSchema = Type.Object({
    seconds: Type.Number(),
    check: Type.Object({
      tool: Type.String(),
      arguments: Type.Record(Type.String(), Type.Unknown()),
    }),
  });
  const waitSchema = Type.Object({});
  const echoSchema = Type.Object({ value: Type.String() });
  return [
    {
      name: "sleep",
      label: "Sleep",
      description: "Wait and then check",
      parameters: sleepSchema,
      executionMode: "sequential",
      async execute() {
        executed.push("sleep");
        return {
          content: [{ type: "text", text: "Wait complete" }],
          details: {},
          progress: "waiting",
        };
      },
    },
    {
      name: "wait_event",
      label: "Wait event",
      description: "Test a wait-only result from a self-observing tool",
      parameters: waitSchema,
      async execute() {
        executed.push("wait_event");
        return {
          content: [{ type: "text", text: "No new event" }],
          details: {},
          progress: "waiting",
        };
      },
    },
    {
      name: "echo",
      label: "Echo",
      description: "Produce evidence",
      parameters: echoSchema,
      async execute(_id, input) {
        const { value } = input as { value: string };
        executed.push(value);
        return {
          content: [{ type: "text", text: value }],
          details: {},
          progress: "made_progress",
        };
      },
    },
  ];
}

describe("wait-loop recovery", () => {
  it("repairs malformed wait intent and executes a structured wait-check pair", async () => {
    const executed: string[] = [];
    const { events, contexts } = await runWaitScript(
      [
        createAssistantMessage([
          { type: "text", text: "The PR page is loading. Let me wait a moment and then inspect it." },
        ]),
        createAssistantMessage([
          createToolCall("sleep-1", "sleep", {
            seconds: 0,
            check: { tool: "echo", arguments: { value: "new evidence" } },
          }),
        ]),
        createAssistantMessage([
          createToolCall("finish-1", FINISH_WORK_TOOL_NAME, { status: "success", summary: "done" }),
        ]),
      ],
      createTestTools(executed),
    );

    expect(executed).toEqual(["sleep", "new evidence"]);
    expect(contexts).toHaveLength(3);
    expect(JSON.stringify(contexts[1].messages)).toContain("check: { tool, arguments }");
    expect(
      events.filter((event) => event.type === "completion_protocol" && event.event === "malformed_tool_call_retry"),
    ).toHaveLength(1);
    expect(
      events
        .filter((event) => event.type === "tool_execution_start")
        .map((event) => event.toolName)
        .filter((name) => name !== FINISH_WORK_TOOL_NAME),
    ).toEqual(["sleep", "echo"]);
    expect(
      events.filter((event) => event.type === "completion_protocol" && event.event === "waiting_loop_stop"),
    ).toHaveLength(0);
  });

  it("stops repeated wait-only turns without using the generic malformed-response limit", async () => {
    const executed: string[] = [];
    const waitOnly = createAssistantMessage([createToolCall("wait-event", "wait_event")]);
    const { events, contexts } = await runWaitScript([waitOnly, waitOnly, waitOnly], createTestTools(executed));

    expect(executed).toEqual(["wait_event", "wait_event", "wait_event"]);
    expect(contexts).toHaveLength(3);
    expect(
      events.filter((event) => event.type === "completion_protocol" && event.event === "malformed_tool_call_retry"),
    ).toHaveLength(0);
    expect(
      events.filter((event) => event.type === "completion_protocol" && event.event === "waiting_loop_stop"),
    ).toHaveLength(1);
  });

  it("rejects bare and recursive sleeps before waiting", async () => {
    const executed: string[] = [];
    const { events } = await runWaitScript(
      [
        createAssistantMessage([createToolCall("sleep-without-check", "sleep", { seconds: 0 })]),
        createAssistantMessage([
          createToolCall("sleep-checking-sleep", "sleep", {
            seconds: 0,
            check: { tool: "sleep", arguments: { seconds: 0 } },
          }),
        ]),
        createAssistantMessage([
          createToolCall("finish-1", FINISH_WORK_TOOL_NAME, { status: "success", summary: "done" }),
        ]),
      ],
      createTestTools(executed),
    );

    expect(executed).toEqual([]);
    const sleepEnds = events.filter((event) => event.type === "tool_execution_end" && event.toolName === "sleep");
    expect(sleepEnds).toHaveLength(2);
    expect(sleepEnds.every((event) => event.type === "tool_execution_end" && event.isError)).toBe(true);
    expect(
      sleepEnds.map((event) => (event.type === "tool_execution_end" ? event.result.content[0] : undefined)),
    ).toEqual([
      expect.objectContaining({ type: "text", text: expect.stringContaining("a bare wait is not allowed") }),
      expect.objectContaining({ type: "text", text: expect.stringContaining("cannot call sleep") }),
    ]);
  });

  it("does not limit long sequences of tools that keep producing evidence", async () => {
    const executed: string[] = [];
    const productiveCalls = Array.from({ length: 8 }, (_, index) =>
      createAssistantMessage([createToolCall(`echo-${index}`, "echo", { value: `evidence-${index}` })]),
    );
    const { events, contexts } = await runWaitScript(
      [
        ...productiveCalls,
        createAssistantMessage([
          createToolCall("finish-1", FINISH_WORK_TOOL_NAME, { status: "success", summary: "done" }),
        ]),
      ],
      createTestTools(executed),
      2,
    );

    expect(executed).toHaveLength(8);
    expect(contexts).toHaveLength(9);
    expect(
      events.filter((event) => event.type === "completion_protocol" && event.event === "waiting_loop_stop"),
    ).toHaveLength(0);
  });
});
