import { describe, expect, it, vi } from "vitest";
import { openaiCodexOAuthProvider, refreshOpenAICodexToken } from "../src/utils/oauth/openai-codex.ts";

function createFakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe("openai-codex-oauth-unit", () => {
  it("getApiKey returns access token from credentials", () => {
    const creds = {
      access: "access-token-xyz",
      refresh: "refresh-token-xyz",
      expires: Date.now() + 10000,
    };
    expect(openaiCodexOAuthProvider.getApiKey(creds)).toBe("access-token-xyz");
  });

  it("refreshes token with mock fetch and parses accountId from JWT", async () => {
    const validJwt = createFakeJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_12345",
      },
    });

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: validJwt,
          refresh_token: "new-refresh-token",
          expires_in: 3600,
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const newCreds = await refreshOpenAICodexToken("old-refresh-token");
    expect(newCreds.access).toBe(validJwt);
    expect(newCreds.refresh).toBe("new-refresh-token");
    expect(newCreds.accountId).toBe("acct_12345");

    vi.unstubAllGlobals();
  });

  it("throws when token response is missing accountId in JWT", async () => {
    const invalidJwt = createFakeJwt({});

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: invalidJwt,
          refresh_token: "new-refresh-token",
          expires_in: 3600,
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshOpenAICodexToken("old-refresh-token")).rejects.toThrow(
      "Failed to extract accountId from token",
    );

    vi.unstubAllGlobals();
  });

  it("handles provider login method selection cancelling", async () => {
    const onSelect = vi.fn(async () => undefined);

    await expect(
      openaiCodexOAuthProvider.login({
        onSelect,
        onAuth: () => {},
        onPrompt: async () => "",
        onDeviceCode: () => {},
      }),
    ).rejects.toThrow("Login cancelled");
  });
});
