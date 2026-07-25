import { describe, expect, it } from "vitest";
import {
  calculateCost,
  clampThinkingLevel,
  getModel,
  getModels,
  getProviders,
  getSupportedThinkingLevels,
  modelsAreEqual,
} from "../src/models.ts";
import type { Model, Usage } from "../src/types.ts";

describe("models registry", () => {
  it("getProviders and getModels work", () => {
    const providers = getProviders();
    expect(providers.length).toBeGreaterThan(0);
    expect(providers).toContain("anthropic");

    const anthropicModels = getModels("anthropic");
    expect(anthropicModels.length).toBeGreaterThan(0);
    expect(anthropicModels[0].provider).toBe("anthropic");
  });

  it("getModel returns the model", () => {
    const modelId = getModels("anthropic")[0].id as any;
    const m = getModel("anthropic", modelId);
    expect(m).toBeTruthy();
    expect(m.id).toBe(modelId);
  });

  it("calculates cost accurately with and without cacheWrite1h", () => {
    const m = getModels("anthropic")[0] as Model<any>;
    const usage: Usage = {
      input: 1000,
      output: 500,
      cacheRead: 200,
      cacheWrite: 300,
      cacheWrite1h: 100, // 100 long, 200 short
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };

    const cost = calculateCost(m, usage);
    expect(cost.total).toBeGreaterThan(0);

    // without cacheWrite1h
    const usage2: Usage = {
      ...usage,
      cacheWrite1h: undefined,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const cost2 = calculateCost(m, usage2);
    expect(cost2.total).toBeGreaterThan(0);
  });

  it("getSupportedThinkingLevels works", () => {
    const normalModel: Model<any> = { ...getModels("anthropic")[0], reasoning: false };
    expect(getSupportedThinkingLevels(normalModel)).toEqual(["off"]);

    const reasoningModel: Model<any> = {
      id: "test",
      provider: "anthropic",
      api: "anthropic",
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 10,
      reasoning: true,
      thinkingLevelMap: { low: null, high: "something", xhigh: "enabled" },
    } as any;

    const levels = getSupportedThinkingLevels(reasoningModel);
    expect(levels).not.toContain("low");
    expect(levels).toContain("high");
    expect(levels).toContain("xhigh");
  });

  it("clampThinkingLevel works", () => {
    const reasoningModel: Model<any> = {
      id: "test",
      provider: "anthropic",
      api: "anthropic",
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 10,
      reasoning: true,
      thinkingLevelMap: { low: null, medium: "med", high: "hi", xhigh: undefined },
    } as any;

    expect(clampThinkingLevel(reasoningModel, "medium")).toBe("medium");
    expect(clampThinkingLevel(reasoningModel, "xhigh")).toBe("high");
    expect(clampThinkingLevel(reasoningModel, "low")).toBe("medium");
    expect(clampThinkingLevel(reasoningModel, "foo" as any)).toBe("off");
  });

  it("modelsAreEqual works", () => {
    expect(modelsAreEqual(null, null)).toBe(false);
    expect(modelsAreEqual(undefined, {} as any)).toBe(false);
    expect(modelsAreEqual({ id: "a", provider: "p" } as any, { id: "a", provider: "p" } as any)).toBe(true);
    expect(modelsAreEqual({ id: "a", provider: "p" } as any, { id: "b", provider: "p" } as any)).toBe(false);
    expect(modelsAreEqual({ id: "a", provider: "p" } as any, { id: "a", provider: "q" } as any)).toBe(false);
  });
});

it("clampThinkingLevel fallback to off if no levels", () => {
  const emptyModel: Model<any> = {
    id: "empty",
    provider: "anthropic",
    api: "anthropic",
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 10,
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: null, xhigh: null },
  } as any;
  expect(clampThinkingLevel(emptyModel, "low")).toBe("off");
});

it("getModels with unknown provider returns empty", () => {
  expect(getModels("unknown" as any)).toEqual([]);
});

it("clampThinkingLevel requestedIndex=-1 with empty levels", () => {
  const emptyModel: Model<any> = {
    id: "empty",
    provider: "anthropic",
    api: "anthropic",
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 10,
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: null, xhigh: null },
  } as any;
  expect(clampThinkingLevel(emptyModel, "foo" as any)).toBe("off");
});
