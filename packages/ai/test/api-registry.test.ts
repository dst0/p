import { describe, expect, it, vi } from "vitest";
import {
  clearApiProviders,
  getApiProvider,
  getApiProviders,
  registerApiProvider,
  unregisterApiProviders,
} from "../src/api-registry.ts";
import type { Api, Model, StreamFunction } from "../src/types.ts";
import { createAssistantMessageEventStream } from "../src/utils/event-stream.ts";

describe("api-registry", () => {
  it("registers, retrieves, lists, unregisters, and clears API providers", () => {
    const dummyStream = vi.fn(() => createAssistantMessageEventStream()) as unknown as StreamFunction<Api>;
    const dummySimple = vi.fn(() => createAssistantMessageEventStream()) as unknown as StreamFunction<Api>;

    registerApiProvider(
      {
        api: "custom-test-api" as Api,
        stream: dummyStream,
        streamSimple: dummySimple,
      },
      "source-1",
    );

    const provider = getApiProvider("custom-test-api" as Api);
    expect(provider).toBeDefined();
    expect(provider?.api).toBe("custom-test-api");

    const allProviders = getApiProviders();
    expect(allProviders.some((p) => p.api === "custom-test-api")).toBe(true);

    // Unregister by sourceId
    unregisterApiProviders("source-1");
    expect(getApiProvider("custom-test-api" as Api)).toBeUndefined();

    // Re-register and clear
    registerApiProvider(
      {
        api: "custom-test-api" as Api,
        stream: dummyStream,
        streamSimple: dummySimple,
      },
      "source-1",
    );
    clearApiProviders();
    expect(getApiProvider("custom-test-api" as Api)).toBeUndefined();
  });

  it("throws mismatched api error in stream wrapper when model.api does not match provider.api", () => {
    const dummyStream = vi.fn(() => createAssistantMessageEventStream()) as unknown as StreamFunction<Api>;
    const dummySimple = vi.fn(() => createAssistantMessageEventStream()) as unknown as StreamFunction<Api>;

    registerApiProvider(
      {
        api: "test-api-mismatch-1" as Api,
        stream: dummyStream,
        streamSimple: dummySimple,
      },
      "source-mismatch",
    );

    const provider = getApiProvider("test-api-mismatch-1" as Api);
    expect(provider).toBeDefined();

    const badModel = { api: "different-api" } as unknown as Model<Api>;
    const context = { messages: [] };

    expect(() => provider!.stream(badModel, context)).toThrow(
      "Mismatched api: different-api expected test-api-mismatch-1",
    );
    expect(() => provider!.streamSimple(badModel, context)).toThrow(
      "Mismatched api: different-api expected test-api-mismatch-1",
    );

    unregisterApiProviders("source-mismatch");
  });
});
