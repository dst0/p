import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../src/types.ts";
import { getOverflowPatterns, isContextOverflow } from "../src/utils/overflow.ts";

describe("overflow utility tests", () => {
  it("getOverflowPatterns returns array of regex patterns", () => {
    const patterns = getOverflowPatterns();
    expect(patterns.length).toBeGreaterThan(10);
    expect(patterns.some((p) => p.test("prompt is too long"))).toBe(true);
  });

  it("detects error-based context overflow matching known patterns", () => {
    const msg1: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      stopReason: "error",
      errorMessage: "prompt is too long: 213462 tokens > 200000 maximum",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now(),
    };
    expect(isContextOverflow(msg1)).toBe(true);

    const msg2: AssistantMessage = {
      ...msg1,
      errorMessage: "Your input exceeds the context window of this model",
    };
    expect(isContextOverflow(msg2)).toBe(true);

    const msg3: AssistantMessage = {
      ...msg1,
      errorMessage: "request_too_large error occurred",
    };
    expect(isContextOverflow(msg3)).toBe(true);
  });

  it("ignores throttling and rate limit errors even if they contain pattern keywords", () => {
    const throttleMsg: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "amazon-bedrock",
      provider: "bedrock",
      model: "claude",
      stopReason: "error",
      errorMessage: "Throttling error: Too many tokens, please wait before trying again.",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now(),
    };
    expect(isContextOverflow(throttleMsg)).toBe(false);

    const rateLimitMsg: AssistantMessage = {
      ...throttleMsg,
      errorMessage: "rate limit exceeded for endpoint",
    };
    expect(isContextOverflow(rateLimitMsg)).toBe(false);
  });

  it("detects silent context overflow when input usage exceeds context window", () => {
    const silentMsg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      api: "openai-completions",
      provider: "z.ai",
      model: "z-model",
      stopReason: "stop",
      usage: {
        input: 130000,
        output: 10,
        cacheRead: 5000,
        cacheWrite: 0,
        totalTokens: 135010,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now(),
    };
    // contextWindow = 128000 < (130000 + 5000)
    expect(isContextOverflow(silentMsg, 128000)).toBe(true);
    expect(isContextOverflow(silentMsg, 200000)).toBe(false);
  });

  it("detects length-stop overflow when input fills context window with zero output", () => {
    const lengthMsg: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "openai-completions",
      provider: "xiaomi",
      model: "mimo",
      stopReason: "length",
      usage: {
        input: 128000,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 128000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now(),
    };
    expect(isContextOverflow(lengthMsg, 128000)).toBe(true);
  });
});
