import { getEnvApiKey, type OAuthCredentials, type OAuthProviderId } from "@dst0/p-ai";
import { getOAuthApiKey, getOAuthProvider, getOAuthProviders } from "@dst0/p-ai/oauth";
import { resolveConfigValue } from "../../resolve-config-value.ts";
import type { AuthStorage } from "../authstorage.ts";
import type { AuthStorageData } from "../types.ts";

export async function do_refreshOAuthTokenWithLock(
  self: AuthStorage,
  providerId: OAuthProviderId,
): Promise<{ apiKey: string; newCredentials: OAuthCredentials } | null> {
  const provider = getOAuthProvider(providerId);
  if (!provider) {
    return null;
  }

  const result = await self.storage.withLockAsync(async (current) => {
    const currentData = self.parseStorageData(current);
    self.data = currentData;
    self.loadError = null;

    const cred = currentData[providerId];
    if (cred?.type !== "oauth") {
      return { result: null };
    }

    if (Date.now() < cred.expires) {
      return { result: { apiKey: provider.getApiKey(cred), newCredentials: cred } };
    }

    const oauthCreds: Record<string, OAuthCredentials> = {};
    for (const [key, value] of Object.entries(currentData)) {
      if (value.type === "oauth") {
        oauthCreds[key] = value;
      }
    }

    const refreshed = await getOAuthApiKey(providerId, oauthCreds);
    if (!refreshed) {
      return { result: null };
    }

    const merged: AuthStorageData = {
      ...currentData,
      [providerId]: { type: "oauth", ...refreshed.newCredentials },
    };
    self.data = merged;
    self.loadError = null;
    return { result: refreshed, next: JSON.stringify(merged, null, 2) };
  });

  return result;
}

export async function do_getApiKey(
  self: AuthStorage,
  providerId: string,
  options?: { includeFallback?: boolean },
): Promise<string | undefined> {
  // Runtime override takes highest priority
  const runtimeKey = self.runtimeOverrides.get(providerId);
  if (runtimeKey) {
    return runtimeKey;
  }

  const cred = self.data[providerId];

  if (cred?.type === "api_key") {
    return resolveConfigValue(cred.key);
  }

  if (cred?.type === "oauth") {
    const provider = getOAuthProvider(providerId);
    if (!provider) {
      // Unknown OAuth provider, can't get API key
      return undefined;
    }

    // Check if token needs refresh
    const needsRefresh = Date.now() >= cred.expires;

    if (needsRefresh) {
      // Use locked refresh to prevent race conditions
      try {
        const result = await self.refreshOAuthTokenWithLock(providerId);
        if (result) {
          return result.apiKey;
        }
      } catch (error) {
        self.recordError(error);
        // Refresh failed - re-read file to check if another instance succeeded
        self.reload();
        const updatedCred = self.data[providerId];

        if (updatedCred?.type === "oauth" && Date.now() < updatedCred.expires) {
          // Another instance refreshed successfully, use those credentials
          return provider.getApiKey(updatedCred);
        }

        // Refresh truly failed - return undefined so model discovery skips this provider
        // User can /login to re-authenticate (credentials preserved for retry)
        return undefined;
      }
    } else {
      // Token not expired, use current access token
      return provider.getApiKey(cred);
    }
  }

  // Fall back to environment variable
  const envKey = getEnvApiKey(providerId);
  if (envKey) return envKey;

  // Fall back to custom resolver (e.g., models.json custom providers)
  if (options?.includeFallback !== false) {
    return self.fallbackResolver?.(providerId) ?? undefined;
  }

  return undefined;
}

export function do_getOAuthProviders(_self: AuthStorage) {
  return getOAuthProviders();
}
