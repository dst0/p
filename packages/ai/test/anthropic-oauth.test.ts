import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshAnthropicToken } from "../src/utils/oauth/anthropic.ts";

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
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

describe.sequential("Anthropic OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("omits scope from refresh token requests", async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
      expect(getUrl(input)).toBe("https://platform.claude.com/v1/oauth/token");
      expect(init?.method).toBe("POST");
      const body = getJsonBody(init);
      expect(body.grant_type).toBe("refresh_token");
      expect(body.client_id).toBeTruthy();
      expect(body.refresh_token).toBe("refresh-token");
      expect(body).not.toHaveProperty("scope");
      return jsonResponse({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const credentials = await refreshAnthropicToken("refresh-token");

    expect(credentials.access).toBe("new-access-token");
    expect(credentials.refresh).toBe("new-refresh-token");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("handles token refresh failures and invalid JSON responses", async () => {
    // 500 error
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Server error", { status: 500 })),
    );
    await expect(refreshAnthropicToken("bad-token")).rejects.toThrow("Anthropic token refresh request failed");

    // Invalid JSON
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{ invalid json }", { status: 200 })),
    );
    await expect(refreshAnthropicToken("bad-token")).rejects.toThrow("Anthropic token refresh returned invalid JSON");
  });
});
