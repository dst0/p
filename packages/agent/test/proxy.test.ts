import type { Context, Model } from "@dst0/p-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamProxy } from "../src/proxy.ts";

describe("streamProxy", () => {
  const mockModel = {
    id: "test-model",
    api: "openai-completions",
    provider: "openai",
    name: "Test Model",
  } as Model<any>;

  const mockContext: Context = {
    messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("streams SSE events and reconstructs assistant message", async () => {
    const sseEvents = [
      { type: "start" },
      { type: "text_start", contentIndex: 0 },
      { type: "text_delta", contentIndex: 0, delta: "Hello " },
      { type: "text_delta", contentIndex: 0, delta: "World" },
      { type: "text_end", contentIndex: 0, contentSignature: "sig123" },
      { type: "thinking_start", contentIndex: 1 },
      { type: "thinking_delta", contentIndex: 1, delta: "Thinking..." },
      { type: "thinking_end", contentIndex: 1, contentSignature: "thinkSig" },
      { type: "toolcall_start", contentIndex: 2, id: "call_1", toolName: "calculator" },
      { type: "toolcall_delta", contentIndex: 2, delta: '{"x": 1}' },
      { type: "toolcall_end", contentIndex: 2 },
      {
        type: "done",
        reason: "stop",
        usage: {
          input: 10,
          output: 20,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 30,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
    ];

    const sseBody = sseEvents.map((ev) => `data: ${JSON.stringify(ev)}\n\n`).join("");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          let readDone = false;
          return {
            read: async () => {
              if (readDone) return { done: true, value: undefined };
              readDone = true;
              return { done: false, value: new TextEncoder().encode(sseBody) };
            },
            cancel: async () => {},
          };
        },
      },
    });

    const stream = streamProxy(mockModel, mockContext, {
      proxyUrl: "http://localhost:3000",
      authToken: "secret-token",
    });

    const events = [];
    for await (const ev of stream) {
      events.push(ev);
    }
    expect(events.length).toBeGreaterThan(0);

    const result = await stream.result();
    expect(result.role).toBe("assistant");
    expect(result.content[0]).toEqual({ type: "text", text: "Hello World", textSignature: "sig123" });
    expect(result.content[1]).toEqual({ type: "thinking", thinking: "Thinking...", thinkingSignature: "thinkSig" });
    expect(result.content[2]).toEqual({ type: "toolCall", id: "call_1", name: "calculator", arguments: { x: 1 } });
    expect(result.stopReason).toBe("stop");
  });

  it("handles HTTP error status with JSON error message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ error: "Invalid token" }),
    });

    const stream = streamProxy(mockModel, mockContext, {
      proxyUrl: "http://localhost:3000",
      authToken: "bad-token",
    });

    const result = await stream.result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("Proxy error: Invalid token");
  });

  it("handles HTTP error status with fallback statusText", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => {
        throw new Error("Not JSON");
      },
    });

    const stream = streamProxy(mockModel, mockContext, {
      proxyUrl: "http://localhost:3000",
      authToken: "token",
    });

    const result = await stream.result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("Proxy error: 500 Internal Server Error");
  });

  it("handles abort signal cancellation", async () => {
    const controller = new AbortController();

    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      if (opts.signal?.aborted) {
        const err = new Error("Request aborted by user");
        throw err;
      }
      const err = new Error("Request aborted by user");
      throw err;
    });

    controller.abort();

    const stream = streamProxy(mockModel, mockContext, {
      proxyUrl: "http://localhost:3000",
      authToken: "token",
      signal: controller.signal,
    });

    const result = await stream.result();
    expect(result.stopReason).toBe("aborted");
  });
});
