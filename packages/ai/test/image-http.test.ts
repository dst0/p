import { afterEach, describe, expect, it, vi } from "vitest";
import { postImageJson, readBoundedImageResponse } from "../src/providers/images/image-http.ts";

describe("image HTTP response limits", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts the exact byte boundary and rejects a larger streamed body", async () => {
    await expect(readBoundedImageResponse(new Response("12345"), 5)).resolves.toBe("12345");
    await expect(readBoundedImageResponse(new Response("123456"), 5)).rejects.toThrow(
      "response exceeds maximum limit of 5 bytes",
    );
  });

  it("rejects an oversized Content-Length before consuming the body", async () => {
    const response = new Response("{}", { headers: { "content-length": "6" } });
    await expect(readBoundedImageResponse(response, 5)).rejects.toThrow("response exceeds maximum limit of 5 bytes");
  });

  it("cancels a retryable response body before issuing the retry", async () => {
    let cancelled = false;
    let requestCount = 0;
    const retryBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("retry later"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetch = async (): Promise<Response> => {
      requestCount++;
      if (requestCount === 1) return new Response(retryBody, { status: 503 });
      return new Response('{"data":[]}', { status: 200 });
    };

    await expect(
      postImageJson(
        "https://images.example",
        "/v1/images/generations",
        {},
        {
          apiKey: "test",
          fetch,
          maxRetries: 1,
          sleep: async () => {},
        },
      ),
    ).resolves.toMatchObject({ data: { data: [] } });
    expect(cancelled).toBe(true);
    expect(requestCount).toBe(2);
  });

  it("honors Retry-After seconds and HTTP dates before retrying", async () => {
    const delays: number[] = [];
    let requestCount = 0;
    const now = 2_000_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const retryDate = new Date(now + 30_000).toUTCString();
    const fetch = async (): Promise<Response> => {
      requestCount++;
      if (requestCount === 1) return new Response("", { status: 429, headers: { "retry-after": "2" } });
      if (requestCount === 2) return new Response("", { status: 503, headers: { "retry-after": retryDate } });
      return new Response('{"data":[]}', { status: 200 });
    };

    await postImageJson(
      "https://images.example",
      "/v1/images/generations",
      {},
      {
        apiKey: "test",
        fetch,
        maxRetries: 2,
        maxRetryDelayMs: 60_000,
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
      },
    );

    expect(delays[0]).toBe(2_000);
    expect(delays[1]).toBe(30_000);
  });

  it("fails immediately when Retry-After exceeds maxRetryDelayMs", async () => {
    let sleepCalled = false;
    let bodyCancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("retry later"));
      },
      cancel() {
        bodyCancelled = true;
      },
    });
    await expect(
      postImageJson(
        "https://images.example",
        "/v1/images/generations",
        {},
        {
          apiKey: "test",
          fetch: async () => new Response(body, { status: 429, headers: { "retry-after": "120" } }),
          maxRetries: 1,
          maxRetryDelayMs: 1_000,
          sleep: async () => {
            sleepCalled = true;
          },
        },
      ),
    ).rejects.toThrow("requested retry delay 120000ms exceeds maximum 1000ms");
    expect(sleepCalled).toBe(false);
    expect(bodyCancelled).toBe(true);
  });

  it.each([-1, 1.5, Number.POSITIVE_INFINITY])("rejects invalid maxRetries value %s", async (maxRetries) => {
    const fetch = vi.fn(async () => new Response("{}"));
    await expect(postImageJson("https://images.example", "generate", {}, { fetch, maxRetries })).rejects.toThrow(
      "maxRetries must be a non-negative finite integer",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("supports millisecond, zero-delay, and bounded fallback retry timing", async () => {
    let requestCount = 0;
    const fetch = async (): Promise<Response> => {
      requestCount++;
      if (requestCount === 1) return new Response("", { status: 503, headers: { "retry-after-ms": "0" } });
      if (requestCount === 2) return new Response("", { status: 503, headers: { "retry-after-ms": "1" } });
      return new Response('{"ok":true}');
    };

    await expect(
      postImageJson<{ ok: boolean }>("https://images.example/", "/generate", {}, { fetch, maxRetries: 2 }),
    ).resolves.toMatchObject({ data: { ok: true } });

    const delays: number[] = [];
    requestCount = 0;
    await postImageJson(
      "https://images.example",
      "generate",
      {},
      {
        fetch: async () => {
          requestCount++;
          return requestCount === 1
            ? new Response("", { status: 503, headers: { "retry-after": "invalid-date" } })
            : new Response("{}");
        },
        maxRetries: 1,
        maxRetryDelayMs: 10,
        sleep: async (delay) => {
          delays.push(delay);
        },
      },
    );
    expect(delays).toEqual([10]);
  });

  it("cancels the default retry wait when the caller aborts", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("cancel retry wait")), 0);
    await expect(
      postImageJson(
        "https://images.example",
        "generate",
        {},
        {
          fetch: async () => new Response("", { status: 503, headers: { "retry-after-ms": "100" } }),
          maxRetries: 1,
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow("cancel retry wait");
  });

  it("does not begin a retry wait when the signal aborts during the response handoff", async () => {
    const controller = new AbortController();
    await expect(
      postImageJson(
        "https://images.example",
        "generate",
        {},
        {
          fetch: async () => {
            controller.abort(new Error("abort before retry wait"));
            return new Response("", { status: 503, headers: { "retry-after-ms": "100" } });
          },
          maxRetries: 1,
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow("abort before retry wait");
  });

  it("retries transient network errors but preserves the final network error", async () => {
    let requestCount = 0;
    const delays: number[] = [];
    await expect(
      postImageJson(
        "https://images.example",
        "generate",
        {},
        {
          fetch: async () => {
            requestCount++;
            if (requestCount === 1) throw new Error("temporary network error");
            return new Response('{"ok":true}');
          },
          maxRetries: 1,
          maxRetryDelayMs: 10,
          sleep: async (delay) => {
            delays.push(delay);
          },
        },
      ),
    ).resolves.toMatchObject({ data: { ok: true } });
    expect(delays).toEqual([10]);
    await expect(
      postImageJson(
        "https://images.example",
        "generate",
        {},
        {
          fetch: async () => {
            throw new Error("terminal network error");
          },
        },
      ),
    ).rejects.toThrow("terminal network error");
  });

  it("validates retry configuration and reports bounded JSON or text provider errors", async () => {
    await expect(
      postImageJson(
        "https://images.example",
        "generate",
        {},
        {
          fetch: async () => new Response("{}"),
          maxRetryDelayMs: Number.POSITIVE_INFINITY,
        },
      ),
    ).rejects.toThrow("maxRetryDelayMs must be a non-negative finite number");
    await expect(
      postImageJson(
        "https://images.example",
        "generate",
        {},
        {
          fetch: async () =>
            new Response('{"error":{"message":"quota exhausted"}}', { status: 400, statusText: "Bad Request" }),
        },
      ),
    ).rejects.toThrow("400 Bad Request: quota exhausted");
    await expect(
      postImageJson(
        "https://images.example",
        "generate",
        {},
        {
          fetch: async () => new Response("plain failure", { status: 400, statusText: "Bad Request" }),
        },
      ),
    ).rejects.toThrow("400 Bad Request: plain failure");
  });
});
