import { describe, expect, it, vi } from "vitest";
import { EmbeddingProviderHttp } from "../src/embed/http.ts";

describe("embedding HTTP provider retries, errors, and cancellation", () => {
  it("throws server_error on final retry attempt for HTTP 500", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:28745", 1024, false, "Qwen/Qwen3-Embedding-0.6B", {
      maxRetries: 0,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Server error details", { status: 500 }));

    await expect(provider.encode(["text"])).rejects.toThrow("Embedding server error 500");
  });

  it("throws server_down on final retry attempt for TimeoutError", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:28745", 1024, false, "Qwen/Qwen3-Embedding-0.6B", {
      maxRetries: 0,
    });

    const err = new Error("Timeout");
    err.name = "TimeoutError";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(err);

    await expect(provider.encode(["text"])).rejects.toThrow("Embedding server request timed out");
  });

  it("parses IPv6, 0.0.0.0, and default port in baseUrl", () => {
    const p1 = new EmbeddingProviderHttp("http://0.0.0.0:19999", 1024, false);
    expect(p1).toBeDefined();

    const p2 = new EmbeddingProviderHttp("http://[::1]:19998", 1024, false);
    expect(p2).toBeDefined();
  });

  it("handles aborted signal immediately in encode and encodeQuery", async () => {
    const provider = new EmbeddingProviderHttp("http://127.0.0.1:18742", 1024, false);
    const controller = new AbortController();
    controller.abort(new Error("pre-aborted"));

    await expect(provider.encode(["text"], controller.signal)).rejects.toThrow("pre-aborted");
    await expect(provider.encodeQuery("query", controller.signal)).rejects.toThrow("pre-aborted");
  });

  it("throws on invalid response structures in parseResponse", () => {
    const provider = new EmbeddingProviderHttp("http://127.0.0.1:8080", 2, false);
    const parse = (
      provider as unknown as { parseResponse(val: unknown, rows: number): Float32Array[] }
    ).parseResponse.bind(provider);

    expect(() => parse(null, 1)).toThrow("invalid response");
    expect(() => parse([], 1)).toThrow("invalid response");
    expect(() => parse({ embeddings: "not-array" }, 1)).toThrow("expected 1");
    expect(() =>
      parse(
        {
          embeddings: [
            [0.1, 0.2],
            [0.3, 0.4],
          ],
        },
        1,
      ),
    ).toThrow("expected 1");
    expect(() => parse({ embeddings: [[0.1]] }, 1)).toThrow("dimensions do not match configured dimension 2");
    expect(() => parse({ embeddings: [["not-a-number", 0.2]] }, 1)).toThrow("dimensions do not match");
  });

  it("cancels embedding request and handles server cancellation confirmation failure", async () => {
    const provider = new EmbeddingProviderHttp("http://127.0.0.1:18742", 2, false);
    const cancelMethod = (provider as unknown as { cancelRequest(id: string): Promise<void> }).cancelRequest.bind(
      provider,
    );

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ idle: false }),
    } as unknown as Response);

    await expect(cancelMethod("req-123")).rejects.toThrow("did not confirm an idle device");
    fetchSpy.mockRestore();
  });

  it("aborts midway between multi-batch encoding iterations", async () => {
    const provider = new EmbeddingProviderHttp("http://127.0.0.1:18742", 2, false, "model", {
      batchSize: 1,
    });
    const controller = new AbortController();

    let requestCount = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        controller.abort(new Error("midway cancelled"));
      }
      return new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }), { status: 200 });
    });

    await expect(provider.encode(["text1", "text2"], controller.signal)).rejects.toThrow("midway cancelled");
    fetchSpy.mockRestore();
  });
});
