import { findEnvKeys, getEnvApiKey, type OAuthLoginCallbacks, type OAuthProviderId } from "@dst0/p-ai";
import { getOAuthProvider } from "@dst0/p-ai/oauth";
import { join } from "path";
import { getAgentDir } from "../../../config.ts";
import { AuthStorage } from "../authstorage.ts";
import { FileAuthStorageBackend } from "../fileauthstoragebackend.ts";
import { InMemoryAuthStorageBackend } from "../inmemoryauthstoragebackend.ts";
import type { AuthCredential, AuthStatus, AuthStorageBackend, AuthStorageData } from "../types.ts";

export function do_create(authPath?: string): AuthStorage {
  return new AuthStorage(new FileAuthStorageBackend(authPath ?? join(getAgentDir(), "auth.json")));
}

export function do_fromStorage(storage: AuthStorageBackend): AuthStorage {
  return new AuthStorage(storage);
}

export function do_inMemory(data: AuthStorageData = {}): AuthStorage {
  const storage = new InMemoryAuthStorageBackend();
  storage.withLock(() => ({ result: undefined, next: JSON.stringify(data, null, 2) }));
  return AuthStorage.fromStorage(storage);
}

export function do_setRuntimeApiKey(self: AuthStorage, provider: string, apiKey: string): void {
  self.runtimeOverrides.set(provider, apiKey);
}

export function do_removeRuntimeApiKey(self: AuthStorage, provider: string): void {
  self.runtimeOverrides.delete(provider);
}

export function do_setFallbackResolver(self: AuthStorage, resolver: (provider: string) => string | undefined): void {
  self.fallbackResolver = resolver;
}

export function do_recordError(self: AuthStorage, error: unknown): void {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  self.errors.push(normalizedError);
}

export function do_parseStorageData(_self: AuthStorage, content: string | undefined): AuthStorageData {
  if (!content) {
    return {};
  }
  return JSON.parse(content) as AuthStorageData;
}

export function do_reload(self: AuthStorage): void {
  let content: string | undefined;
  try {
    self.storage.withLock((current) => {
      content = current;
      return { result: undefined };
    });
    self.data = self.parseStorageData(content);
    self.loadError = null;
  } catch (error) {
    self.loadError = error as Error;
    self.recordError(error);
  }
}

export function do_persistProviderChange(
  self: AuthStorage,
  provider: string,
  credential: AuthCredential | undefined,
): void {
  if (self.loadError) {
    return;
  }

  try {
    self.storage.withLock((current) => {
      const currentData = self.parseStorageData(current);
      const merged: AuthStorageData = { ...currentData };
      if (credential) {
        merged[provider] = credential;
      } else {
        delete merged[provider];
      }
      return { result: undefined, next: JSON.stringify(merged, null, 2) };
    });
  } catch (error) {
    self.recordError(error);
  }
}

export function do_get(self: AuthStorage, provider: string): AuthCredential | undefined {
  return self.data[provider] ?? undefined;
}

export function do_set(self: AuthStorage, provider: string, credential: AuthCredential): void {
  self.data[provider] = credential;
  self.persistProviderChange(provider, credential);
}

export function do_remove(self: AuthStorage, provider: string): void {
  delete self.data[provider];
  self.persistProviderChange(provider, undefined);
}

export function do_list(self: AuthStorage): string[] {
  return Object.keys(self.data);
}

export function do_has(self: AuthStorage, provider: string): boolean {
  return provider in self.data;
}

export function do_hasAuth(self: AuthStorage, provider: string): boolean {
  if (self.runtimeOverrides.has(provider)) return true;
  if (self.data[provider]) return true;
  if (getEnvApiKey(provider)) return true;
  if (self.fallbackResolver?.(provider)) return true;
  return false;
}

export function do_getAuthStatus(self: AuthStorage, provider: string): AuthStatus {
  if (self.data[provider]) {
    return { configured: true, source: "stored" };
  }

  if (self.runtimeOverrides.has(provider)) {
    return { configured: false, source: "runtime", label: "--api-key" };
  }

  const envKeys = findEnvKeys(provider);
  if (envKeys?.[0]) {
    return { configured: false, source: "environment", label: envKeys[0] };
  }

  if (self.fallbackResolver?.(provider)) {
    return { configured: false, source: "fallback", label: "custom provider config" };
  }

  return { configured: false };
}

export function do_getAll(self: AuthStorage): AuthStorageData {
  return { ...self.data };
}

export function do_drainErrors(self: AuthStorage): Error[] {
  const drained = [...self.errors];
  self.errors = [];
  return drained;
}

export async function do_login(
  self: AuthStorage,
  providerId: OAuthProviderId,
  callbacks: OAuthLoginCallbacks,
): Promise<void> {
  const provider = getOAuthProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown OAuth provider: ${providerId}`);
  }

  const credentials = await provider.login(callbacks);
  self.set(providerId, { type: "oauth", ...credentials });
}

export function do_logout(self: AuthStorage, provider: string): void {
  self.remove(provider);
}
