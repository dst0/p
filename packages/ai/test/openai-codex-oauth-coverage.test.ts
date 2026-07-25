import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loginOpenAICodex,
  loginOpenAICodexDeviceCode,
  openaiCodexOAuthProvider,
  refreshOpenAICodexToken,
} from "../src/utils/oauth/openai-codex.ts";

function createJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenAI Codex OAuth comprehensive coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const validJwt = createJwt({
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acc_12345",
    },
  });

  it("decodes JWT and extracts accountId in loginOpenAICodexDeviceCode", async () => {
    const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
      const url = String(input);

      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse({
          device_auth_id: "device-auth-1",
          user_code: "CODEX-123",
          interval: 1,
        });
      }

      if (url.endsWith("/deviceauth/token")) {
        return jsonResponse({
          authorization_code: "auth-code-789",
          code_verifier: "verifier-xyz",
        });
      }

      if (url.endsWith("/oauth/token")) {
        return jsonResponse({
          access_token: validJwt,
          refresh_token: "refresh-codex-123",
          expires_in: 3600,
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const onDeviceCode = vi.fn();
    const credentials = await loginOpenAICodexDeviceCode({
      onDeviceCode,
    });

    expect(onDeviceCode).toHaveBeenCalledWith({
      userCode: "CODEX-123",
      verificationUri: "https://auth.openai.com/codex/device",
      intervalSeconds: 1,
      expiresInSeconds: 900,
    });
    expect(credentials.access).toBe(validJwt);
    expect(credentials.refresh).toBe("refresh-codex-123");
    expect(credentials.accountId).toBe("acc_12345");
  });

  it("handles loginOpenAICodex with manual code input", async () => {
    let authUrl = "";
    const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({
          access_token: validJwt,
          refresh_token: "refresh-manual",
          expires_in: 3600,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const credentials = await loginOpenAICodex({
      onAuth: (info) => {
        authUrl = info.url;
      },
      onPrompt: async () => "",
      onManualCodeInput: async () => {
        const url = new URL(authUrl);
        const state = url.searchParams.get("state");
        return `http://localhost:1455/auth/callback?code=manual-codex-code&state=${state}`;
      },
    });

    expect(credentials.accountId).toBe("acc_12345");
    expect(credentials.refresh).toBe("refresh-manual");
  });

  it("refreshes OpenAI Codex token", async () => {
    const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({
          access_token: validJwt,
          refresh_token: "new-refresh-token",
          expires_in: 3600,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const credentials = await refreshOpenAICodexToken("old-refresh-token");
    expect(credentials.access).toBe(validJwt);
    expect(credentials.refresh).toBe("new-refresh-token");
    expect(credentials.accountId).toBe("acc_12345");
  });

  it("handles provider interface methods login, refreshToken, and getApiKey", async () => {
    const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
      const url = String(input);
      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse({
          device_auth_id: "device-1",
          user_code: "U-123",
          interval: 1,
        });
      }
      if (url.endsWith("/deviceauth/token")) {
        return jsonResponse({
          authorization_code: "code-1",
          code_verifier: "verifier-1",
        });
      }
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({
          access_token: validJwt,
          refresh_token: "ref-1",
          expires_in: 3600,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSelect = vi.fn().mockResolvedValue("device_code");
    const onDeviceCode = vi.fn();

    const creds = await openaiCodexOAuthProvider.login({
      onSelect,
      onDeviceCode,
      onAuth: () => {},
      onPrompt: async () => "",
    });

    expect(creds.accountId).toBe("acc_12345");
    expect(openaiCodexOAuthProvider.getApiKey(creds)).toBe(validJwt);

    const refreshed = await openaiCodexOAuthProvider.refreshToken(creds);
    expect(refreshed.access).toBe(validJwt);
  });

  it("handles device auth error statuses and invalid response JSON", async () => {
    const fetchMock = vi.fn(async (_input: unknown): Promise<Response> => {
      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loginOpenAICodexDeviceCode({ onDeviceCode: () => {} })).rejects.toThrow(
      "OpenAI Codex device code login is not enabled for this server",
    );
  });
});
