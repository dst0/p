import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearApiProviders,
  getApiProvider,
  getApiProviders,
  registerApiProvider,
  unregisterApiProviders,
} from "../src/api-registry.ts";
import type { Api, Context, Model, StreamFunction } from "../src/types.ts";
import { createAssistantMessageEventStream } from "../src/utils/event-stream.ts";

function createModel(api: Api): Model<Api> {
  return {
    id: `${api}-model`,
    name: `${api} model`,
    api,
    provider: "test-provider",
    baseUrl: "https://example.test",
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 1024,
    maxTokens: 256,
  };
}

afterEach(() => {
  clearApiProviders();
});

describe("API provider registry", () => {
  it("registers a provider and delegates both stream variants unchanged", () => {
    const stream = vi.fn<StreamFunction<Api>>(() => createAssistantMessageEventStream());
    const streamSimple = vi.fn<StreamFunction<Api>>(() => createAssistantMessageEventStream());
    const context: Context = { messages: [] };
    const model = createModel("custom-test-api");
    registerApiProvider(
      {
        api: "custom-test-api",
        stream,
        streamSimple,
      },
      "source-1",
    );

    const provider = getApiProvider("custom-test-api");
    expect(provider).toBeDefined();
    if (!provider) throw new Error("Expected the custom API provider to be registered");

    const streamResult = provider.stream(model, context, { maxTokens: 128 });
    const simpleResult = provider.streamSimple(model, context, { reasoning: "low" });

    expect(streamResult).toBeInstanceOf(Object);
    expect(simpleResult).toBeInstanceOf(Object);
    expect(stream).toHaveBeenCalledExactlyOnceWith(model, context, { maxTokens: 128 });
    expect(streamSimple).toHaveBeenCalledExactlyOnceWith(model, context, { reasoning: "low" });
    expect(getApiProviders()).toContainEqual(provider);
  });

  it("rejects mismatched models before invoking provider functions", () => {
    const stream = vi.fn<StreamFunction<Api>>(() => createAssistantMessageEventStream());
    const streamSimple = vi.fn<StreamFunction<Api>>(() => createAssistantMessageEventStream());
    registerApiProvider({
      api: "expected-api",
      stream,
      streamSimple,
    });
    const provider = getApiProvider("expected-api");
    expect(provider).toBeDefined();
    if (!provider) throw new Error("Expected the API provider to be registered");
    const mismatchedModel = createModel("different-api");
    const context: Context = { messages: [] };

    expect(() => provider.stream(mismatchedModel, context)).toThrow(
      "Mismatched api: different-api expected expected-api",
    );
    expect(() => provider.streamSimple(mismatchedModel, context)).toThrow(
      "Mismatched api: different-api expected expected-api",
    );
    expect(stream).not.toHaveBeenCalled();
    expect(streamSimple).not.toHaveBeenCalled();
  });

  it("unregisters only providers owned by the requested source", () => {
    const stream: StreamFunction<Api> = () => createAssistantMessageEventStream();
    registerApiProvider({ api: "source-one-api", stream, streamSimple: stream }, "source-1");
    registerApiProvider({ api: "source-two-api", stream, streamSimple: stream }, "source-2");

    unregisterApiProviders("missing-source");
    expect(getApiProvider("source-one-api")).toBeDefined();
    expect(getApiProvider("source-two-api")).toBeDefined();

    unregisterApiProviders("source-1");
    expect(getApiProvider("source-one-api")).toBeUndefined();
    expect(getApiProvider("source-two-api")).toBeDefined();

    clearApiProviders();
    expect(getApiProviders()).toEqual([]);
  });
});
