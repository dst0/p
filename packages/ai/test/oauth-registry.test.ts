import { describe, expect, it } from "vitest";
import {
  getOAuthApiKey,
  getOAuthProvider,
  getOAuthProviderInfoList,
  getOAuthProviders,
  refreshOAuthToken,
  registerOAuthProvider,
  resetOAuthProviders,
  unregisterOAuthProvider,
} from "../src/utils/oauth/index.ts";
import type { OAuthProviderInterface } from "../src/utils/oauth/types.ts";

describe("oauth-registry", () => {
  const dummyProvider: OAuthProviderInterface = {
    id: "custom-oauth" as any,
    name: "Custom OAuth",
    login: async () => ({ access: "a1", refresh: "r1", expires: Date.now() + 1000 }),
    refreshToken: async (creds) => ({ ...creds, access: `${creds.access}-refreshed`, expires: Date.now() + 5000 }),
    getApiKey: (creds) => `key-${creds.access}`,
  };

  it("manages OAuth provider registration and lifecycle", async () => {
    registerOAuthProvider(dummyProvider);
    expect(getOAuthProvider("custom-oauth" as any)).toBe(dummyProvider);

    const providers = getOAuthProviders();
    expect(providers.some((p) => p.id === "custom-oauth")).toBe(true);

    const infoList = getOAuthProviderInfoList();
    expect(infoList.some((info) => info.id === "custom-oauth")).toBe(true);

    // Unregister custom provider
    unregisterOAuthProvider("custom-oauth");
    expect(getOAuthProvider("custom-oauth" as any)).toBeUndefined();

    // Reset providers
    registerOAuthProvider(dummyProvider);
    resetOAuthProviders();
    expect(getOAuthProvider("custom-oauth" as any)).toBeUndefined();
  });

  it("unregisters built-in provider by restoring built-in implementation", () => {
    const origAnthropic = getOAuthProvider("anthropic" as any);
    expect(origAnthropic).toBeDefined();

    registerOAuthProvider({ ...dummyProvider, id: "anthropic" as any });
    expect(getOAuthProvider("anthropic" as any)?.name).toBe("Custom OAuth");

    unregisterOAuthProvider("anthropic");
    expect(getOAuthProvider("anthropic" as any)?.name).toBe(origAnthropic?.name);
  });

  it("refreshes token via high-level refreshOAuthToken", async () => {
    registerOAuthProvider(dummyProvider);
    const refreshed = await refreshOAuthToken("custom-oauth" as any, { access: "abc", refresh: "ref", expires: 123 });
    expect(refreshed.access).toBe("abc-refreshed");

    await expect(
      refreshOAuthToken("unknown-provider" as any, { access: "x", refresh: "r", expires: 0 }),
    ).rejects.toThrow("Unknown OAuth provider: unknown-provider");
    unregisterOAuthProvider("custom-oauth");
  });

  it("handles getOAuthApiKey for missing, valid, and expired credentials", async () => {
    registerOAuthProvider(dummyProvider);

    // Missing provider
    await expect(getOAuthApiKey("unknown-provider" as any, {})).rejects.toThrow(
      "Unknown OAuth provider: unknown-provider",
    );

    // No credentials for providerId
    const res1 = await getOAuthApiKey("custom-oauth" as any, {});
    expect(res1).toBeNull();

    // Valid credentials (not expired)
    const validCreds = { access: "valid", refresh: "ref", expires: Date.now() + 100000 };
    const res2 = await getOAuthApiKey("custom-oauth" as any, { "custom-oauth": validCreds });
    expect(res2?.apiKey).toBe("key-valid");
    expect(res2?.newCredentials).toBe(validCreds);

    // Expired credentials
    const expiredCreds = { access: "expired", refresh: "ref", expires: Date.now() - 1000 };
    const res3 = await getOAuthApiKey("custom-oauth" as any, { "custom-oauth": expiredCreds });
    expect(res3?.apiKey).toBe("key-expired-refreshed");
    expect(res3?.newCredentials.access).toBe("expired-refreshed");

    // Refresh failure error handling
    const failingProvider: OAuthProviderInterface = {
      ...dummyProvider,
      id: "failing-oauth" as any,
      refreshToken: async () => {
        throw new Error("Network error");
      },
    };
    registerOAuthProvider(failingProvider);

    await expect(getOAuthApiKey("failing-oauth" as any, { "failing-oauth": expiredCreds })).rejects.toThrow(
      "Failed to refresh OAuth token for failing-oauth",
    );

    unregisterOAuthProvider("custom-oauth");
    unregisterOAuthProvider("failing-oauth");
  });
});
