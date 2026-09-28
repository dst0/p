type JsonObject = Record<string, unknown>;

const pCompatFlags = [
  "supportsStore",
  "supportsDeveloperRole",
  "supportsReasoningEffort",
  "supportsUsageInStreaming",
  "requiresToolResultName",
  "requiresAssistantAfterToolResult",
  "requiresThinkingAsText",
  "requiresReasoningContentOnAssistantMessages",
  "supportsStrictMode",
  "sendSessionAffinityHeaders",
  "supportsLongCacheRetention",
  "cachePrompt",
] as const;
const kiloModelFlags = ["tool_call", "reasoning", "temperature", "attachment"] as const;
const modalityNames = new Set(["text", "image", "audio", "video", "pdf"]);
const thinkingFormats = new Set(["openai", "openrouter", "together", "deepseek", "zai", "qwen", "qwen-chat-template"]);

function objectValue(value: unknown): JsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as JsonObject;
  throw new Error("Certified selected model metadata has an invalid object");
}

function copyBoolean(source: JsonObject, target: JsonObject, key: string): void {
  const value = source[key];
  if (value === undefined) return;
  if (typeof value !== "boolean") throw new Error("Certified selected model metadata has an invalid flag");
  target[key] = value;
}

function copyNumber(source: JsonObject, target: JsonObject, key: string, allowZero = false): void {
  const value = source[key];
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error("Certified selected model metadata has an invalid numeric limit");
  }
  target[key] = value;
}

function enumArray(value: unknown, allowed: ReadonlySet<string>): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !allowed.has(item))) {
    throw new Error("Certified selected model metadata has invalid modalities");
  }
  return [...value] as string[];
}

function projectPCompat(value: unknown): JsonObject {
  const source = objectValue(value);
  const projected: JsonObject = {};
  for (const key of pCompatFlags) copyBoolean(source, projected, key);
  if (source.thinkingFormat !== undefined) {
    if (typeof source.thinkingFormat !== "string" || !thinkingFormats.has(source.thinkingFormat)) {
      throw new Error("Certified P/Pi model has an invalid thinking format");
    }
    projected.thinkingFormat = source.thinkingFormat;
  }
  if (source.maxTokensField !== undefined) {
    if (source.maxTokensField !== "max_tokens" && source.maxTokensField !== "max_completion_tokens") {
      throw new Error("Certified P/Pi model has an invalid token field");
    }
    projected.maxTokensField = source.maxTokensField;
  }
  if (source.cacheControlFormat === "anthropic") projected.cacheControlFormat = "anthropic";
  return projected;
}

export function projectCertifiedPConfig(
  providerId: string,
  sourceProvider: JsonObject,
  sourceModel: JsonObject,
  modelId: string,
  proxyUrl: string,
): JsonObject {
  const model: JsonObject = { id: modelId, name: "Certified benchmark model" };
  for (const key of ["reasoning"] as const) copyBoolean(sourceModel, model, key);
  for (const key of ["contextWindow", "maxTokens"] as const) copyNumber(sourceModel, model, key);
  if (sourceModel.input !== undefined) model.input = enumArray(sourceModel.input, new Set(["text", "image"]));
  if (sourceModel.cost !== undefined) {
    const cost = objectValue(sourceModel.cost);
    const projectedCost: JsonObject = {};
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      copyNumber(cost, projectedCost, key, true);
    }
    model.cost = projectedCost;
  }
  if (sourceModel.compat !== undefined) model.compat = projectPCompat(sourceModel.compat);
  const provider: JsonObject = {
    api: "openai-completions",
    baseUrl: proxyUrl,
    apiKey: "benchmark-proxy",
    models: [model],
  };
  if (sourceProvider.compat !== undefined) provider.compat = projectPCompat(sourceProvider.compat);
  return { providers: { [providerId]: provider } };
}

export function projectCertifiedKiloConfig(
  providerId: string,
  modelAlias: string,
  sourceOptions: JsonObject,
  sourceModel: JsonObject,
  modelId: string,
  proxyUrl: string,
): JsonObject {
  const options: JsonObject = { baseURL: proxyUrl, apiKey: "benchmark-proxy" };
  copyBoolean(sourceOptions, options, "timeout");
  copyNumber(sourceOptions, options, "chunkTimeout");
  const model: JsonObject = { id: modelId, name: "Certified benchmark model" };
  for (const key of kiloModelFlags) copyBoolean(sourceModel, model, key);
  if (sourceModel.limit !== undefined) {
    const limit = objectValue(sourceModel.limit);
    const projectedLimit: JsonObject = {};
    for (const key of ["context", "output"] as const) copyNumber(limit, projectedLimit, key);
    model.limit = projectedLimit;
  }
  if (sourceModel.modalities !== undefined) {
    const modalities = objectValue(sourceModel.modalities);
    const projectedModalities: JsonObject = {};
    for (const key of ["input", "output"] as const) {
      if (modalities[key] !== undefined) projectedModalities[key] = enumArray(modalities[key], modalityNames);
    }
    model.modalities = projectedModalities;
  }
  return {
    model: `${providerId}/${modelAlias}`,
    provider: {
      [providerId]: {
        npm: "@ai-sdk/openai-compatible",
        options,
        models: { [modelAlias]: model },
      },
    },
  };
}
