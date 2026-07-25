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
import type { Api, Model, Usage } from "../src/types.ts";

function createModel<TApi extends Api>(api: TApi, overrides: Partial<Model<TApi>> = {}): Model<TApi> {
  return {
    id: "test-model",
    name: "Test model",
    api,
    provider: "test-provider",
    baseUrl: "https://example.test",
    reasoning: false,
    input: ["text"],
    cost: {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    },
    contextWindow: 200_000,
    maxTokens: 4096,
    ...overrides,
  };
}

function createUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 1_000_000,
    output: 1_000_000,
    cacheRead: 1_000_000,
    cacheWrite: 2_000_000,
    totalTokens: 4_000_000,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
    ...overrides,
  };
}

describe("model registry", () => {
  it("lists known providers and resolves a generated model", () => {
    expect(getProviders()).toEqual(expect.arrayContaining(["anthropic", "openai"]));
    expect(getModels("anthropic").length).toBeGreaterThan(0);

    const model = getModel("anthropic", "claude-fable-5");
    expect(model).toMatchObject({
      id: "claude-fable-5",
      provider: "anthropic",
    });
  });
});

describe("model cost calculation", () => {
  it("calculates standard cache writes exactly", () => {
    const usage = createUsage();

    expect(calculateCost(createModel("anthropic-messages"), usage)).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 7.5,
      total: 25.8,
    });
  });

  it("charges one-hour cache writes at twice the base input rate", () => {
    const usage = createUsage({ cacheWrite1h: 500_000 });

    expect(calculateCost(createModel("anthropic-messages"), usage)).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 8.625,
      total: 26.925,
    });
  });
});

describe("model thinking levels", () => {
  it("returns only off for a non-reasoning model", () => {
    expect(getSupportedThinkingLevels(createModel("openai-completions"))).toEqual(["off"]);
  });

  it("applies explicit disabled and extended thinking mappings", () => {
    const model = createModel("anthropic-messages", {
      reasoning: true,
      thinkingLevelMap: {
        minimal: null,
        xhigh: "extended",
      },
    });

    expect(getSupportedThinkingLevels(model)).toEqual(["off", "low", "medium", "high", "xhigh"]);
  });

  it("keeps supported requests and clamps unsupported requests to the nearest level", () => {
    const model = createModel("openai-completions", {
      reasoning: true,
      thinkingLevelMap: {
        off: undefined,
        minimal: null,
        low: undefined,
        medium: undefined,
        high: null,
        xhigh: null,
      },
    });

    expect(clampThinkingLevel(model, "low")).toBe("low");
    expect(clampThinkingLevel(model, "high")).toBe("medium");
  });

  it("falls back to off when every thinking level is disabled", () => {
    const model = createModel("openai-completions", {
      reasoning: true,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: null,
        medium: null,
        high: null,
        xhigh: null,
      },
    });

    expect(clampThinkingLevel(model, "high")).toBe("off");
  });
});

describe("model identity", () => {
  it("requires both model ID and provider to match", () => {
    const model = createModel("openai-completions", { id: "same", provider: "provider-a" });

    expect(modelsAreEqual(model, { ...model })).toBe(true);
    expect(modelsAreEqual(model, { ...model, id: "different" })).toBe(false);
    expect(modelsAreEqual(model, { ...model, provider: "provider-b" })).toBe(false);
    expect(modelsAreEqual(model, null)).toBe(false);
    expect(modelsAreEqual(undefined, model)).toBe(false);
  });
});
