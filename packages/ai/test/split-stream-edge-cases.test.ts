import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.ts";
import { streamAnthropic } from "../src/providers/anthropic/stream-anthropic.ts";
import { streamSimpleAnthropic } from "../src/providers/anthropic/stream-simple-anthropic.ts";
import { OpenAIStreamingBlocks } from "../src/providers/openai-completions/openai-streaming-blocks.ts";
import { streamOpenAICompletions } from "../src/providers/openai-completions/stream-openai-completions.ts";
import { streamSimpleOpenAICompletions } from "../src/providers/openai-completions/stream-simple-openai-completions.ts";
import type { AssistantMessage, Context, Model } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

const openAIState = vi.hoisted(() => ({
  abortController: undefined as AbortController | undefined,
  chunks: [] as unknown[],
}));

vi.mock("openai", () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: () => {
          const data = {
            async *[Symbol.asyncIterator]() {
              for (const chunk of openAIState.chunks) yield chunk;
              openAIState.abortController?.abort();
            },
          };
          const request = Promise.resolve(data) as Promise<typeof data> & {
            withResponse: () => Promise<{ data: typeof data; response: { status: number; headers: Headers } }>;
          };
          request.withResponse = async () => ({
            data,
            response: { status: 200, headers: new Headers({ "x-test": "yes" }) },
          });
          return request;
        },
      },
    };
  }
  return { default: FakeOpenAI };
});

const context: Context = {
  messages: [{ role: "user", content: "hello", timestamp: 1 }],
  tools: [],
};

const openAIModel: Model<"openai-completions"> = {
  id: "test-model",
  name: "Test Model",
  api: "openai-completions",
  provider: "test-provider",
  baseUrl: "https://example.test/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1_000,
  maxTokens: 100,
};

function sseResponse(events: object[]): Response {
  const body = events
    .map((value) => `event: ${(value as { type: string }).type}\ndata: ${JSON.stringify(value)}\n`)
    .join("\n");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "x-test": "yes" } });
}

function anthropicClient(response: Response): Anthropic {
  return {
    messages: {
      create: () => ({ asResponse: async () => response }),
    },
  } as unknown as Anthropic;
}

function anthropicUsage() {
  return {
    input_tokens: 1,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

beforeEach(() => {
  openAIState.abortController = undefined;
  openAIState.chunks = [];
});

describe("Anthropic split stream edge cases", () => {
  it("streams thinking signatures and removes scratch state after a refusal", async () => {
    const model = getModel("anthropic", "claude-haiku-4-5");
    const response = sseResponse([
      { type: "message_start", message: { id: "msg", usage: anthropicUsage() } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "reason" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "signed" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "redacted_thinking", data: "redacted" } },
      { type: "content_block_stop", index: 1 },
      {
        type: "content_block_start",
        index: 2,
        content_block: { type: "tool_use", id: "tool", name: "read", input: {} },
      },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"path":"x"}' } },
      {
        type: "message_delta",
        delta: { stop_reason: "refusal", stop_details: { type: "refusal", explanation: "blocked" } },
        usage: anthropicUsage(),
      },
      { type: "message_stop" },
    ]);
    const onPayload = vi.fn(() => ({ model: model.id, max_tokens: 10, messages: [], stream: true }));
    const onResponse = vi.fn();
    const result = await streamAnthropic(model, context, {
      client: anthropicClient(response),
      onPayload,
      onResponse,
      timeoutMs: 50,
      maxRetries: 1,
    }).result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("blocked");
    expect(result.content).toEqual([
      { type: "thinking", thinking: "reason", thinkingSignature: "signed" },
      { type: "thinking", thinking: "[Reasoning redacted]", thinkingSignature: "redacted", redacted: true },
      { type: "toolCall", id: "tool", name: "read", arguments: { path: "x" } },
    ]);
    expect(onPayload).toHaveBeenCalled();
    expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }), model);
  });

  it("reports missing credentials through full and simple entry points", async () => {
    const model = getModel("anthropic", "claude-haiku-4-5");
    const result = await streamAnthropic(model, context, { apiKey: "" }).result();
    expect(result.errorMessage).toMatch(/No API key/);
    expect(() => streamSimpleAnthropic(model, context, { apiKey: "" })).toThrow(/No API key/);
  });
});

describe("OpenAI split stream edge cases", () => {
  it("fills delayed tool identity and attaches encrypted reasoning metadata", async () => {
    openAIState.chunks = [
      {
        id: "chat",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } }],
      },
      {
        id: "chat",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, id: "call", function: { name: "read", arguments: '"x"}' } }],
              reasoning_details: [{ type: "reasoning.encrypted", id: "call", data: "signature" }],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    ];
    const onPayload = vi.fn(() => ({ model: openAIModel.id, messages: [], stream: true }));
    const result = await streamOpenAICompletions(openAIModel, context, {
      apiKey: "test",
      onPayload,
      onResponse: vi.fn(),
    }).result();
    expect(result.content).toEqual([
      {
        type: "toolCall",
        id: "call",
        name: "read",
        arguments: { path: "x" },
        thoughtSignature: JSON.stringify({ type: "reasoning.encrypted", id: "call", data: "signature" }),
      },
    ]);
    expect(onPayload).toHaveBeenCalled();
  });

  it("maps cancellation after the provider stream to an aborted result", async () => {
    const controller = new AbortController();
    openAIState.abortController = controller;
    openAIState.chunks = [{ id: "chat", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }];
    const result = await streamOpenAICompletions(openAIModel, context, {
      apiKey: "test",
      signal: controller.signal,
    }).result();
    expect(result.stopReason).toBe("aborted");
    expect(result.errorMessage).toBe("Request was aborted");
  });

  it("indexes an existing id-only tool block and remembers explicit ids", () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "openai-completions",
      provider: "test-provider",
      model: "test-model",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 1,
    };
    const blocks = new OpenAIStreamingBlocks(output, new AssistantMessageEventStream());
    const first = blocks.ensureToolCallBlock({
      id: "call",
      type: "function",
      function: { name: "read", arguments: "" },
    } as never);
    const indexed = blocks.ensureToolCallBlock({
      index: 3,
      id: "call",
      type: "function",
      function: { name: "read", arguments: "" },
    });
    blocks.rememberToolCallId("alias", indexed);
    expect(indexed).toBe(first);
    expect(indexed.streamIndex).toBe(3);
  });

  it("reports missing credentials through full and simple entry points", async () => {
    const result = await streamOpenAICompletions(openAIModel, context, { apiKey: "" }).result();
    expect(result.errorMessage).toMatch(/No API key/);
    expect(() => streamSimpleOpenAICompletions(openAIModel, context, { apiKey: "" })).toThrow(/No API key/);
  });
});
