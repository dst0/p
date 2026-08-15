import * as http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicOAuthProvider, loginAnthropic, refreshAnthropicToken } from "../src/utils/oauth/anthropic.ts";

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function fetchLocal(path: string): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:53692${path}`, { agent: false }, (res) => resolve(res)).on("error", reject);
  });
}

function getUrl(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (input instanceof Request) {
    return input.url;
  }
  throw new Error(`Unsupported fetch input: ${String(input)}`);
}

function getJsonBody(init?: RequestInit): Record<string, string> {
  if (typeof init?.body !== "string") {
    throw new Error(`Expected string request body, got ${typeof init?.body}`);
  }
  return JSON.parse(init.body) as Record<string, string>;
}

describe.sequential("Anthropic OAuth Coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("handles automatic callback server success", async () => {
    let expectedState = "";
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit): Promise<Response> => {
      return jsonResponse({
        access_token: "access-token-auto",
        refresh_token: "refresh-token-auto",
        expires_in: 3600,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = anthropicOAuthProvider.login({
      onAuth: (info) => {
        const url = new URL(info.url);
        expectedState = url.searchParams.get("state")!;
        setTimeout(() => {
          fetchLocal(`/callback?code=auto-code&state=${expectedState}`).catch(() => {});
        }, 10);
      },
      onPrompt: async () => "",
      onDeviceCode: () => {},
      onSelect: async () => "",
      onManualCodeInput: () => new Promise(() => {}), // never resolves
    });

    const credentials = await promise;
    expect(credentials.access).toBe("access-token-auto");
  });

  it("handles automatic callback server errors (404, missing params, error param)", async () => {
    let expectedState = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ access_token: "ok" })),
    );

    let resolveError!: () => void;
    const errorPromise = new Promise<void>((resolve) => {
      resolveError = resolve;
    });

    const promise = loginAnthropic({
      onAuth: async (info) => {
        const url = new URL(info.url);
        expectedState = url.searchParams.get("state")!;

        const res1 = await fetchLocal(`/not-found`);
        expect(res1.statusCode).toBe(404);

        const res2 = await fetchLocal(`/callback`);
        expect(res2.statusCode).toBe(400);

        const res3 = await fetchLocal(`/callback?error=access_denied`);
        expect(res3.statusCode).toBe(400);

        const res4 = await fetchLocal(`/callback?code=abc&state=wrong`);
        expect(res4.statusCode).toBe(400);

        resolveError();
        fetchLocal(`/callback?code=auto-code&state=${expectedState}`).catch(() => {});
      },
      onPrompt: async () => "",
      onManualCodeInput: () => new Promise(() => {}),
    });

    await promise;
    await errorPromise;
  });

  it("handles manual code input formats", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: "ok", refresh_token: "rt", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);

    let state = "";
    const p1 = loginAnthropic({
      onAuth: (info) => {
        state = new URL(info.url).searchParams.get("state")!;
      },
      onPrompt: async () => "",
      onManualCodeInput: async () => `some-garbage#code=hash-code&state=fake`,
    });
    await expect(p1).rejects.toThrow("OAuth state mismatch");

    const p2 = loginAnthropic({
      onAuth: (info) => {
        state = new URL(info.url).searchParams.get("state")!;
      },
      onPrompt: async () => "",
      onManualCodeInput: async () => `code=param-code&state=${state}`,
    });
    await p2;
    expect(fetchMock).toHaveBeenCalled();
  });

  it("keeps the localhost redirect_uri for manual callback login", async () => {
    let authUrl = "";
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
      expect(getUrl(input)).toBe("https://platform.claude.com/v1/oauth/token");
      expect(init?.method).toBe("POST");
      const body = getJsonBody(init);
      expect(body.grant_type).toBe("authorization_code");
      expect(body.code).toBe("manual-code");
      expect(body.redirect_uri).toBe("http://localhost:53692/callback");
      return jsonResponse({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const credentials = await loginAnthropic({
      onAuth: (info) => {
        authUrl = info.url;
      },
      onPrompt: async () => "",
      onManualCodeInput: async () => {
        const url = new URL(authUrl);
        const state = url.searchParams.get("state");
        const redirectUri = url.searchParams.get("redirect_uri");
        if (!state || !redirectUri) {
          throw new Error("Missing OAuth state or redirect_uri in auth URL");
        }
        return `${redirectUri}?code=manual-code&state=${state}`;
      },
    });

    expect(credentials.access).toBe("access-token");
    expect(credentials.refresh).toBe("refresh-token");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("formats complex errors during token refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err = new Error("Fetch failed");
        (err as any).code = "ECONNREFUSED";
        (err as any).errno = -111;
        (err as any).cause = new Error("inner cause");
        throw err;
      }),
    );
    await expect(refreshAnthropicToken("refresh-token")).rejects.toThrow("ECONNREFUSED");
  });

  it("handles empty authorization input", async () => {
    await expect(
      loginAnthropic({
        onAuth: () => {},
        onPrompt: async () => "",
        onManualCodeInput: async () => "   ",
      }),
    ).rejects.toThrow("Missing authorization code");
  });

  it("handles node apis absence gracefully", async () => {
    const origProcess = process;
    vi.stubGlobal("process", { ...origProcess, versions: { node: undefined, bun: undefined } });
    await expect(
      loginAnthropic({
        onAuth: () => {},
        onPrompt: async () => "",
      }),
    ).rejects.toThrow("Anthropic OAuth is only available in Node.js environments");
    vi.stubGlobal("process", origProcess);
  });

  it("handles server port conflicts and cleanly severs keep-alive sockets on shutdown", async () => {
    const { startCallbackServer, stopCallbackServer } = await import("../src/utils/oauth/anthropic-callback-server.ts");
    const serverInfo = await startCallbackServer("expected-state");

    try {
      // 1. Port conflict: another server attempting to listen on 53692 fails
      await expect(startCallbackServer("conflict-state")).rejects.toThrow();

      // 2. Open an HTTP keep-alive connection
      const keepAliveAgent = new http.Agent({ keepAlive: true });
      const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.get("http://127.0.0.1:53692/callback?state=wrong", { agent: keepAliveAgent }, resolve);
        req.on("error", reject);
      });
      res.resume(); // consume response

      // 3. Stop callback server while keep-alive connection is active
      await stopCallbackServer(serverInfo.server);
      keepAliveAgent.destroy();

      // 4. Invariant: port must be immediately re-bindable without EADDRINUSE
      const rebindServer = http.createServer();
      await new Promise<void>((resolve, reject) => {
        rebindServer.listen(53692, "127.0.0.1", () => {
          rebindServer.close(() => resolve());
        });
        rebindServer.on("error", reject);
      });
    } finally {
      await stopCallbackServer(serverInfo.server);
    }
  });

  it("handles malformed request URL and duplicate stopCallbackServer calls", async () => {
    const { startCallbackServer, stopCallbackServer } = await import("../src/utils/oauth/anthropic-callback-server.ts");
    const serverInfo = await startCallbackServer("expected-state");

    try {
      const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: 53692,
            path: "http://[invalid-host:port",
            method: "GET",
          },
          resolve,
        );
        req.on("error", reject);
        req.end();
      });
      expect(res.statusCode).toBe(500);
    } finally {
      await stopCallbackServer(serverInfo.server);
      await stopCallbackServer(serverInfo.server);
    }
  });
});
