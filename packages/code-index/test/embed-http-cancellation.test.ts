import { afterEach, describe, expect, it, vi } from "vitest";
import { EmbeddingProviderHttp } from "../src/embed/http.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EmbeddingProviderHttp cancellation", () => {
  it("waits for the server to confirm that the embedding device is idle", async () => {
    const controller = new AbortController();
    let embeddingRequestId: string | undefined;
    let cancelledRequestId: string | undefined;
    let releaseCancellation: (() => void) | undefined;
    const cancellationGate = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body)) as { requestId: string };
        if (url.endsWith("/cancel")) {
          cancelledRequestId = body.requestId;
          await cancellationGate;
          return new Response(JSON.stringify({ cancelled: true, idle: true }), { status: 200 });
        }
        embeddingRequestId = body.requestId;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      }),
    );
    const provider = new EmbeddingProviderHttp("http://127.0.0.1:18742", 3, false, "test", { maxRetries: 0 });
    let settled = false;
    const encoding = provider.encode(["chunk"], controller.signal).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(embeddingRequestId).toBeDefined());

    controller.abort(new Error("preempted"));
    await vi.waitFor(() => expect(cancelledRequestId).toBe(embeddingRequestId));
    expect(settled).toBe(false);
    releaseCancellation?.();

    await expect(encoding).rejects.toThrow("preempted");
  });

  it("surfaces a failed server cancellation handshake", async () => {
    const controller = new AbortController();
    let embeddingStarted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/cancel")) return new Response("device busy", { status: 503 });
        embeddingStarted = true;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      }),
    );
    const provider = new EmbeddingProviderHttp("http://127.0.0.1:18742", 3, false, "test", { maxRetries: 0 });
    const encoding = provider.encode(["chunk"], controller.signal);
    await vi.waitFor(() => expect(embeddingStarted).toBe(true));

    controller.abort(new Error("preempted"));

    await expect(encoding).rejects.toThrow("Embedding cancellation failed: server returned 503: device busy");
  });
});
