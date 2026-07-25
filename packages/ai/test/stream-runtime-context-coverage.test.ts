import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerApiProvider, unregisterApiProviders } from "../src/api-registry.ts";
import { cleanupSessionResources } from "../src/session-resources.ts";
import { complete, completeSimple, stream, streamSimple } from "../src/stream.ts";
import type { Api, Context, Message, Model } from "../src/types.ts";
import { createAssistantMessageEventStream } from "../src/utils/event-stream.ts";

describe("stream.ts and runtime context normalization coverage", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.ANTHROPIC_API_KEY;
    cleanupSessionResources();
  });

  afterEach(() => {
    process.env = { ...origEnv };
    cleanupSessionResources();
  });

  const mockProviderStream = vi.fn((model: Model<Api>, _context: Context, _options?: unknown) => {
    const s = createAssistantMessageEventStream();
    const msg = {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "reply" }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop" as const,
      timestamp: Date.now(),
    };
    s.push({ type: "done", reason: "stop", message: msg });
    s.end(msg);
    return s;
  });

  const mockProviderSimpleStream = vi.fn((model: Model<Api>, _context: Context, _options?: unknown) => {
    const s = createAssistantMessageEventStream();
    const msg = {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "simple reply" }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop" as const,
      timestamp: Date.now(),
    };
    s.push({ type: "done", reason: "stop", message: msg });
    s.end(msg);
    return s;
  });

  it("registers test API provider and streams completion with withEnvApiKey", async () => {
    process.env.ANTHROPIC_API_KEY = "env-anthropic-key";

    registerApiProvider(
      {
        api: "test-stream-api" as Api,
        stream: mockProviderStream as unknown as any,
        streamSimple: mockProviderSimpleStream as unknown as any,
      },
      "source-stream-test",
    );

    const testModel: Model<Api> = {
      id: "m1",
      name: "Test Model",
      api: "test-stream-api" as Api,
      provider: "anthropic",
      baseUrl: "https://api.test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000,
      maxTokens: 100,
    };

    const context: Context = { messages: [{ role: "user", content: "hello", timestamp: 1234 }] };

    const res = await complete(testModel, context);
    expect(res.content[0]).toEqual({ type: "text", text: "reply" });
    expect(mockProviderStream).toHaveBeenCalled();
    const passedOptions = mockProviderStream.mock.calls[0][2] as { apiKey?: string };
    expect(passedOptions?.apiKey).toBe("env-anthropic-key");

    const simpleRes = await completeSimple(testModel, context);
    expect(simpleRes.content[0]).toEqual({ type: "text", text: "simple reply" });

    unregisterApiProviders("source-stream-test");
  });

  it("throws error when resolving unregistered API provider", () => {
    const badModel: Model<Api> = {
      id: "m2",
      name: "Bad Model",
      api: "non-existent-api" as Api,
      provider: "unknown",
      baseUrl: "https://api.test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000,
      maxTokens: 100,
    };

    const context: Context = { messages: [] };
    expect(() => stream(badModel, context)).toThrow("No API provider registered for api: non-existent-api");
    expect(() => streamSimple(badModel, context)).toThrow("No API provider registered for api: non-existent-api");
  });

  it("normalizes runtime context with markers (<project_memory>, <project_rules>, etc.) and session persistence", async () => {
    registerApiProvider(
      {
        api: "test-runtime-ctx-api" as Api,
        stream: mockProviderStream as unknown as any,
        streamSimple: mockProviderSimpleStream as unknown as any,
      },
      "source-runtime-test",
    );

    const testModel: Model<Api> = {
      id: "m3",
      name: "Test Model 3",
      api: "test-runtime-ctx-api" as Api,
      provider: "custom",
      baseUrl: "https://api.test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000,
      maxTokens: 100,
    };

    mockProviderStream.mockClear();
    const systemPromptWithMarker = "Base System Prompt\n<project_memory>\nMemory contents here";
    const context: Context = {
      systemPrompt: systemPromptWithMarker,
      messages: [{ role: "user", content: "Do task", timestamp: 1000 }],
    };

    const sessionId = "session-123";
    await complete(testModel, context, { sessionId });

    const passedContext = mockProviderStream.mock.calls[0][1];
    expect(passedContext.systemPrompt).toBe("Base System Prompt");
    expect(
      passedContext.messages.some((m: Message) =>
        (m.content?.[0] as { text?: string })?.text?.includes("<pi.runtime_context"),
      ),
    ).toBe(true);

    // Replay in same session with new user message
    mockProviderStream.mockClear();
    const secondContext: Context = {
      systemPrompt: "Base System Prompt",
      messages: [
        { role: "user", content: "Do task", timestamp: 1000 },
        {
          role: "assistant",
          content: [{ type: "text", text: "reply 1" }],
          api: testModel.api,
          provider: testModel.provider,
          model: testModel.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 1001,
        },
        { role: "user", content: "Next step", timestamp: 2000 },
      ],
    };

    await complete(testModel, secondContext, { sessionId });
    const replayedContext = mockProviderStream.mock.calls[0][1];
    expect(replayedContext.messages.length).toBe(4); // 2 user msgs + 1 assistant msg + 1 runtime context msg

    // Cleanup specific session
    cleanupSessionResources("session-123");

    unregisterApiProviders("source-runtime-test");
  });
});
