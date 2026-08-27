import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  EventStream,
  type Message,
  type Model,
} from "@dst0/p-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.ts";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool } from "../src/types.ts";

class ScriptedAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
  constructor() {
    super(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return event.message;
        if (event.type === "error") return event.error;
        throw new Error("Unexpected provider event");
      },
    );
  }
}

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
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
    stopReason,
    timestamp: Date.now(),
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
    contextWindow: 8_192,
    maxTokens: 2_048,
  };
}

async function runResponses(
  responses: AssistantMessage[],
  context: AgentContext,
  config: Partial<AgentLoopConfig>,
): Promise<{ events: AgentEvent[]; messages: AgentMessage[]; providerContexts: Context[] }> {
  const providerContexts: Context[] = [];
  let responseIndex = 0;
  const stream = agentLoop(
    [{ role: "user", content: "Generate a long response", timestamp: Date.now() }],
    context,
    {
      model: createModel(),
      completionMode: "implicit",
      convertToLlm: (messages) => messages as Message[],
      ...config,
    },
    undefined,
    (_model, providerContext) => {
      providerContexts.push(providerContext);
      const response = responses[responseIndex++];
      if (!response) throw new Error(`Missing scripted response ${responseIndex - 1}`);
      const responseStream = new ScriptedAssistantStream();
      const reason =
        response.stopReason === "length" || response.stopReason === "toolUse" ? response.stopReason : "stop";
      queueMicrotask(() => responseStream.push({ type: "done", reason, message: response }));
      return responseStream;
    },
  );
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return { events, messages: await stream.result(), providerContexts };
}

function text(message: AgentMessage): string {
  if (!("content" in message)) return "";
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

describe("provider output-length continuation", () => {
  it("continues before honoring shouldStopAfterTurn", async () => {
    const shouldStopReasons: AssistantMessage["stopReason"][] = [];
    const { events, messages, providerContexts } = await runResponses(
      [assistant([{ type: "text", text: "prefix" }], "length"), assistant([{ type: "text", text: "tail" }], "stop")],
      { systemPrompt: "", messages: [], tools: [] },
      {
        shouldStopAfterTurn: ({ message }) => {
          shouldStopReasons.push(message.stopReason);
          return true;
        },
      },
    );

    expect(providerContexts).toHaveLength(2);
    expect(shouldStopReasons).toEqual(["stop"]);
    expect(
      providerContexts[1].messages.filter(
        (message) => message.role === "user" && message.metadata?.pInternal === "provider_length_continuation",
      ),
    ).toHaveLength(1);
    expect(messages.filter((message) => message.role === "assistant").map(text)).toEqual(["prefix", "tail"]);
    expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);
  });

  it("resets the consecutive-length allowance after a non-length tool turn", async () => {
    const schema = Type.Object({ value: Type.String() });
    const executed: string[] = [];
    const checkpoint: AgentTool<typeof schema, { value: string }> = {
      name: "checkpoint",
      label: "Checkpoint",
      description: "Record a checkpoint",
      parameters: schema,
      async execute(_id, params) {
        executed.push(params.value);
        return { content: [{ type: "text", text: params.value }], details: params };
      },
    };
    const length = (value: string) => assistant([{ type: "text", text: value }], "length");
    const responses = [
      length("before-1"),
      length("before-2"),
      assistant(
        [{ type: "toolCall", id: "checkpoint", name: checkpoint.name, arguments: { value: "reset" } }],
        "toolUse",
      ),
      length("after-1"),
      length("after-2"),
      length("after-3"),
      assistant([{ type: "text", text: "complete" }], "stop"),
    ];
    const { messages, providerContexts } = await runResponses(
      responses,
      { systemPrompt: "", messages: [], tools: [checkpoint] },
      {},
    );

    expect(executed).toEqual(["reset"]);
    expect(providerContexts).toHaveLength(7);
    expect(
      messages.filter(
        (message) => message.role === "user" && message.metadata?.pInternal === "provider_length_continuation",
      ),
    ).toHaveLength(5);
    expect(
      messages
        .filter((message) => message.role === "assistant")
        .map(text)
        .filter(Boolean),
    ).toEqual(["before-1", "before-2", "after-1", "after-2", "after-3", "complete"]);
  });

  it("uses one specialized provider-length repair for a hybrid partial tool call", async () => {
    const schema = Type.Object({ value: Type.String() });
    const executed: string[] = [];
    const tool: AgentTool<typeof schema, { value: string }> = {
      name: "dangerous_write",
      label: "Dangerous write",
      description: "Record content",
      parameters: schema,
      async execute(_id, params) {
        executed.push(params.value);
        return { content: [{ type: "text", text: params.value }], details: params };
      },
    };
    const responses = [
      assistant([{ type: "toolCall", id: "partial", name: tool.name, arguments: { value: "must-not-run" } }], "length"),
      assistant(
        [{ type: "toolCall", id: "finish", name: "finish_work", arguments: { status: "success", summary: "done" } }],
        "toolUse",
      ),
    ];
    const { events, providerContexts } = await runResponses(
      responses,
      { systemPrompt: "", messages: [], tools: [tool] },
      { completionMode: "hybrid" },
    );
    const providerLengthRepairs = providerContexts[1].messages.filter(
      (message) => message.role === "user" && message.metadata?.pInternal === "provider_length_continuation",
    );

    expect(executed).toEqual([]);
    expect(providerContexts).toHaveLength(2);
    expect(providerLengthRepairs).toHaveLength(1);
    expect(text(providerLengthRepairs[0])).toContain('pending "dangerous_write" call was not executed');
    expect(
      providerContexts[1].messages.filter(
        (message) => message.role === "user" && message.metadata?.pInternal === "completion_protocol_repair",
      ),
    ).toHaveLength(0);
    expect(
      events.filter((event) => event.type === "completion_protocol" && event.event === "malformed_tool_call_retry"),
    ).toHaveLength(1);
  });
});
