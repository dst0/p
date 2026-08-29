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
import { detectCompletionProtocolRepair } from "../src/agent-loop/tool-result-formatting.ts";
import { agentLoop } from "../src/agent-loop.ts";
import { FINISH_WORK_TOOL_NAME } from "../src/completion-protocol.ts";
import type { AgentEvent, AgentMessage, AgentTool, AgentToolCall } from "../src/types.ts";

function usage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-responses",
    provider: "openai",
    model: "mock",
    usage: usage(),
    stopReason,
    timestamp: 1,
  };
}

function message(toolCall: AgentToolCall): AssistantMessage {
  return assistant([toolCall], "length");
}

function model(): Model<"openai-responses"> {
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

function responseStream(message: AssistantMessage): EventStream<AssistantMessageEvent, AssistantMessage> {
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
    (event) => event.type === "done" || event.type === "error",
    (event) => {
      if (event.type === "done") return event.message;
      if (event.type === "error") return event.error;
      throw new Error("Unexpected event type");
    },
  );
  queueMicrotask(() => {
    const reason = message.stopReason === "toolUse" || message.stopReason === "length" ? message.stopReason : "stop";
    stream.push({ type: "done", reason, message });
  });
  return stream;
}

function messageText(message: AgentMessage | undefined): string {
  if (!message || !("content" in message)) return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

describe("truncated tool-call recovery", () => {
  it("anchors recovery to the unexecuted tool and path without echoing content", () => {
    const toolCall: AgentToolCall = {
      type: "toolCall",
      id: "write-truncated",
      name: "write",
      arguments: {
        path: "test/serialization.test.ts",
        content: "sensitive partial source that must not be echoed",
      },
    };

    const repair = detectCompletionProtocolRepair(message(toolCall), [toolCall], false);

    expect(repair?.event).toBe("malformed_tool_call_retry");
    expect(repair?.message).toContain('"write"');
    expect(repair?.message).toContain('"test/serialization.test.ts"');
    expect(repair?.message).toContain("was not executed");
    expect(repair?.message).toContain("retry only this pending step");
    expect(repair?.message).toContain("smaller bounded tool calls");
    expect(repair?.message).not.toContain("sensitive partial source");
  });

  it("retains the tool identity when truncation occurs before the path is parsed", () => {
    const partialContent = "x".repeat(8_668);
    const toolCall: AgentToolCall = {
      type: "toolCall",
      id: "write-path-missing",
      name: "write",
      arguments: { content: partialContent },
    };

    const repair = detectCompletionProtocolRepair(message(toolCall), [toolCall], false);

    expect(repair?.message).toContain('pending "write" call was not executed');
    expect(repair?.message).not.toContain("for path");
    expect(repair?.message).not.toContain(partialContent);
    expect(repair?.message).toContain("retry only this pending step");
  });

  it("executes no partial write and exactly one smaller retry before completion", async () => {
    const executed: string[] = [];
    const schema = Type.Object({ path: Type.String(), content: Type.String() });
    const writeTool: AgentTool<typeof schema, { path: string }> = {
      name: "write",
      label: "Write",
      description: "Write content",
      parameters: schema,
      async execute(_id, params) {
        executed.push(params.content);
        return { content: [{ type: "text", text: params.path }], details: { path: params.path } };
      },
    };
    const secret = "PRIVATE_PARTIAL_SOURCE";
    const truncatedCall: AgentToolCall = {
      type: "toolCall",
      id: "write-truncated",
      name: "write",
      arguments: { path: "test/serialization.test.ts", content: secret },
    };
    const truncated = {
      ...message(truncatedCall),
      errorMessage: "Stopped a malformed tool call after its streamed arguments entered a repetitive loop.",
    };
    const responses: Array<AssistantMessage | ((context: Context) => AssistantMessage)> = [
      truncated,
      (context) => {
        const continuation = context.messages[context.messages.length - 1] as AgentMessage;
        const repair = messageText(continuation);
        expect(continuation.role === "user" ? continuation.metadata?.pInternal : undefined).toBe(
          "provider_length_continuation",
        );
        expect(repair).toContain('pending "write" call for path "test/serialization.test.ts" was not executed');
        expect(repair).toContain("retry only this pending step");
        expect(repair).toContain("smaller bounded tool calls");
        expect(repair).not.toContain(secret);
        return assistant(
          [
            {
              type: "toolCall",
              id: "write-retry",
              name: "write",
              arguments: { path: "test/serialization.test.ts", content: "small bounded content" },
            },
          ],
          "toolUse",
        );
      },
      assistant(
        [
          {
            type: "toolCall",
            id: "finish-1",
            name: FINISH_WORK_TOOL_NAME,
            arguments: { status: "success", summary: "recovered" },
          },
        ],
        "toolUse",
      ),
    ];
    const contexts: Context[] = [];
    const events: AgentEvent[] = [];
    let callIndex = 0;
    const stream = agentLoop(
      [{ role: "user", content: "finish the pending serialization test", timestamp: 1 }],
      { systemPrompt: "", messages: [], tools: [writeTool] },
      {
        model: model(),
        completionMode: "explicit_finish",
        convertToLlm: (messages) =>
          messages.filter(
            (candidate) =>
              candidate.role === "user" || candidate.role === "assistant" || candidate.role === "toolResult",
          ) as Message[],
      },
      undefined,
      (_model, context) => {
        contexts.push(context);
        const response = responses[callIndex++];
        if (!response) throw new Error(`Missing response ${callIndex}`);
        return responseStream(typeof response === "function" ? response(context) : response);
      },
    );
    for await (const event of stream) events.push(event);
    await stream.result();

    expect(contexts).toHaveLength(3);
    expect(executed).toEqual(["small bounded content"]);
    expect(
      events.filter(
        (event) =>
          event.type === "completion_protocol" &&
          event.event === "malformed_tool_call_retry" &&
          event.reason === "repetitive_model_output",
      ),
    ).toHaveLength(1);
  });
});
