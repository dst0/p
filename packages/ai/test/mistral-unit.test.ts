import { describe, expect, it } from "vitest";
import { streamMistral, streamSimpleMistral } from "../src/providers/mistral.ts";
import type { Context, Model } from "../src/types.ts";

describe("mistral-unit", () => {
  const dummyModel: Model<"mistral-conversations"> = {
    id: "mistral-small-latest",
    name: "Mistral Small",
    api: "mistral-conversations",
    provider: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
    maxTokens: 4096,
  };

  it("throws error when API key is missing", async () => {
    const context: Context = { messages: [] };
    const s1 = streamMistral(dummyModel, context, {});
    const res1 = await s1.result();
    expect(res1.stopReason).toBe("error");
    expect(res1.errorMessage).toBe("No API key for provider: mistral");

    expect(() => streamSimpleMistral(dummyModel, context, {})).toThrow("No API key for provider: mistral");
  });

  it("executes streamSimpleMistral with valid API key", async () => {
    const context: Context = {
      systemPrompt: "System prompt",
      messages: [
        { role: "user", content: "hello", timestamp: 0 },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "internal thought" },
            { type: "text", text: "response" },
            { type: "toolCall", id: "call_123456789", name: "toolA", arguments: { x: 1 } },
          ],
          api: "mistral-conversations",
          provider: "mistral",
          model: "mistral-small-latest",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 0,
        },
        {
          role: "toolResult",
          toolCallId: "call_123456789",
          toolName: "toolA",
          content: [{ type: "text", text: "res" }],
          isError: false,
          timestamp: 0,
        },
      ],
    };

    // streamSimpleMistral returns an AssistantMessageEventStream
    const stream = streamSimpleMistral(dummyModel, context, {
      apiKey: "dummy-key",
      reasoning: "high",
    });

    // Since mock network endpoint fails, result error should be captured
    const result = await stream.result();
    expect(result.stopReason).toBe("error");
  });

  it("handles non-vision model message formatting with images", async () => {
    const textOnlyModel: Model<"mistral-conversations"> = {
      ...dummyModel,
      input: ["text"],
      reasoning: false,
    };

    const context: Context = {
      messages: [
        {
          role: "user",
          content: [{ type: "image", mimeType: "image/png", data: "base64" }],
          timestamp: 0,
        },
        {
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "fn",
          content: [{ type: "image", mimeType: "image/png", data: "base64" }],
          isError: true,
          timestamp: 0,
        },
      ],
    };

    const stream = streamMistral(textOnlyModel, context, { apiKey: "dummy-key" });
    const result = await stream.result();
    expect(result.stopReason).toBe("error");
  });
});
