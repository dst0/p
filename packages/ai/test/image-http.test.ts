import { describe, expect, it } from "vitest";
import { postImageJson, readBoundedImageResponse } from "../src/providers/images/image-http.ts";

describe("image HTTP response limits", () => {
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
    const retryDate = new Date(Date.now() + 30_000).toUTCString();
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
    expect(delays[1]).toBeGreaterThanOrEqual(28_000);
    expect(delays[1]).toBeLessThanOrEqual(30_000);
  });

  it("fails immediately when Retry-After exceeds maxRetryDelayMs", async () => {
    let sleepCalled = false;
    await expect(
      postImageJson(
        "https://images.example",
        "/v1/images/generations",
        {},
        {
          apiKey: "test",
          fetch: async () => new Response("retry", { status: 429, headers: { "retry-after": "120" } }),
          maxRetries: 1,
          maxRetryDelayMs: 1_000,
          sleep: async () => {
            sleepCalled = true;
          },
        },
      ),
    ).rejects.toThrow("requested retry delay 120000ms exceeds maximum 1000ms");
    expect(sleepCalled).toBe(false);
  });
});
