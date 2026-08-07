import type { OAuthCredentials, OAuthPrompt } from "../types.ts";
import { REDIRECT_URI } from "./constants.ts";
import { parseAuthorizationInput, refreshAccessToken } from "./helpers-part1.ts";
import { createAuthorizationFlow } from "./helpers-part2.ts";
import {
  credentialsFromToken,
  exchangeAuthorizationCodeForCredentials,
  startLocalOAuthServer,
} from "./helpers-part3.ts";

export async function loginOpenAICodex(options: {
  onAuth: (info: { url: string; instructions?: string }) => void;
  onPrompt: (prompt: OAuthPrompt) => Promise<string>;
  onProgress?: (message: string) => void;
  onManualCodeInput?: () => Promise<string>;
  originator?: string;
}): Promise<OAuthCredentials> {
  const { verifier, state, url } = await createAuthorizationFlow(options.originator);
  const server = await startLocalOAuthServer(state);

  options.onAuth({ url, instructions: "A browser window should open. Complete login to finish." });

  let code: string | undefined;
  try {
    if (options.onManualCodeInput) {
      // Race between browser callback and manual input
      let manualCode: string | undefined;
      let manualError: Error | undefined;
      const manualPromise = options
        .onManualCodeInput()
        .then((input) => {
          manualCode = input;
          server.cancelWait();
        })
        .catch((err) => {
          manualError = err instanceof Error ? err : new Error(String(err));
          server.cancelWait();
        });

      const result = await server.waitForCode();

      // If manual input was cancelled, throw that error
      if (manualError) {
        throw manualError;
      }

      if (result?.code) {
        // Browser callback won
        code = result.code;
      } else if (manualCode) {
        // Manual input won (or callback timed out and user had entered code)
        const parsed = parseAuthorizationInput(manualCode);
        if (parsed.state && parsed.state !== state) {
          throw new Error("State mismatch");
        }
        code = parsed.code;
      }

      // If still no code, wait for manual promise to complete and try that
      if (!code) {
        await manualPromise;
        if (manualError) {
          throw manualError;
        }
        if (manualCode) {
          const parsed = parseAuthorizationInput(manualCode);
          if (parsed.state && parsed.state !== state) {
            throw new Error("State mismatch");
          }
          code = parsed.code;
        }
      }
    } else {
      // Original flow: wait for callback, then prompt if needed
      const result = await server.waitForCode();
      if (result?.code) {
        code = result.code;
      }
    }

    // Fallback to onPrompt if still no code
    if (!code) {
      const input = await options.onPrompt({
        message: "Paste the authorization code (or full redirect URL):",
      });
      const parsed = parseAuthorizationInput(input);
      if (parsed.state && parsed.state !== state) {
        throw new Error("State mismatch");
      }
      code = parsed.code;
    }

    if (!code) {
      throw new Error("Missing authorization code");
    }

    return exchangeAuthorizationCodeForCredentials(code, verifier, REDIRECT_URI);
  } finally {
    server.close();
  }
}

export async function refreshOpenAICodexToken(refreshToken: string): Promise<OAuthCredentials> {
  return credentialsFromToken(await refreshAccessToken(refreshToken));
}
