import { type Api, getModels, getProviders, type KnownProvider, type Model, resetApiProviders } from "@dst0/p-ai";
import { resetOAuthProviders } from "@dst0/p-ai/oauth";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "../../../config.ts";
import { stripJsonComments } from "../../../utils/json.ts";
import type { AuthStorage } from "../../auth-storage.ts";
import { validateModelsConfig } from "../constants.ts";
import { applyModelOverride, emptyCustomModelsResult, formatValidationPath, mergeCompat } from "../helpers.ts";
import { ModelRegistry } from "../modelregistry.ts";
import type { CustomModelsResult, ModelOverride, ModelsConfig, ProviderOverride } from "../types.ts";

export function do_create(
  authStorage: AuthStorage,
  modelsJsonPath: string = join(getAgentDir(), "models.json"),
): ModelRegistry {
  return new ModelRegistry(authStorage, modelsJsonPath);
}

export function do_inMemory(authStorage: AuthStorage): ModelRegistry {
  return new ModelRegistry(authStorage, undefined);
}

export function do_refresh(self: ModelRegistry): void {
  self.providerRequestConfigs.clear();
  self.modelRequestHeaders.clear();
  self.loadError = undefined;

  // Ensure dynamic API/OAuth registrations are rebuilt from current provider state.
  resetApiProviders();
  resetOAuthProviders();

  self.loadModels();

  for (const [providerName, config] of self.registeredProviders.entries()) {
    self.applyProviderConfig(providerName, config);
  }
}

export function do_getError(self: ModelRegistry): string | undefined {
  return self.loadError;
}

export function do_loadModels(self: ModelRegistry): void {
  // Load custom models and overrides from models.json
  const {
    models: customModels,
    overrides,
    modelOverrides,
    error,
  } = self.modelsJsonPath ? self.loadCustomModels(self.modelsJsonPath) : emptyCustomModelsResult();

  if (error) {
    self.loadError = error;
    // Keep built-in models even if custom models failed to load
  }

  const builtInModels = self.onlyLocalModels ? [] : self.loadBuiltInModels(overrides, modelOverrides);
  let combined = self.mergeCustomModels(builtInModels, customModels);

  // Let OAuth providers modify their models (e.g., update baseUrl)
  for (const oauthProvider of self.authStorage.getOAuthProviders()) {
    const cred = self.authStorage.get(oauthProvider.id);
    if (cred?.type === "oauth" && oauthProvider.modifyModels) {
      combined = oauthProvider.modifyModels(combined, cred);
    }
  }

  self.configuredModels = combined;
  self.models = [...combined];
}

export function do_loadBuiltInModels(
  _self: ModelRegistry,
  overrides: Map<string, ProviderOverride>,
  modelOverrides: Map<string, Map<string, ModelOverride>>,
): Model<Api>[] {
  return getProviders().flatMap((provider) => {
    const models = getModels(provider as KnownProvider) as Model<Api>[];
    const providerOverride = overrides.get(provider);
    const perModelOverrides = modelOverrides.get(provider);

    return models.map((m) => {
      let model = m;

      // Apply provider-level baseUrl/headers/compat override
      if (providerOverride) {
        model = {
          ...model,
          baseUrl: providerOverride.baseUrl ?? model.baseUrl,
          compat: mergeCompat(model.compat, providerOverride.compat),
        };
      }

      // Apply per-model override
      const modelOverride = perModelOverrides?.get(m.id);
      if (modelOverride) {
        model = applyModelOverride(model, modelOverride);
      }

      return model;
    });
  });
}

export function do_mergeCustomModels(
  _self: ModelRegistry,
  builtInModels: Model<Api>[],
  customModels: Model<Api>[],
): Model<Api>[] {
  const merged = [...builtInModels];
  for (const customModel of customModels) {
    const existingIndex = merged.findIndex((m) => m.provider === customModel.provider && m.id === customModel.id);
    if (existingIndex >= 0) {
      merged[existingIndex] = customModel;
    } else {
      merged.push(customModel);
    }
  }
  return merged;
}

export function do_loadCustomModels(self: ModelRegistry, modelsJsonPath: string): CustomModelsResult {
  if (!existsSync(modelsJsonPath)) {
    return emptyCustomModelsResult();
  }

  try {
    const content = readFileSync(modelsJsonPath, "utf-8");
    const parsed = JSON.parse(stripJsonComments(content)) as unknown;

    if (!validateModelsConfig.Check(parsed)) {
      const errors =
        validateModelsConfig
          .Errors(parsed)
          .map((error) => `  - ${formatValidationPath(error)}: ${error.message}`)
          .join("\n") || "Unknown schema error";
      return emptyCustomModelsResult(`Invalid models.json schema:\n${errors}\n\nFile: ${modelsJsonPath}`);
    }

    const config = parsed as ModelsConfig;

    // Additional validation
    self.validateConfig(config);

    const overrides = new Map<string, ProviderOverride>();
    const modelOverrides = new Map<string, Map<string, ModelOverride>>();

    for (const [providerName, providerConfig] of Object.entries(config.providers)) {
      if (providerConfig.baseUrl || providerConfig.compat) {
        overrides.set(providerName, {
          baseUrl: providerConfig.baseUrl,
          compat: providerConfig.compat,
        });
      }

      self.storeProviderRequestConfig(providerName, providerConfig);

      if (providerConfig.modelOverrides) {
        modelOverrides.set(providerName, new Map(Object.entries(providerConfig.modelOverrides)));
        for (const [modelId, modelOverride] of Object.entries(providerConfig.modelOverrides)) {
          self.storeModelHeaders(providerName, modelId, modelOverride.headers);
        }
      }
    }

    return { models: self.parseModels(config), overrides, modelOverrides, error: undefined };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return emptyCustomModelsResult(`Failed to parse models.json: ${error.message}\n\nFile: ${modelsJsonPath}`);
    }
    return emptyCustomModelsResult(
      `Failed to load models.json: ${error instanceof Error ? error.message : error}\n\nFile: ${modelsJsonPath}`,
    );
  }
}
