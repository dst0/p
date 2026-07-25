import { describe, expect, it, vi } from "vitest";
import { getApiProvider } from "../src/api-registry.ts";
import { resetApiProviders, setBedrockProviderModule } from "../src/providers/register-builtins.ts";
import type { Model } from "../src/types.ts";

describe("providers register-builtins", () => {
  it("registers built-in providers and allows resetting them", () => {
    resetApiProviders();
    expect(getApiProvider("anthropic-messages")).toBeDefined();
    expect(getApiProvider("openai-responses")).toBeDefined();
    expect(getApiProvider("bedrock-converse-stream")).toBeDefined();
  });

  it("supports setting mock Bedrock provider module override", async () => {
    const dummyMsg = {
      role: "assistant" as const,
      content: [],
      api: "bedrock-converse-stream" as const,
      provider: "amazon-bedrock" as const,
      model: "us.amazon.nova-lite-v1:0",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop" as const,
      timestamp: 0,
    };

    const dummyStream = vi.fn(async function* () {
      yield { type: "done" as const, reason: "stop" as const, message: dummyMsg };
    });
    const dummySimple = vi.fn(async function* () {
      yield { type: "done" as const, reason: "stop" as const, message: dummyMsg };
    });

    setBedrockProviderModule({
      streamBedrock: dummyStream as any,
      streamSimpleBedrock: dummySimple as any,
    });

    const bedrockProvider = getApiProvider("bedrock-converse-stream");
    expect(bedrockProvider).toBeDefined();

    const dummyModel: Model<"bedrock-converse-stream"> = {
      id: "us.amazon.nova-lite-v1:0",
      provider: "amazon-bedrock",
      api: "bedrock-converse-stream",
    } as any;

    const stream = bedrockProvider!.stream(dummyModel, { messages: [] });
    const res = await stream.result();
    expect(res).toEqual(dummyMsg);

    resetApiProviders();
  });
});
