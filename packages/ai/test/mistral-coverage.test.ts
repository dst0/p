import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamMistral, streamSimpleMistral } from "../src/providers/mistral.ts";
import type { Context, Model } from "../src/types.ts";

const mockChatStream = vi.fn();

vi.mock("@mistralai/mistralai", () => {
  return {
    Mistral: vi.fn().mockImplementation(function (this: { options?: unknown; chat?: unknown }, options: unknown) {
      this.options = options;
      this.chat = { stream: mockChatStream };
    }),
  };
});

describe("mistral provider comprehensive coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const textModel: Model<"mistral-conversations"> = {
    id: "mistral-small-latest",
    name: "Mistral Small",
    api: "mistral-conversations",
    provider: "mistral",
    baseUrl: "https://api.mistral.ai",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
    maxTokens: 4096,
  };

  const visionModel: Model<"mistral-conversations"> = {
    id: "pixtral-12b",
    name: "Pixtral 12B",
    api: "mistral-conversations",
    provider: "mistral",
    baseUrl: "https://api.mistral.ai",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };

  it("handles missing API key in stream and streamSimple", async () => {
    const context: Context = { messages: [] };
    const res = await streamMistral(textModel, context, {}).result();
    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toBe("No API key for provider: mistral");

    expect(() => streamSimpleMistral(textModel, context, {})).toThrow("No API key for provider: mistral");
  });

  it("handles streaming response with text, thinking, tool calls, usage, and responseId", async () => {
    async function* asyncEvents() {
      yield {
        data: {
          id: "resp-123",
          choices: [
            {
              finishReason: null,
              delta: {
                content: "Hello ",
              },
            },
          ],
        },
      };
      yield {
        data: {
          id: "resp-123",
          choices: [
            {
              finishReason: null,
              delta: {
                content: [
                  { type: "thinking", thinking: [{ type: "text", text: "Reasoning step" }] },
                  { type: "text", text: "world!" },
                ],
              },
            },
          ],
        },
      };
      yield {
        data: {
          id: "resp-123",
          choices: [
            {
              finishReason: null,
              delta: {
                toolCalls: [
                  {
                    id: "tc-1",
                    index: 0,
                    function: { name: "get_weather", arguments: '{"city": "Paris"' },
                  },
                ],
              },
            },
          ],
        },
      };
      yield {
        data: {
          id: "resp-123",
          choices: [
            {
              finishReason: null,
              delta: {
                toolCalls: [
                  {
                    id: "tc-1",
                    index: 0,
                    function: { name: "get_weather", arguments: "}" },
                  },
                ],
              },
            },
          ],
        },
      };
      yield {
        data: {
          id: "resp-123",
          usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
          choices: [
            {
              finishReason: "tool_calls",
              delta: {},
            },
          ],
        },
      };
    }

    mockChatStream.mockResolvedValueOnce(asyncEvents());

    const context: Context = {
      systemPrompt: "System msg",
      messages: [{ role: "user", content: "Hi", timestamp: 0 }],
    };

    const stream = streamMistral(textModel, context, {
      apiKey: "secret-key",
      sessionId: "session-abc",
    });

    const res = await stream.result();

    expect(res.stopReason).toBe("toolUse");
    expect(res.responseId).toBe("resp-123");
    expect(res.usage.input).toBe(50);
    expect(res.usage.output).toBe(25);
    expect(res.content.some((c) => c.type === "text")).toBe(true);
    expect(res.content.some((c) => c.type === "thinking")).toBe(true);
    expect(res.content.some((c) => c.type === "toolCall")).toBe(true);
  });

  it("handles user and toolResult message conversion with images and errors", async () => {
    async function* asyncEvents() {
      yield {
        data: {
          id: "resp-456",
          choices: [{ finishReason: "stop", delta: { content: "Done" } }],
        },
      };
    }

    mockChatStream.mockResolvedValueOnce(asyncEvents());

    const context: Context = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Look at this" },
            { type: "image", mimeType: "image/png", data: "base64data" },
          ],
          timestamp: 0,
        },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "My thought" },
            { type: "text", text: "Will call tool" },
            { type: "toolCall", id: "tc-123", name: "tool1", arguments: { arg: 1 } },
          ],
          api: "mistral-conversations",
          provider: "mistral",
          model: textModel.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "toolUse",
          timestamp: 0,
        },
        {
          role: "toolResult",
          toolCallId: "tc-123",
          toolName: "tool1",
          content: [{ type: "image", mimeType: "image/jpeg", data: "imgdata" }],
          isError: true,
          timestamp: 0,
        },
      ],
    };

    const stream = streamMistral(textModel, context, {
      apiKey: "secret-key",
      toolChoice: { type: "function", function: { name: "tool1" } },
    });

    const res = await stream.result();
    expect(res.stopReason).toBe("stop");

    const payloadSent = mockChatStream.mock.calls[0][0];
    expect(payloadSent.toolChoice).toEqual({ type: "function", function: { name: "tool1" } });
  });

  it("handles image omitted message formatting for text-only model", async () => {
    async function* asyncEvents() {
      yield { data: { choices: [{ finishReason: "stop", delta: { content: "ok" } }] } };
    }
    mockChatStream.mockResolvedValueOnce(asyncEvents());

    const context: Context = {
      messages: [
        {
          role: "user",
          content: [{ type: "image", mimeType: "image/png", data: "imgdata" }],
          timestamp: 0,
        },
      ],
    };

    const stream = streamMistral(textModel, context, { apiKey: "key" });
    await stream.result();

    const payloadSent = mockChatStream.mock.calls[0][0];
    expect(payloadSent.messages[0].content).toEqual([
      { type: "text", text: "(image omitted: model does not support images)" },
    ]);
  });

  it("handles image inclusion for vision model", async () => {
    async function* asyncEvents() {
      yield { data: { choices: [{ finishReason: "stop", delta: { content: "ok" } }] } };
    }
    mockChatStream.mockResolvedValueOnce(asyncEvents());

    const context: Context = {
      messages: [
        {
          role: "user",
          content: [{ type: "image", mimeType: "image/png", data: "imgdata" }],
          timestamp: 0,
        },
      ],
    };

    const stream = streamMistral(visionModel, context, { apiKey: "key" });
    await stream.result();

    const payloadSent = mockChatStream.mock.calls[0][0];
    expect(payloadSent.messages[0].content).toEqual([{ type: "image_url", imageUrl: "data:image/png;base64,imgdata" }]);
  });

  it("formats API errors with statusCode and body truncation", async () => {
    const longBody = "A".repeat(5000);
    const mockError = new Error("SDK Error") as Error & { statusCode?: number; body?: string };
    mockError.statusCode = 400;
    mockError.body = longBody;

    mockChatStream.mockRejectedValueOnce(mockError);

    const context: Context = { messages: [] };
    const stream = streamMistral(textModel, context, { apiKey: "key" });
    const res = await stream.result();

    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toContain("Mistral API error (400):");
    expect(res.errorMessage).toContain("[truncated 1000 chars]");
  });

  it("handles simple mistral stream with promptMode reasoning", async () => {
    async function* asyncEvents() {
      yield { data: { choices: [{ finishReason: "model_length", delta: { content: "truncated" } }] } };
    }
    mockChatStream.mockResolvedValueOnce(asyncEvents());

    const reasoningModel: Model<"mistral-conversations"> = {
      ...textModel,
      id: "mistral-large-latest",
      reasoning: true,
    };

    const context: Context = { messages: [] };
    const stream = streamSimpleMistral(reasoningModel, context, {
      apiKey: "key",
      reasoning: "high",
    });

    const res = await stream.result();
    expect(res.stopReason).toBe("length");

    const payload = mockChatStream.mock.calls[0][0];
    expect(payload.promptMode).toBe("reasoning");
  });

  it("handles tool call ID normalization and collision resolution", async () => {
    async function* asyncEvents() {
      yield { data: { choices: [{ finishReason: "stop", delta: { content: "ok" } }] } };
    }
    mockChatStream.mockResolvedValueOnce(asyncEvents());

    const context: Context = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "toolCall", id: "invalid!!tool!!id!!long", name: "tool1", arguments: {} },
            { type: "toolCall", id: "invalid!!tool!!id!!long", name: "tool2", arguments: {} },
          ],
          api: "mistral-conversations",
          provider: "mistral",
          model: textModel.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "toolUse",
          timestamp: 0,
        },
      ],
    };

    const stream = streamMistral(textModel, context, { apiKey: "key" });
    await stream.result();

    const payload = mockChatStream.mock.calls[0][0];
    expect(payload.messages[0].toolCalls.length).toBe(2);
  });
});
