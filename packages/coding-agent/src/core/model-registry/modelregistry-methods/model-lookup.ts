import type { Api, Model } from "@dst0/p-ai";
import type { AuthStatus } from "../../auth-storage.ts";
import { BUILT_IN_PROVIDER_DISPLAY_NAMES } from "../../provider-display-names.ts";
import {
  getConfigValueEnvVarNames,
  isCommandConfigValue,
  isConfigValueConfigured,
  resolveConfigValueOrThrow,
  resolveConfigValueUncached,
  resolveHeadersOrThrow,
} from "../../resolve-config-value.ts";
import type { ModelRegistry } from "../modelregistry.ts";
import type { ProviderConfigInput, ResolvedRequestAuth } from "../types.ts";

export async function do_getApiKeyAndHeaders(self: ModelRegistry, model: Model<Api>): Promise<ResolvedRequestAuth> {
  try {
    const providerConfig = self.providerRequestConfigs.get(model.provider);
    const apiKeyFromAuthStorage = await self.authStorage.getApiKey(model.provider, { includeFallback: false });
    const apiKey =
      apiKeyFromAuthStorage ??
      (providerConfig?.apiKey
        ? resolveConfigValueOrThrow(providerConfig.apiKey, `API key for provider "${model.provider}"`)
        : undefined);

    const providerHeaders = resolveHeadersOrThrow(providerConfig?.headers, `provider "${model.provider}"`);
    const modelHeaders = resolveHeadersOrThrow(
      self.modelRequestHeaders.get(self.getModelRequestKey(model.provider, model.id)),
      `model "${model.provider}/${model.id}"`,
    );

    let headers =
      model.headers || providerHeaders || modelHeaders
        ? { ...model.headers, ...providerHeaders, ...modelHeaders }
        : undefined;

    if (providerConfig?.authHeader) {
      if (!apiKey) {
        return { ok: false, error: `No API key found for "${model.provider}"` };
      }
      headers = { ...headers, Authorization: `Bearer ${apiKey}` };
    }

    return {
      ok: true,
      apiKey,
      headers: headers && Object.keys(headers).length > 0 ? headers : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function do_getProviderAuthStatus(self: ModelRegistry, provider: string): AuthStatus {
  const authStatus = self.authStorage.getAuthStatus(provider);
  if (authStatus.source) {
    return authStatus;
  }

  const providerApiKey = self.providerRequestConfigs.get(provider)?.apiKey;
  if (!providerApiKey) {
    return authStatus;
  }

  if (isCommandConfigValue(providerApiKey)) {
    return { configured: true, source: "models_json_command" };
  }

  const envVarNames = getConfigValueEnvVarNames(providerApiKey);
  if (envVarNames.length > 0) {
    return isConfigValueConfigured(providerApiKey)
      ? { configured: true, source: "environment", label: envVarNames.join(", ") }
      : { configured: false };
  }

  return { configured: true, source: "models_json_key" };
}

export function do_getProviderDisplayName(self: ModelRegistry, provider: string): string {
  const registeredProvider = self.registeredProviders.get(provider);
  const oauthProvider = self.authStorage.getOAuthProviders().find((p) => p.id === provider);

  return (
    registeredProvider?.name ??
    registeredProvider?.oauth?.name ??
    oauthProvider?.name ??
    BUILT_IN_PROVIDER_DISPLAY_NAMES[provider] ??
    provider
  );
}

export async function do_getApiKeyForProvider(self: ModelRegistry, provider: string): Promise<string | undefined> {
  const apiKey = await self.authStorage.getApiKey(provider, { includeFallback: false });
  if (apiKey !== undefined) {
    return apiKey;
  }

  const providerApiKey = self.providerRequestConfigs.get(provider)?.apiKey;
  return providerApiKey ? resolveConfigValueUncached(providerApiKey) : undefined;
}

export function do_isUsingOAuth(self: ModelRegistry, model: Model<Api>): boolean {
  const cred = self.authStorage.get(model.provider);
  return cred?.type === "oauth";
}

export function do_registerProvider(self: ModelRegistry, providerName: string, config: ProviderConfigInput): void {
  self.validateProviderConfig(providerName, config);
  self.applyProviderConfig(providerName, config);
  self.upsertRegisteredProvider(providerName, config);
}

export function do_unregisterProvider(self: ModelRegistry, providerName: string): void {
  if (!self.registeredProviders.has(providerName)) return;
  self.registeredProviders.delete(providerName);
  self.refresh();
}

export function do_upsertRegisteredProvider(
  self: ModelRegistry,
  providerName: string,
  config: ProviderConfigInput,
): void {
  const existing = self.registeredProviders.get(providerName);
  if (!existing) {
    self.registeredProviders.set(providerName, config);
    return;
  }
  for (const k of Object.keys(config) as (keyof ProviderConfigInput)[]) {
    if (config[k] !== undefined) {
      (existing as Record<string, unknown>)[k] = config[k];
    }
  }
}

export function do_validateProviderConfig(
  _self: ModelRegistry,
  providerName: string,
  config: ProviderConfigInput,
): void {
  if (config.streamSimple && !config.api) {
    throw new Error(`Provider ${providerName}: "api" is required when registering streamSimple.`);
  }

  if (!config.models || config.models.length === 0) {
    return;
  }

  if (!config.baseUrl) {
    throw new Error(`Provider ${providerName}: "baseUrl" is required when defining models.`);
  }
  if (!config.apiKey && !config.oauth) {
    throw new Error(`Provider ${providerName}: "apiKey" or "oauth" is required when defining models.`);
  }

  for (const modelDef of config.models) {
    const api = modelDef.api || config.api;
    if (!api) {
      throw new Error(`Provider ${providerName}, model ${modelDef.id}: no "api" specified.`);
    }
  }
}
