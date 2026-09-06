import { describe, expect, it } from "vitest";
import { streamOpenAICodexResponses } from "../src/providers/openai-codex-responses.ts";
import type { Context, Model } from "../src/types.ts";

function mockToken(): string {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
    "utf8",
  ).toString("base64");
  return `aaa.${payload}.bbb`;
}

describe("OpenAI Codex response budget", () => {
  it("serializes the requested maximum output tokens before provider invocation", async () => {
    const model: Model<"openai-codex-responses"> = {
      id: "gpt-5.1-codex",
      name: "GPT-5.1 Codex",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: "https://chatgpt.com/backend-api",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 65_536,
      maxTokens: 16_384,
    };
    const context: Context = {
      systemPrompt: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Keep this request bounded.", timestamp: Date.now() }],
    };
    let capturedPayload: Record<string, unknown> | undefined;
    await streamOpenAICodexResponses(model, context, {
      apiKey: mockToken(),
      maxTokens: 4096,
      onPayload: (payload) => {
        capturedPayload = payload as Record<string, unknown>;
        throw new Error("stop before network");
      },
    }).result();
    expect(capturedPayload?.max_output_tokens).toBe(4096);
  });
});
