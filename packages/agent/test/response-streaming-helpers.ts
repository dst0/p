import {
  type AssistantMessage,
  type AssistantMessageEvent,
  EventStream,
  type Message,
  type Model,
  type Usage,
} from "@dst0/p-ai";
import { streamAssistantResponse } from "../src/agent-loop/response-processing.ts";
import type { AgentEventSink } from "../src/agent-loop/types.ts";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, StreamFn } from "../src/types.ts";

export const usage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export const testModel: Model<string> = {
  id: "main",
  name: "Main",
  api: "faux",
  provider: "faux",
  baseUrl: "http://localhost:0",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};

export function mkAssistant(
  text: string,
  stopReason: AssistantMessage["stopReason"] = "stop",
  extra?: Partial<AssistantMessage>,
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: testModel.api,
    provider: testModel.provider,
    model: testModel.id,
    usage,
    stopReason,
    timestamp: Date.now(),
    ...extra,
  };
}

function isLlmMessage(message: AgentMessage): message is Message {
  return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}

export function createMockStream(events: AssistantMessageEvent[]): StreamFn {
  return () => {
    const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return event.message;
        if (event.type === "error") return event.error;
        throw new Error("Unexpected event type");
      },
    );
    queueMicrotask(() => {
      for (const event of events) {
        stream.push(event);
      }
    });
    return stream;
  };
}

/** Creates a stream that ends without a done/error event (for fallback path coverage). */
export function createEndingStream(events: AssistantMessageEvent[], finalMessage: AssistantMessage): StreamFn {
  return () => {
    const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return event.message;
        if (event.type === "error") return event.error;
        throw new Error("Unexpected event type");
      },
    );
    // Push non-terminal events, then end the stream manually
    queueMicrotask(() => {
      for (const event of events) {
        stream.push(event);
      }
      stream.end(finalMessage);
    });
    return stream;
  };
}

export function collectEvents(
  context: AgentContext,
  config: AgentLoopConfig,
  streamFn: StreamFn,
): Promise<{ events: AgentEvent[]; result: AssistantMessage }> {
  const events: AgentEvent[] = [];
  const emit: AgentEventSink = async (event) => {
    events.push(event);
  };
  return streamAssistantResponse(context, config, undefined, emit, streamFn).then((result) => ({
    events,
    result,
  }));
}

export function baseConfig(overrides?: Partial<AgentLoopConfig>): AgentLoopConfig {
  return {
    model: testModel,
    completionMode: "implicit",
    convertToLlm: (messages) => messages.filter(isLlmMessage),
    ...overrides,
  };
}

export function emptyContext(): AgentContext {
  return { systemPrompt: "", messages: [], tools: [] };
}
