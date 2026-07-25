import { describe, expect, it, vi } from "vitest";
import { getApiProvider } from "../src/api-registry.ts";
import { resetApiProviders, setBedrockProviderModule } from "../src/providers/register-builtins.ts";
import type { Context, Model } from "../src/types.ts";
import { createAssistantMessageEventStream } from "../src/utils/event-stream.ts";

describe("register-builtins comprehensive coverage", () => {
  it("registers all 9 built-in API providers", () => {
    resetApiProviders();

    const apis = [
      "anthropic-messages",
      "openai-completions",
      "mistral-conversations",
      "openai-responses",
      "azure-openai-responses",
      "openai-codex-responses",
      "google-generative-ai",
      "google-vertex",
      "bedrock-converse-stream",
    ] as const;

    for (const api of apis) {
      const provider = getApiProvider(api);
      expect(provider).toBeDefined();
      expect(provider?.api).toBe(api);
    }
  });

  it("handles bedrock provider module override via setBedrockProviderModule", async () => {
    const createMockStream = () => {
      const s = createAssistantMessageEventStream();
      const msg = {
        role: "assistant" as const,
        content: [],
        api: "bedrock-converse-stream" as const,
        provider: "amazon-bedrock",
        model: "dummy",
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
      };
      s.push({ type: "done", reason: "stop", message: msg });
      s.end(msg);
      return s;
    };
    const mockBedrockStream = vi.fn(() => createMockStream());
    const mockBedrockStreamSimple = vi.fn(() => createMockStream());

    setBedrockProviderModule({
      streamBedrock: mockBedrockStream as unknown as any,
      streamSimpleBedrock: mockBedrockStreamSimple as unknown as any,
    });

    const bedrockProvider = getApiProvider("bedrock-converse-stream");
    expect(bedrockProvider).toBeDefined();

    const dummyModel: Model<"bedrock-converse-stream"> = {
      id: "us.anthropic.claude-3-5-sonnet",
      name: "Claude 3.5 Sonnet",
      api: "bedrock-converse-stream",
      provider: "amazon-bedrock",
      baseUrl: "https://bedrock.aws",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 4096,
    };

    const context: Context = { messages: [] };
    const s1 = bedrockProvider!.stream(dummyModel, context);
    await s1.result();
    expect(mockBedrockStream).toHaveBeenCalled();

    const s2 = bedrockProvider!.streamSimple(dummyModel, context);
    await s2.result();
    expect(mockBedrockStreamSimple).toHaveBeenCalled();
  });
});
