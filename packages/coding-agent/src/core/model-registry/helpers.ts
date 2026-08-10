import type { AnthropicMessagesCompat, Api, Model, OpenAICompletionsCompat, OpenAIResponsesCompat } from "@dst0/p-ai";
import type { TLocalizedValidationError } from "typebox/error";
import type { CustomModelsResult, ModelDefinition, ModelOverride } from "./types.ts";

export function getDefaultModelCost(): Model<Api>["cost"] {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function createModelFromDefinition(
  providerName: string,
  modelDef: ModelDefinition,
  api: Api,
  baseUrl: string,
  compat: Model<Api>["compat"],
): Model<Api> {
  return {
    id: modelDef.id,
    name: modelDef.name ?? modelDef.id,
    api,
    provider: providerName,
    baseUrl,
    reasoning: modelDef.reasoning ?? false,
    thinkingLevelMap: modelDef.thinkingLevelMap,
    input: (modelDef.input ?? ["text"]) as ("text" | "image")[],
    cost: modelDef.cost ?? getDefaultModelCost(),
    contextWindow: modelDef.contextWindow ?? 128000,
    maxTokens: modelDef.maxTokens ?? 16384,
    headers: undefined,
    compat,
  } as Model<Api>;
}

export function formatValidationPath(error: TLocalizedValidationError): string {
  if (error.keyword === "required") {
    const requiredProperties = (error.params as { requiredProperties?: string[] }).requiredProperties;
    const requiredProperty = requiredProperties?.[0];
    if (requiredProperty) {
      const basePath = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
      return basePath ? `${basePath}.${requiredProperty}` : requiredProperty;
    }
  }
  const path = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
  return path || "root";
}

export function emptyCustomModelsResult(error?: string): CustomModelsResult {
  return { models: [], overrides: new Map(), modelOverrides: new Map(), error };
}

export function mergeCompat(
  baseCompat: Model<Api>["compat"],
  overrideCompat: ModelOverride["compat"],
): Model<Api>["compat"] | undefined {
  if (!overrideCompat) return baseCompat;

  const base = baseCompat as OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat | undefined;
  const override = overrideCompat as OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat;
  const merged = { ...base, ...override } as OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat;

  const baseCompletions = base as OpenAICompletionsCompat | undefined;
  const overrideCompletions = override as OpenAICompletionsCompat;
  const mergedCompletions = merged as OpenAICompletionsCompat;

  if (baseCompletions?.openRouterRouting || overrideCompletions.openRouterRouting) {
    mergedCompletions.openRouterRouting = {
      ...baseCompletions?.openRouterRouting,
      ...overrideCompletions.openRouterRouting,
    };
  }

  if (baseCompletions?.vercelGatewayRouting || overrideCompletions.vercelGatewayRouting) {
    mergedCompletions.vercelGatewayRouting = {
      ...baseCompletions?.vercelGatewayRouting,
      ...overrideCompletions.vercelGatewayRouting,
    };
  }

  return merged as Model<Api>["compat"];
}

export function applyModelOverride(model: Model<Api>, override: ModelOverride): Model<Api> {
  const result = { ...model };

  // Simple field overrides
  if (override.name !== undefined) result.name = override.name;
  if (override.reasoning !== undefined) result.reasoning = override.reasoning;
  if (override.thinkingLevelMap !== undefined) {
    result.thinkingLevelMap = { ...model.thinkingLevelMap, ...override.thinkingLevelMap };
  }
  if (override.input !== undefined) result.input = override.input as ("text" | "image")[];
  if (override.contextWindow !== undefined) result.contextWindow = override.contextWindow;
  if (override.maxTokens !== undefined) result.maxTokens = override.maxTokens;

  // Merge cost (partial override)
  if (override.cost) {
    result.cost = {
      input: override.cost.input ?? model.cost.input,
      output: override.cost.output ?? model.cost.output,
      cacheRead: override.cost.cacheRead ?? model.cost.cacheRead,
      cacheWrite: override.cost.cacheWrite ?? model.cost.cacheWrite,
    };
  }

  // Deep merge compat
  result.compat = mergeCompat(model.compat, override.compat);

  return result;
}
