import { describe, expect, it } from "vitest";
import { adjustMaxTokensForThinking, buildBaseOptions, clampReasoning } from "../src/providers/simple-options.ts";
import type { Api, Model } from "../src/types.ts";

describe("simple-options", () => {
  it("buildBaseOptions forwards options and apiKey correctly", () => {
    const dummyModel: Model<Api> = { id: "m" } as any;
    const opts = buildBaseOptions(dummyModel, { temperature: 0.7, apiKey: "opt-key" }, "override-key");
    expect(opts.temperature).toBe(0.7);
    expect(opts.apiKey).toBe("override-key");
  });

  it("clampReasoning clamps xhigh to high", () => {
    expect(clampReasoning("xhigh")).toBe("high");
    expect(clampReasoning("medium")).toBe("medium");
    expect(clampReasoning(undefined)).toBeUndefined();
  });

  it("adjustMaxTokensForThinking adjusts thinkingBudget when maxTokens <= thinkingBudget", () => {
    // Model max tokens = 2000, baseMaxTokens = 500, reasoningLevel = "high" (default high budget = 16384)
    // maxTokens = Math.min(500 + 16384, 2000) = 2000.
    // 2000 <= 16384 => thinkingBudget = Math.max(0, 2000 - 1024) = 976.
    const res = adjustMaxTokensForThinking(500, 2000, "high");
    expect(res.maxTokens).toBe(2000);
    expect(res.thinkingBudget).toBe(976);
  });
});
