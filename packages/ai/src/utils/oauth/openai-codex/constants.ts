import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "../types.ts";
import { loginOpenAICodexDeviceCode } from "./helpers-part3.ts";
import { loginOpenAICodex, refreshOpenAICodexToken } from "./helpers-part4.ts";

export const _randomBytes: typeof import("node:crypto").randomBytes | null = null;

export const _http: typeof import("node:http") | null = null;

export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

export const AUTH_BASE_URL = "https://auth.openai.com";

export const AUTHORIZE_URL = `${AUTH_BASE_URL}/oauth/authorize`;

export const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;

export const REDIRECT_URI = "http://localhost:1455/auth/callback";

export const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;

export const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;

export const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;

export const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;

export const DEVICE_CODE_TIMEOUT_SECONDS = 15 * 60;

export const OPENAI_CODEX_BROWSER_LOGIN_METHOD = "browser";

export const OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD = "device_code";

export const SCOPE = "openid profile email offline_access";

export const JWT_CLAIM_PATH = "https://api.openai.com/auth";

export const openaiCodexOAuthProvider: OAuthProviderInterface = {
  id: "openai-codex",
  name: "ChatGPT Plus/Pro (Codex Subscription)",
  usesCallbackServer: true,

  async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    const loginMethod = await callbacks.onSelect({
      message: "Select OpenAI Codex login method:",
      options: [
        { id: OPENAI_CODEX_BROWSER_LOGIN_METHOD, label: "Browser login (default)" },
        { id: OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD, label: "Device code login (headless)" },
      ],
    });
    if (!loginMethod) {
      throw new Error("Login cancelled");
    }

    if (loginMethod === OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD) {
      return loginOpenAICodexDeviceCode({
        onDeviceCode: callbacks.onDeviceCode,
        signal: callbacks.signal,
      });
    }

    if (loginMethod !== OPENAI_CODEX_BROWSER_LOGIN_METHOD) {
      throw new Error(`Unknown OpenAI Codex login method: ${loginMethod}`);
    }

    return loginOpenAICodex({
      onAuth: callbacks.onAuth,
      onPrompt: callbacks.onPrompt,
      onProgress: callbacks.onProgress,
      onManualCodeInput: callbacks.onManualCodeInput,
    });
  },

  async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    return refreshOpenAICodexToken(credentials.refresh);
  },

  getApiKey(credentials: OAuthCredentials): string {
    return credentials.access;
  },
};
