import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderId } from "@dst0/p-ai";
import {
  do_create,
  do_drainErrors,
  do_fromStorage,
  do_get,
  do_getAll,
  do_getAuthStatus,
  do_has,
  do_hasAuth,
  do_inMemory,
  do_list,
  do_login,
  do_logout,
  do_parseStorageData,
  do_persistProviderChange,
  do_recordError,
  do_reload,
  do_remove,
  do_removeRuntimeApiKey,
  do_set,
  do_setFallbackResolver,
  do_setRuntimeApiKey,
} from "./authstorage-methods/credential-storage.ts";
import {
  do_getApiKey,
  do_getOAuthProviders,
  do_refreshOAuthTokenWithLock,
} from "./authstorage-methods/provider-auth.ts";
import type { AuthCredential, AuthStatus, AuthStorageBackend, AuthStorageData } from "./types.ts";

export class AuthStorage {
  public data: AuthStorageData = {};

  public runtimeOverrides: Map<string, string> = new Map();

  public fallbackResolver?: (provider: string) => string | undefined;

  public loadError: Error | null = null;

  public errors: Error[] = [];

  public storage: AuthStorageBackend;

  public constructor(storage: AuthStorageBackend) {
    this.storage = storage;
    this.reload();
  }

  static create(authPath?: string): AuthStorage {
    return do_create(authPath);
  }

  static fromStorage(storage: AuthStorageBackend): AuthStorage {
    return do_fromStorage(storage);
  }

  static inMemory(data: AuthStorageData = {}): AuthStorage {
    return do_inMemory(data);
  }

  setRuntimeApiKey(provider: string, apiKey: string): void {
    do_setRuntimeApiKey(this, provider, apiKey);
  }

  removeRuntimeApiKey(provider: string): void {
    do_removeRuntimeApiKey(this, provider);
  }

  setFallbackResolver(resolver: (provider: string) => string | undefined): void {
    do_setFallbackResolver(this, resolver);
  }

  recordError(error: unknown): void {
    do_recordError(this, error);
  }

  parseStorageData(content: string | undefined): AuthStorageData {
    return do_parseStorageData(this, content);
  }

  reload(): void {
    do_reload(this);
  }

  persistProviderChange(provider: string, credential: AuthCredential | undefined): void {
    do_persistProviderChange(this, provider, credential);
  }

  get(provider: string): AuthCredential | undefined {
    return do_get(this, provider);
  }

  set(provider: string, credential: AuthCredential): void {
    do_set(this, provider, credential);
  }

  remove(provider: string): void {
    do_remove(this, provider);
  }

  list(): string[] {
    return do_list(this);
  }

  has(provider: string): boolean {
    return do_has(this, provider);
  }

  hasAuth(provider: string): boolean {
    return do_hasAuth(this, provider);
  }

  getAuthStatus(provider: string): AuthStatus {
    return do_getAuthStatus(this, provider);
  }

  getAll(): AuthStorageData {
    return do_getAll(this);
  }

  drainErrors(): Error[] {
    return do_drainErrors(this);
  }

  async login(providerId: OAuthProviderId, callbacks: OAuthLoginCallbacks): Promise<void> {
    return do_login(this, providerId, callbacks);
  }

  logout(provider: string): void {
    do_logout(this, provider);
  }

  async refreshOAuthTokenWithLock(
    providerId: OAuthProviderId,
  ): Promise<{ apiKey: string; newCredentials: OAuthCredentials } | null> {
    return do_refreshOAuthTokenWithLock(this, providerId);
  }

  async getApiKey(providerId: string, options?: { includeFallback?: boolean }): Promise<string | undefined> {
    return do_getApiKey(this, providerId, options);
  }

  getOAuthProviders() {
    return do_getOAuthProviders(this);
  }
}
