import { type Api, getModels, getProviders, type KnownProvider, type Model } from "@dst0/p-ai";
import { isConfigValueConfigured } from "../../resolve-config-value.ts";
import { createModelFromDefinition, mergeCompat } from "../helpers.ts";
import type { ModelRegistry } from "../modelregistry.ts";
import type { ModelsConfig } from "../types.ts";

export function do_validateConfig(_self: ModelRegistry, config: ModelsConfig): void {
  const builtInProviders = new Set<string>(getProviders());

  for (const [providerName, providerConfig] of Object.entries(config.providers)) {
    const isBuiltIn = builtInProviders.has(providerName);
    const hasProviderApi = !!providerConfig.api;
    const models = providerConfig.models ?? [];
    const hasModelOverrides = providerConfig.modelOverrides && Object.keys(providerConfig.modelOverrides).length > 0;

    if (models.length === 0) {
      // Override-only config: needs baseUrl, headers, compat, modelOverrides, or some combination.
      if (!providerConfig.baseUrl && !providerConfig.headers && !providerConfig.compat && !hasModelOverrides) {
        throw new Error(
          `Provider ${providerName}: must specify "baseUrl", "headers", "compat", "modelOverrides", or "models".`,
        );
      }
    } else if (!isBuiltIn) {
      // Non-built-in providers with custom models require endpoint + auth.
      if (!providerConfig.baseUrl) {
        throw new Error(`Provider ${providerName}: "baseUrl" is required when defining custom models.`);
      }
      if (!providerConfig.apiKey) {
        throw new Error(`Provider ${providerName}: "apiKey" is required when defining custom models.`);
      }
    }
    // Built-in providers with custom models: baseUrl/apiKey/api are optional,
    // inherited from built-in models. Auth comes from env vars / auth storage.

    for (const modelDef of models) {
      const hasModelApi = !!modelDef.api;

      if (!hasProviderApi && !hasModelApi && !isBuiltIn) {
        throw new Error(
          `Provider ${providerName}, model ${modelDef.id}: no "api" specified. Set at provider or model level.`,
        );
      }
      // For built-in providers, api is optional — inherited from built-in models.

      if (!modelDef.id) throw new Error(`Provider ${providerName}: model missing "id"`);
      // Validate contextWindow/maxTokens only if provided (they have defaults)
      if (modelDef.contextWindow !== undefined && modelDef.contextWindow <= 0)
        throw new Error(`Provider ${providerName}, model ${modelDef.id}: invalid contextWindow`);
      if (modelDef.maxTokens !== undefined && modelDef.maxTokens <= 0)
        throw new Error(`Provider ${providerName}, model ${modelDef.id}: invalid maxTokens`);
    }
  }
}

export function do_parseModels(self: ModelRegistry, config: ModelsConfig): Model<Api>[] {
  const models: Model<Api>[] = [];
  const builtInProviders = new Set<string>(getProviders());

  // Cache built-in defaults (api, baseUrl) per provider, extracted from first model.
  const builtInDefaultsCache = new Map<string, { api: string; baseUrl: string }>();
  const getBuiltInDefaults = (providerName: string): { api: string; baseUrl: string } | undefined => {
    if (!builtInProviders.has(providerName)) return undefined;
    if (builtInDefaultsCache.has(providerName)) return builtInDefaultsCache.get(providerName);
    const builtIn = getModels(providerName as KnownProvider) as Model<Api>[];
    if (builtIn.length === 0) return undefined;
    const defaults = { api: builtIn[0].api, baseUrl: builtIn[0].baseUrl };
    builtInDefaultsCache.set(providerName, defaults);
    return defaults;
  };

  for (const [providerName, providerConfig] of Object.entries(config.providers)) {
    const modelDefs = providerConfig.models ?? [];
    if (modelDefs.length === 0) continue; // Override-only, no custom models

    const builtInDefaults = getBuiltInDefaults(providerName);

    for (const modelDef of modelDefs) {
      const api = modelDef.api ?? providerConfig.api ?? builtInDefaults?.api;
      if (!api) continue;

      const baseUrl = modelDef.baseUrl ?? providerConfig.baseUrl ?? builtInDefaults?.baseUrl;
      if (!baseUrl) continue;

      const compat = mergeCompat(providerConfig.compat, modelDef.compat);
      self.storeModelHeaders(providerName, modelDef.id, modelDef.headers);

      models.push(createModelFromDefinition(providerName, modelDef, api as Api, baseUrl, compat));
    }
  }

  return models;
}

export function do_getAll(self: ModelRegistry): Model<Api>[] {
  return self.models;
}

export function do_getAvailable(self: ModelRegistry): Model<Api>[] {
  return self.models.filter((m) => self.hasConfiguredAuth(m));
}

export function do_find(self: ModelRegistry, provider: string, modelId: string): Model<Api> | undefined {
  return self.models.find((m) => m.provider === provider && m.id === modelId);
}

export function do_hasConfiguredAuth(self: ModelRegistry, model: Model<Api>): boolean {
  const providerApiKey = self.providerRequestConfigs.get(model.provider)?.apiKey;
  return (
    self.authStorage.hasAuth(model.provider) ||
    (providerApiKey !== undefined && isConfigValueConfigured(providerApiKey))
  );
}

export function do_getModelRequestKey(_self: ModelRegistry, provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

export function do_storeProviderRequestConfig(
  self: ModelRegistry,
  providerName: string,
  config: {
    apiKey?: string;
    headers?: Record<string, string>;
    authHeader?: boolean;
  },
): void {
  if (!config.apiKey && !config.headers && !config.authHeader) {
    return;
  }

  self.providerRequestConfigs.set(providerName, {
    apiKey: config.apiKey,
    headers: config.headers,
    authHeader: config.authHeader,
  });
}

export function do_storeModelHeaders(
  self: ModelRegistry,
  providerName: string,
  modelId: string,
  headers?: Record<string, string>,
): void {
  const key = self.getModelRequestKey(providerName, modelId);
  if (!headers || Object.keys(headers).length === 0) {
    self.modelRequestHeaders.delete(key);
    return;
  }
  self.modelRequestHeaders.set(key, headers);
}
