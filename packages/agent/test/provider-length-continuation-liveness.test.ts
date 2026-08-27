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
  signal?: AbortSignal,
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
    signal,
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

describe("provider output-length continuation liveness", () => {
  it.each(["explicit_finish", "hybrid"] as const)(
    "executes no partial calls and one final complete call in %s mode",
    async (completionMode) => {
      const schema = Type.Object({ value: Type.String() });
      const executed: string[] = [];
      const write: AgentTool<typeof schema, { value: string }> = {
        name: "write_once_complete",
        label: "Write once complete",
        description: "Record only complete calls",
        parameters: schema,
        async execute(_id, params) {
          executed.push(params.value);
          return { content: [{ type: "text", text: params.value }], details: params };
        },
      };
      const partials = Array.from({ length: 6 }, (_value, index) =>
        assistant(
          [{ type: "toolCall", id: `partial-${index}`, name: write.name, arguments: { value: `partial-${index}` } }],
          "length",
        ),
      );
      const { messages, providerContexts } = await runResponses(
        [
          ...partials,
          assistant(
            [{ type: "toolCall", id: "complete", name: write.name, arguments: { value: "complete" } }],
            "toolUse",
          ),
          assistant(
            [
              {
                type: "toolCall",
                id: "finish",
                name: "finish_work",
                arguments: { status: "success", summary: "done" },
              },
            ],
            "toolUse",
          ),
        ],
        { systemPrompt: "", messages: [], tools: [write] },
        { completionMode },
      );

      expect(executed).toEqual(["complete"]);
      expect(providerContexts).toHaveLength(partials.length + 2);
      expect(
        messages.filter(
          (message) => message.role === "user" && message.metadata?.pInternal === "provider_length_continuation",
        ),
      ).toHaveLength(partials.length);
      expect(messages.some((message) => message.role === "assistant" && message.stopReason === "error")).toBe(false);
    },
  );

  it.each(["explicit_finish", "hybrid"] as const)(
    "does not consume %s completion turns for provider-length segments",
    async (completionMode) => {
      const segments = ["segment-1", "segment-2", "segment-3", "segment-4", "segment-5", "segment-6"];
      const { events, messages, providerContexts } = await runResponses(
        [
          ...segments.map((segment) => assistant([{ type: "text", text: segment }], "length")),
          assistant(
            [
              {
                type: "toolCall",
                id: "finish",
                name: "finish_work",
                arguments: { status: "success", summary: "done" },
              },
            ],
            "toolUse",
          ),
        ],
        { systemPrompt: "", messages: [], tools: [] },
        { completionMode, completionLimits: { maxTurns: 1 } },
      );

      expect(providerContexts).toHaveLength(segments.length + 1);
      expect(
        messages
          .filter((message) => message.role === "assistant")
          .map(text)
          .filter(Boolean),
      ).toEqual(segments);
      expect(
        events.filter((event) => event.type === "completion_protocol" && event.event === "finish_work_called"),
      ).toHaveLength(1);
    },
  );

  it("stops before another provider request when the caller aborts after repeated segments", async () => {
    const abortController = new AbortController();
    let completedLengthTurns = 0;
    const segments = ["segment-1", "segment-2", "segment-3", "segment-4"];
    const { events, messages, providerContexts } = await runResponses(
      segments.map((segment) => assistant([{ type: "text", text: segment }], "length")),
      { systemPrompt: "", messages: [], tools: [] },
      {
        prepareNextTurn: ({ message }) => {
          if (message.stopReason === "length" && ++completedLengthTurns === segments.length) abortController.abort();
          return undefined;
        },
      },
      abortController.signal,
    );

    expect(providerContexts).toHaveLength(segments.length);
    expect(messages.filter((message) => message.role === "assistant").map(text)).toEqual(segments);
    expect(messages.some((message) => message.role === "assistant" && message.stopReason === "error")).toBe(false);
    expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);
    expect(abortController.signal.aborted).toBe(true);
  });
});
