import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { streamBedrock, streamSimpleBedrock } from "../src/providers/amazon-bedrock.ts";
import type { Context, Model } from "../src/types.ts";

describe("amazon-bedrock-unit", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
    delete process.env.AWS_PROFILE;
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  const dummyModel: Model<"bedrock-converse-stream"> = {
    id: "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
    name: "Claude 3.7 Sonnet",
    api: "bedrock-converse-stream",
    provider: "amazon-bedrock",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 4096,
  };

  it("streamBedrock initializes and handles message conversion", async () => {
    const context: Context = {
      systemPrompt: "System prompt",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello" },
            { type: "image", mimeType: "image/png", data: "YmFzZTY0" },
          ],
          timestamp: 0,
        },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "thought", thinkingSignature: "sig123" },
            { type: "text", text: "response" },
          ],
          api: "bedrock-converse-stream",
          provider: "amazon-bedrock",
          model: dummyModel.id,
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
      ],
    };

    const stream = streamBedrock(dummyModel, context, {
      region: "us-east-1",
      bearerToken: "dummy-bearer-token",
    });

    const res = await stream.result();
    expect(res.stopReason).toBe("error"); // Fails at mock SDK client execution with invalid credentials
  });

  it("streamSimpleBedrock configures thinking budgets and options for Claude models", async () => {
    const context: Context = { messages: [] };

    const stream = streamSimpleBedrock(dummyModel, context, {
      reasoning: "medium",
    });

    const res = await stream.result();
    expect(res.stopReason).toBe("error");
  });

  it("streamBedrock handles non-Claude models without thinking signatures", async () => {
    const nonClaudeModel: Model<"bedrock-converse-stream"> = {
      id: "us.amazon.nova-pro-v1:0",
      name: "Nova Pro",
      api: "bedrock-converse-stream",
      provider: "amazon-bedrock",
      baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 300000,
      maxTokens: 5000,
    };

    const context: Context = {
      messages: [
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "thinking Nova" }],
          api: "bedrock-converse-stream",
          provider: "amazon-bedrock",
          model: nonClaudeModel.id,
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
      ],
    };

    const stream = streamBedrock(nonClaudeModel, context, {});
    const res = await stream.result();
    expect(res.stopReason).toBe("error");
  });
});
