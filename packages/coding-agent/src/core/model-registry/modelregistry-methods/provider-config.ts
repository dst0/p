import {
  type Api,
  type Model,
  type OAuthProviderInterface,
  registerApiProvider,
  type SimpleStreamOptions,
} from "@dst0/p-ai";
import { registerOAuthProvider } from "@dst0/p-ai/oauth";
import { createModelFromDefinition, mergeCompat } from "../helpers.ts";
import type { ModelRegistry } from "../modelregistry.ts";
import type { ProviderConfigInput } from "../types.ts";

export function do_applyProviderConfig(self: ModelRegistry, providerName: string, config: ProviderConfigInput): void {
  // Register OAuth provider if provided
  if (config.oauth) {
    // Ensure the OAuth provider ID matches the provider name
    const oauthProvider: OAuthProviderInterface = {
      ...config.oauth,
      id: providerName,
    };
    registerOAuthProvider(oauthProvider);
  }

  if (config.streamSimple) {
    const streamSimple = config.streamSimple;
    registerApiProvider(
      {
        api: config.api!,
        stream: (model, context, options) => streamSimple(model, context, options as SimpleStreamOptions),
        streamSimple,
      },
      `provider:${providerName}`,
    );
  }

  self.storeProviderRequestConfig(providerName, config);

  if (config.models !== undefined) {
    const inheritedModels =
      config.modelMetadata === "inherit-existing"
        ? new Map(
            self.configuredModels
              .filter((model) => model.provider === providerName)
              .map((model) => [model.id, model] as const),
          )
        : new Map<string, Model<Api>>();

    // Full replacement: remove existing models for this provider
    self.models = self.models.filter((m) => m.provider !== providerName);

    // Parse and add new models
    for (const modelDef of config.models) {
      const api = modelDef.api || config.api;
      const existingModel = inheritedModels.get(modelDef.id);
      const inheritedModel = existingModel?.api === api ? existingModel : undefined;
      const thinkingLevelMap = mergeThinkingLevelMap(inheritedModel?.thinkingLevelMap, modelDef.thinkingLevelMap);
      const compat = mergeCompat(mergeCompat(inheritedModel?.compat, config.compat), modelDef.compat);
      self.storeModelHeaders(providerName, modelDef.id, modelDef.headers);

      self.models.push(
        createModelFromDefinition(
          providerName,
          {
            ...modelDef,
            reasoning: modelDef.reasoning ?? inheritedModel?.reasoning,
            thinkingLevelMap,
          },
          api as Api,
          modelDef.baseUrl ?? config.baseUrl!,
          compat,
        ),
      );
    }

    // Apply OAuth modifyModels if credentials exist (e.g., to update baseUrl)
    if (config.oauth?.modifyModels) {
      const cred = self.authStorage.get(providerName);
      if (cred?.type === "oauth") {
        self.models = config.oauth.modifyModels(self.models, cred);
      }
    }
  } else if (config.baseUrl || config.headers || config.compat) {
    // Override-only: update baseUrl for existing models. Request headers are resolved per request.
    self.models = self.models.map((m) => {
      if (m.provider !== providerName) return m;
      return {
        ...m,
        baseUrl: config.baseUrl ?? m.baseUrl,
        compat: mergeCompat(m.compat, config.compat),
      };
    });
  }
}

function mergeThinkingLevelMap(
  existing: Model<Api>["thinkingLevelMap"],
  replacement: Model<Api>["thinkingLevelMap"],
): Model<Api>["thinkingLevelMap"] {
  if (!existing) return replacement;
  if (!replacement) return existing;
  return { ...existing, ...replacement };
}
