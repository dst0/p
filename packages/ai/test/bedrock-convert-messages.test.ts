import { describe, expect, it, vi } from "vitest";

const bedrockMock = vi.hoisted(() => ({
  constructorCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
  class BedrockRuntimeServiceException extends Error {}

  class BedrockRuntimeClient {
    constructor(config: Record<string, unknown>) {
      bedrockMock.constructorCalls.push(config);
    }

    send(): Promise<never> {
      return Promise.reject(new Error("mock send"));
    }
  }

  class ConverseStreamCommand {
    readonly input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  }

  return {
    BedrockRuntimeClient,
    BedrockRuntimeServiceException,
    ConverseStreamCommand,
    StopReason: {
      END_TURN: "end_turn",
      STOP_SEQUENCE: "stop_sequence",
      MAX_TOKENS: "max_tokens",
      MODEL_CONTEXT_WINDOW_EXCEEDED: "model_context_window_exceeded",
      TOOL_USE: "tool_use",
    },
    CachePointType: { DEFAULT: "default" },
    CacheTTL: { ONE_HOUR: "ONE_HOUR" },
    ConversationRole: { ASSISTANT: "assistant", USER: "user" },
    ImageFormat: { JPEG: "jpeg", PNG: "png", GIF: "gif", WEBP: "webp" },
    ToolResultStatus: { ERROR: "error", SUCCESS: "success" },
  };
});

import { getModel } from "../src/models.ts";
import { streamBedrock } from "../src/providers/amazon-bedrock.ts";
import type { Context, Message } from "../src/types.ts";

const baseModel = getModel("amazon-bedrock", "us.anthropic.claude-sonnet-4-5-20250929-v1:0");

async function capturePayload(
  context: Context,
  options?: { cacheRetention?: "none" | "short" | "long" },
): Promise<unknown> {
  let capturedPayload: unknown;
  const s = streamBedrock(baseModel, context, {
    cacheRetention: options?.cacheRetention ?? "none",
    signal: AbortSignal.abort(),
    onPayload: (payload) => {
      capturedPayload = payload;
      return payload;
    },
  });
  for await (const event of s) {
    if (event.type === "error") break;
  }
  return capturedPayload;
}

describe("bedrock convertMessages skips unknown content types", () => {
  it("skips unknown user content blocks instead of throwing", async () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "unknown", data: "foo" },
        ] as any,
        timestamp: Date.now(),
      },
    ];
    const payload = await capturePayload({ messages });
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].content).toHaveLength(1);
    expect(p.messages[0].content[0]).toEqual({ text: "hello" });
  });

  it("skips unknown assistant content blocks instead of throwing", async () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "hello" },
          { type: "unknown", data: "foo" },
        ] as any,
        api: "bedrock-converse-stream",
        provider: "amazon-bedrock",
        model: baseModel.id,
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
      },
    ];
    const payload = await capturePayload({ messages });
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].content).toHaveLength(1);
    expect(p.messages[0].content[0]).toEqual({ text: "hello" });
  });

  it("replaces user messages with only unknown content blocks with a placeholder", async () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [{ type: "unknown", data: "foo" }] as any,
        timestamp: Date.now(),
      },
    ];
    const payload = await capturePayload({ messages });
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].content).toEqual([{ text: "<empty>" }]);
  });

  it("replaces blank user string content with a placeholder", async () => {
    const payload = await capturePayload({
      messages: [{ role: "user", content: "   ", timestamp: Date.now() }],
    });
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].content).toEqual([{ text: "<empty>" }]);
  });

  it("filters blank user text blocks when other content remains", async () => {
    const payload = await capturePayload({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "" },
            { type: "text", text: "hello" },
          ],
          timestamp: Date.now(),
        },
      ],
    });
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].content).toEqual([{ text: "hello" }]);
  });

  it("replaces user content emptied by surrogate sanitization with a placeholder", async () => {
    const payload = await capturePayload({
      messages: [{ role: "user", content: String.fromCharCode(0xd83d), timestamp: Date.now() }],
    });
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].content).toEqual([{ text: "<empty>" }]);
  });

  it("skips assistant text blocks emptied by surrogate sanitization", async () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: String.fromCharCode(0xd83d) }],
        api: "bedrock-converse-stream",
        provider: "amazon-bedrock",
        model: baseModel.id,
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
      },
    ];
    const payload = await capturePayload({ messages });
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    expect(p.messages).toHaveLength(0);
  });

  it("replaces blank tool result content with a placeholder", async () => {
    const messages: Message[] = [
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "tool",
        content: [{ type: "text", text: "" }],
        isError: false,
        timestamp: Date.now(),
      },
    ];
    const payload = await capturePayload({ messages });
    expect(payload).toBeDefined();
    const p = payload as {
      messages: Array<{ role: string; content: Array<{ toolResult: { content: unknown[] } }> }>;
    };
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].content[0].toolResult.content).toEqual([{ text: "<empty>" }]);
  });

  it("skips assistant messages with only unknown content blocks", async () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [{ type: "unknown", data: "foo" }] as any,
        api: "bedrock-converse-stream",
        provider: "amazon-bedrock",
        model: baseModel.id,
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
      },
    ];
    const payload = await capturePayload({ messages });
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    expect(p.messages).toHaveLength(0);
  });

  it("includes image content in user messages", async () => {
    const payload = await capturePayload({
      messages: [
        {
          role: "user",
          content: [
            { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
            { type: "text", text: "describe this" },
          ],
          timestamp: Date.now(),
        },
      ],
    });
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].content).toHaveLength(2);
    expect(p.messages[0].content[0]).toHaveProperty("image");
    expect(p.messages[0].content[1]).toEqual({ text: "describe this" });
  });

  it("includes thinking content with signature for Anthropic models", async () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          {
            type: "thinking" as const,
            thinking: "let me think about this",
            thinkingSignature: "sig123",
          },
          { type: "text" as const, text: "answer" },
        ],
        api: "bedrock-converse-stream" as const,
        provider: "amazon-bedrock" as const,
        model: baseModel.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop" as const,
        timestamp: Date.now(),
      },
    ];
    const payload = await capturePayload({ messages });
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].content).toHaveLength(2);
    expect(p.messages[0].content[0]).toEqual({
      reasoningContent: {
        reasoningText: { text: "let me think about this", signature: "sig123" },
      },
    });
  });

  it("falls back to plain text for thinking without signature", async () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking" as const, thinking: "thinking without sig" },
          { type: "text" as const, text: "answer" },
        ],
        api: "bedrock-converse-stream" as const,
        provider: "amazon-bedrock" as const,
        model: baseModel.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop" as const,
        timestamp: Date.now(),
      },
    ];
    const payload = await capturePayload({ messages });
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].content).toHaveLength(2);
    expect(p.messages[0].content[0]).toEqual({ text: "thinking without sig" });
  });

  it("skips empty thinking blocks", async () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking" as const, thinking: "   " },
          { type: "text" as const, text: "answer" },
        ],
        api: "bedrock-converse-stream" as const,
        provider: "amazon-bedrock" as const,
        model: baseModel.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop" as const,
        timestamp: Date.now(),
      },
    ];
    const payload = await capturePayload({ messages });
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].content).toHaveLength(1);
    expect(p.messages[0].content[0]).toEqual({ text: "answer" });
  });

  it("includes toolCall content in assistant messages", async () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "text" as const, text: "let me check" },
          { type: "toolCall" as const, id: "tool-1", name: "weather", arguments: { city: "sf" } },
        ],
        api: "bedrock-converse-stream" as const,
        provider: "amazon-bedrock" as const,
        model: baseModel.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse" as const,
        timestamp: Date.now(),
      },
    ];
    const payload = await capturePayload({ messages });
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    // transformMessages inserts a synthetic toolResult for orphaned tool calls
    expect(p.messages).toHaveLength(2);
    expect(p.messages[0].role).toBe("assistant");
    expect(p.messages[0].content).toHaveLength(2);
    expect(p.messages[0].content[0]).toEqual({ text: "let me check" });
    expect(p.messages[0].content[1]).toEqual({
      toolUse: { toolUseId: "tool-1", name: "weather", input: { city: "sf" } },
    });
    expect(p.messages[1].role).toBe("user"); // synthetic toolResult becomes a user message
  });

  it("skips assistant messages with empty content", async () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [],
        api: "bedrock-converse-stream" as const,
        provider: "amazon-bedrock" as const,
        model: baseModel.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop" as const,
        timestamp: Date.now(),
      },
    ];
    const payload = await capturePayload({ messages });
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    expect(p.messages).toHaveLength(0);
  });

  it("combines consecutive tool results into a single user message", async () => {
    const messages: Message[] = [
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "weather",
        content: [{ type: "text" as const, text: "72°F" }],
        isError: false,
        timestamp: Date.now(),
      },
      {
        role: "toolResult",
        toolCallId: "tool-2",
        toolName: "search",
        content: [{ type: "text" as const, text: "sunny" }],
        isError: true,
        timestamp: Date.now(),
      },
    ];
    const payload = await capturePayload({ messages });
    expect(payload).toBeDefined();
    const p = payload as {
      messages: Array<{
        role: string;
        content: Array<{
          toolResult?: { toolUseId: string; content: unknown[]; status: string };
        }>;
      }>;
    };
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].role).toBe("user");
    expect(p.messages[0].content).toHaveLength(2);
    expect(p.messages[0].content[0].toolResult?.toolUseId).toBe("tool-1");
    expect(p.messages[0].content[0].toolResult?.status).toBe("success");
    expect(p.messages[0].content[1].toolResult?.toolUseId).toBe("tool-2");
    expect(p.messages[0].content[1].toolResult?.status).toBe("error");
  });

  it("sets error status for tool results with isError=true", async () => {
    const messages: Message[] = [
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "weather",
        content: [{ type: "text" as const, text: "not found" }],
        isError: true,
        timestamp: Date.now(),
      },
    ];
    const payload = await capturePayload({ messages });
    expect(payload).toBeDefined();
    const p = payload as {
      messages: Array<{
        role: string;
        content: Array<{ toolResult?: { status: string } }>;
      }>;
    };
    expect(p.messages[0].content[0].toolResult?.status).toBe("error");
  });

  it("adds cache point for short cache retention", async () => {
    const payload = await capturePayload(
      { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
      { cacheRetention: "short" },
    );
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    expect(p.messages[0].content).toHaveLength(2);
    expect(p.messages[0].content[1]).toHaveProperty("cachePoint");
  });

  it("adds cache point with TTL for long cache retention", async () => {
    const payload = await capturePayload(
      { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
      { cacheRetention: "long" },
    );
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    expect(p.messages[0].content).toHaveLength(2);
    expect(p.messages[0].content[1]).toEqual({
      cachePoint: { type: "default", ttl: "ONE_HOUR" },
    });
  });

  it("does not add cache point when cacheRetention is none", async () => {
    const payload = await capturePayload(
      { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
      { cacheRetention: "none" },
    );
    expect(payload).toBeDefined();
    const p = payload as { messages: Array<{ role: string; content: unknown[] }> };
    expect(p.messages[0].content).toHaveLength(1);
    expect(p.messages[0].content[0]).toEqual({ text: "hello" });
  });
});
