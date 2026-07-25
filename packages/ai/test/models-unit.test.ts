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

describe("models utility functions", () => {
  it("getProviders returns non-empty list of known providers", () => {
    const providers = getProviders();
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
  });

  it("getModels retrieves models array for a provider or empty array", () => {
    const anthropicModels = getModels("anthropic");
    expect(anthropicModels.length).toBeGreaterThan(0);
    const unknownModels = getModels("nonexistent" as any);
    expect(unknownModels).toEqual([]);
  });

  it("getModel retrieves a specific model object", () => {
    const model = getModel("anthropic", "claude-fable-5");
    expect(model).toBeDefined();
    expect(model.provider).toBe("anthropic");
  });

  it("calculateCost correctly calculates costs for standard and 1h cache writes", () => {
    const dummyModel: Model<any> = {
      id: "test-model",
      name: "Test Model",
      api: "anthropic-messages" as any,
      provider: "anthropic" as any,
      baseUrl: "https://api.anthropic.com",
      reasoning: false,
      input: ["text"],
      cost: {
        input: 3, // $3 / Mtok
        output: 15, // $15 / Mtok
        cacheRead: 0.3, // $0.3 / Mtok
        cacheWrite: 3.75, // $3.75 / Mtok
      },
      contextWindow: 200000,
      maxTokens: 4096,
    };

    const usage: Usage = {
      input: 1000000,
      output: 1000000,
      cacheRead: 1000000,
      cacheWrite: 2000000,
      cacheWrite1h: 500000,
      totalTokens: 3000000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };

    const cost = calculateCost(dummyModel, usage);
    expect(cost.input).toBe(3);
    expect(cost.output).toBe(15);
    expect(cost.cacheRead).toBe(0.3);
    // shortWrite = 1500000 * 3.75 = 5625000; longWrite = 500000 * (3 * 2) = 3000000; sum = 8625000 / 1000000 = 8.625
    expect(cost.cacheWrite).toBeCloseTo(8.625);
    expect(cost.total).toBeCloseTo(3 + 15 + 0.3 + 8.625);
  });

  it("getSupportedThinkingLevels handles reasoning disable and custom level mappings", () => {
    const nonReasoningModel: Model<any> = {
      id: "no-reasoning",
      name: "No Reasoning",
      api: "openai-completions" as any,
      provider: "openai" as any,
      baseUrl: "",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 1024,
    };
    expect(getSupportedThinkingLevels(nonReasoningModel)).toEqual(["off"]);

    const reasoningModel: Model<any> = {
      id: "reasoning-model",
      name: "Reasoning Model",
      api: "anthropic-messages" as any,
      provider: "anthropic" as any,
      baseUrl: "",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 4096,
      thinkingLevelMap: {
        off: undefined,
        minimal: null, // disabled
        low: undefined,
        medium: undefined,
        high: undefined,
        xhigh: "xhigh",
      },
    };

    const levels = getSupportedThinkingLevels(reasoningModel);
    expect(levels).not.toContain("minimal");
    expect(levels).toContain("off");
    expect(levels).toContain("high");
    expect(levels).toContain("xhigh");
  });

  it("clampThinkingLevel clamps requested level to supported candidate", () => {
    const model: Model<any> = {
      id: "clamp-model",
      name: "Clamp Model",
      api: "openai-completions" as any,
      provider: "openai" as any,
      baseUrl: "",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 1024,
      thinkingLevelMap: {
        off: undefined,
        minimal: null,
        low: undefined,
        medium: undefined,
        high: null,
        xhigh: null,
      },
    };

    expect(clampThinkingLevel(model, "low")).toBe("low");
    // "high" is null, should clamp to next available level or fall back
    expect(clampThinkingLevel(model, "high")).toBe("medium");
    expect(clampThinkingLevel(model, "invalid" as any)).toBe("off");

    const noLevelsModel: Model<any> = {
      ...model,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: null,
        medium: null,
        high: null,
        xhigh: null,
      },
    };
    expect(clampThinkingLevel(noLevelsModel, "high")).toBe("off");
  });

  it("modelsAreEqual compares models correctly", () => {
    const m1: Model<any> = {
      id: "m1",
      name: "M1",
      api: "openai-completions" as any,
      provider: "openai" as any,
      baseUrl: "",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 1024,
    };
    const m1Clone = { ...m1 };
    const m2 = { ...m1, id: "m2" };

    expect(modelsAreEqual(m1, m1Clone)).toBe(true);
    expect(modelsAreEqual(m1, m2)).toBe(false);
    expect(modelsAreEqual(m1, null)).toBe(false);
    expect(modelsAreEqual(undefined, m1)).toBe(false);
  });
});
