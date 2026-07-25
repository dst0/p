import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import type { OAuthCredentials, OAuthProviderInterface } from "../src/utils/oauth/types.ts";

describe("OAuth provider registry comprehensive coverage", () => {
  beforeEach(() => {
    resetOAuthProviders();
  });

  afterEach(() => {
    resetOAuthProviders();
  });

  const dummyProvider: OAuthProviderInterface = {
    id: "custom-oauth" as any,
    name: "Custom OAuth",
    async login() {
      return { access: "acc", refresh: "ref", expires: Date.now() + 3600000 };
    },
    async refreshToken(creds: OAuthCredentials) {
      return { access: "new-acc", refresh: creds.refresh, expires: Date.now() + 3600000 };
    },
    getApiKey(creds: OAuthCredentials) {
      return creds.access;
    },
  };

  it("registers, lists, retrieves, unregisters, and resets OAuth providers", () => {
    registerOAuthProvider(dummyProvider);
    expect(getOAuthProvider("custom-oauth" as any)).toBe(dummyProvider);

    const providers = getOAuthProviders();
    expect(providers.some((p) => p.id === "custom-oauth")).toBe(true);

    const infoList = getOAuthProviderInfoList();
    expect(infoList.some((p) => p.id === "custom-oauth" && p.name === "Custom OAuth")).toBe(true);

    unregisterOAuthProvider("custom-oauth");
    expect(getOAuthProvider("custom-oauth" as any)).toBeUndefined();

    // Built-in unregistering restores original
    unregisterOAuthProvider("anthropic");
    expect(getOAuthProvider("anthropic")).toBeDefined();

    resetOAuthProviders();
    expect(getOAuthProviders().length).toBeGreaterThan(0);
  });

  it("refreshOAuthToken delegates to registered provider or throws", async () => {
    registerOAuthProvider(dummyProvider);
    const creds: OAuthCredentials = { access: "a", refresh: "r", expires: Date.now() };

    const refreshed = await refreshOAuthToken("custom-oauth" as any, creds);
    expect(refreshed.access).toBe("new-acc");

    await expect(refreshOAuthToken("unknown-provider" as any, creds)).rejects.toThrow(
      "Unknown OAuth provider: unknown-provider",
    );
  });

  it("getOAuthApiKey returns null if no credentials found", async () => {
    const res = await getOAuthApiKey("anthropic", {});
    expect(res).toBeNull();
  });

  it("getOAuthApiKey throws error for unknown provider", async () => {
    await expect(getOAuthApiKey("unknown-provider" as any, {})).rejects.toThrow(
      "Unknown OAuth provider: unknown-provider",
    );
  });

  it("getOAuthApiKey returns valid key and refreshes expired tokens", async () => {
    registerOAuthProvider(dummyProvider);

    // Valid non-expired token
    const validCreds: OAuthCredentials = { access: "valid-key", refresh: "r1", expires: Date.now() + 100000 };
    const validRes = await getOAuthApiKey("custom-oauth" as any, { "custom-oauth": validCreds });
    expect(validRes?.apiKey).toBe("valid-key");

    // Expired token
    const expiredCreds: OAuthCredentials = { access: "old-key", refresh: "r2", expires: Date.now() - 1000 };
    const expiredRes = await getOAuthApiKey("custom-oauth" as any, { "custom-oauth": expiredCreds });
    expect(expiredRes?.apiKey).toBe("new-acc");

    // Refresh failure
    const failingProvider: OAuthProviderInterface = {
      ...dummyProvider,
      id: "failing-oauth" as any,
      async refreshToken() {
        throw new Error("Network error during refresh");
      },
    };
    registerOAuthProvider(failingProvider);

    await expect(
      getOAuthApiKey("failing-oauth" as any, {
        "failing-oauth": { access: "old", refresh: "ref", expires: Date.now() - 100 },
      }),
    ).rejects.toThrow("Failed to refresh OAuth token for failing-oauth");
  });
});
