import { oauthErrorHtml, oauthSuccessHtml } from "../oauth-page.ts";
import type { OAuthCredentials, OAuthDeviceCodeInfo } from "../types.ts";
import {
  _http,
  DEVICE_CODE_TIMEOUT_SECONDS,
  DEVICE_REDIRECT_URI,
  DEVICE_VERIFICATION_URI,
  JWT_CLAIM_PATH,
} from "./constants.ts";
import { decodeJwt, exchangeAuthorizationCode, getCallbackHost } from "./helpers-part1.ts";
import { pollOpenAICodexDeviceAuth, startOpenAICodexDeviceAuth } from "./helpers-part2.ts";
import type { OAuthServerInfo, OAuthToken } from "./types.ts";

export function startLocalOAuthServer(state: string): Promise<OAuthServerInfo> {
  if (!_http) {
    throw new Error("OpenAI Codex OAuth is only available in Node.js environments");
  }

  let settleWait: ((value: { code: string } | null) => void) | undefined;
  const waitForCodePromise = new Promise<{ code: string } | null>((resolve) => {
    let settled = false;
    settleWait = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
  });

  const server = _http.createServer((req, res) => {
    try {
      const url = new URL(req.url || "", "http://localhost");
      if (url.pathname !== "/auth/callback") {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(oauthErrorHtml("Callback route not found."));
        return;
      }
      if (url.searchParams.get("state") !== state) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(oauthErrorHtml("State mismatch."));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(oauthErrorHtml("Missing authorization code."));
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(oauthSuccessHtml("OpenAI authentication completed. You can close this window."));
      settleWait?.({ code });
    } catch {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(oauthErrorHtml("Internal error while processing OAuth callback."));
    }
  });

  return new Promise((resolve) => {
    server
      .listen(1455, getCallbackHost(), () => {
        resolve({
          close: () => server.close(),
          cancelWait: () => {
            settleWait?.(null);
          },
          waitForCode: () => waitForCodePromise,
        });
      })
      .on("error", (_err: NodeJS.ErrnoException) => {
        settleWait?.(null);
        resolve({
          close: () => {
            try {
              server.close();
            } catch {
              // ignore
            }
          },
          cancelWait: () => {},
          waitForCode: async () => null,
        });
      });
  });
}

export function getAccountId(accessToken: string): string | null {
  const payload = decodeJwt(accessToken);
  const auth = payload?.[JWT_CLAIM_PATH];
  const accountId = auth?.chatgpt_account_id;
  return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
}

export function credentialsFromToken(token: OAuthToken): OAuthCredentials {
  const accountId = getAccountId(token.access);
  if (!accountId) {
    throw new Error("Failed to extract accountId from token");
  }

  return {
    access: token.access,
    refresh: token.refresh,
    expires: token.expires,
    accountId,
  };
}

export async function exchangeAuthorizationCodeForCredentials(
  code: string,
  verifier: string,
  redirectUri: string,
  signal?: AbortSignal,
): Promise<OAuthCredentials> {
  return credentialsFromToken(await exchangeAuthorizationCode(code, verifier, redirectUri, signal));
}

export async function loginOpenAICodexDeviceCode(options: {
  onDeviceCode: (info: OAuthDeviceCodeInfo) => void;
  signal?: AbortSignal;
}): Promise<OAuthCredentials> {
  const device = await startOpenAICodexDeviceAuth(options.signal);
  options.onDeviceCode({
    userCode: device.userCode,
    verificationUri: DEVICE_VERIFICATION_URI,
    intervalSeconds: device.intervalSeconds,
    expiresInSeconds: DEVICE_CODE_TIMEOUT_SECONDS,
  });
  const code = await pollOpenAICodexDeviceAuth(device, options.signal);
  return exchangeAuthorizationCodeForCredentials(
    code.authorizationCode,
    code.codeVerifier,
    DEVICE_REDIRECT_URI,
    options.signal,
  );
}
