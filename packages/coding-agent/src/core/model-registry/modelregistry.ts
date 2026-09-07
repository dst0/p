import type { Api, Model } from "@dst0/p-ai";
import { join } from "path";
import { getAgentDir } from "../../config.ts";
import { normalizePath } from "../../utils/paths.ts";
import type { AuthStatus, AuthStorage } from "../auth-storage.ts";
import {
  do_getApiKeyAndHeaders,
  do_getApiKeyForProvider,
  do_getProviderAuthStatus,
  do_getProviderDisplayName,
  do_isUsingOAuth,
  do_registerProvider,
  do_unregisterProvider,
  do_upsertRegisteredProvider,
  do_validateProviderConfig,
} from "./modelregistry-methods/model-lookup.ts";
import {
  do_create,
  do_getError,
  do_inMemory,
  do_loadBuiltInModels,
  do_loadCustomModels,
  do_loadModels,
  do_mergeCustomModels,
  do_refresh,
} from "./modelregistry-methods/model-management.ts";
import { do_applyProviderConfig } from "./modelregistry-methods/provider-config.ts";
import {
  do_find,
  do_getAll,
  do_getAvailable,
  do_getModelRequestKey,
  do_hasConfiguredAuth,
  do_parseModels,
  do_storeModelHeaders,
  do_storeProviderRequestConfig,
  do_validateConfig,
} from "./modelregistry-methods/provider-resolution.ts";
import type {
  CustomModelsResult,
  ModelOverride,
  ModelsConfig,
  ProviderConfigInput,
  ProviderOverride,
  ProviderRequestConfig,
  ResolvedRequestAuth,
} from "./types.ts";

export class ModelRegistry {
  public models: Model<Api>[] = [];
  public configuredModels: Model<Api>[] = [];

  public providerRequestConfigs: Map<string, ProviderRequestConfig> = new Map();

  public modelRequestHeaders: Map<string, Record<string, string>> = new Map();

  public registeredProviders: Map<string, ProviderConfigInput> = new Map();

  public loadError: string | undefined = undefined;

  readonly authStorage: AuthStorage;

  public modelsJsonPath: string | undefined;

  public onlyLocalModels: boolean;

  public constructor(authStorage: AuthStorage, modelsJsonPath: string | undefined, onlyLocalModels = false) {
    this.authStorage = authStorage;
    this.modelsJsonPath = modelsJsonPath ? normalizePath(modelsJsonPath) : undefined;
    this.onlyLocalModels = onlyLocalModels;
    this.loadModels();
  }

  static create(authStorage: AuthStorage, modelsJsonPath: string = join(getAgentDir(), "models.json")): ModelRegistry {
    return do_create(authStorage, modelsJsonPath);
  }

  static inMemory(authStorage: AuthStorage): ModelRegistry {
    return do_inMemory(authStorage);
  }

  refresh(): void {
    do_refresh(this);
  }

  getError(): string | undefined {
    return do_getError(this);
  }

  loadModels(): void {
    do_loadModels(this);
  }

  loadBuiltInModels(
    overrides: Map<string, ProviderOverride>,
    modelOverrides: Map<string, Map<string, ModelOverride>>,
  ): Model<Api>[] {
    return do_loadBuiltInModels(this, overrides, modelOverrides);
  }

  mergeCustomModels(builtInModels: Model<Api>[], customModels: Model<Api>[]): Model<Api>[] {
    return do_mergeCustomModels(this, builtInModels, customModels);
  }

  loadCustomModels(modelsJsonPath: string): CustomModelsResult {
    return do_loadCustomModels(this, modelsJsonPath);
  }

  validateConfig(config: ModelsConfig): void {
    do_validateConfig(this, config);
  }

  parseModels(config: ModelsConfig): Model<Api>[] {
    return do_parseModels(this, config);
  }

  getAll(): Model<Api>[] {
    return do_getAll(this);
  }

  getAvailable(): Model<Api>[] {
    return do_getAvailable(this);
  }

  find(provider: string, modelId: string): Model<Api> | undefined {
    return do_find(this, provider, modelId);
  }

  hasConfiguredAuth(model: Model<Api>): boolean {
    return do_hasConfiguredAuth(this, model);
  }

  getModelRequestKey(provider: string, modelId: string): string {
    return do_getModelRequestKey(this, provider, modelId);
  }

  storeProviderRequestConfig(
    providerName: string,
    config: {
      apiKey?: string;
      headers?: Record<string, string>;
      authHeader?: boolean;
    },
  ): void {
    do_storeProviderRequestConfig(this, providerName, config);
  }

  storeModelHeaders(providerName: string, modelId: string, headers?: Record<string, string>): void {
    do_storeModelHeaders(this, providerName, modelId, headers);
  }

  async getApiKeyAndHeaders(model: Model<Api>): Promise<ResolvedRequestAuth> {
    return do_getApiKeyAndHeaders(this, model);
  }

  getProviderAuthStatus(provider: string): AuthStatus {
    return do_getProviderAuthStatus(this, provider);
  }

  getProviderDisplayName(provider: string): string {
    return do_getProviderDisplayName(this, provider);
  }

  async getApiKeyForProvider(provider: string): Promise<string | undefined> {
    return do_getApiKeyForProvider(this, provider);
  }

  isUsingOAuth(model: Model<Api>): boolean {
    return do_isUsingOAuth(this, model);
  }

  registerProvider(providerName: string, config: ProviderConfigInput): void {
    do_registerProvider(this, providerName, config);
  }

  unregisterProvider(providerName: string): void {
    do_unregisterProvider(this, providerName);
  }

  upsertRegisteredProvider(providerName: string, config: ProviderConfigInput): void {
    do_upsertRegisteredProvider(this, providerName, config);
  }

  validateProviderConfig(providerName: string, config: ProviderConfigInput): void {
    do_validateProviderConfig(this, providerName, config);
  }

  applyProviderConfig(providerName: string, config: ProviderConfigInput): void {
    do_applyProviderConfig(this, providerName, config);
  }
}
