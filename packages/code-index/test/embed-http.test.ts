import { afterEach, describe, expect, it, vi } from "vitest";
import { EmbeddingProviderHttp } from "../src/embed/http.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

interface CapturedEmbeddingRequest {
  input: string[];
  normalize: boolean;
  priority: "background" | "interactive";
}

function captureEmbeddingRequests(): CapturedEmbeddingRequest[] {
  const requests: CapturedEmbeddingRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as CapturedEmbeddingRequest;
      requests.push(body);
      return new Response(JSON.stringify({ embeddings: body.input.map(() => [0.1, 0.2, 0.3]) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return requests;
}

describe("EmbeddingProviderHttp.encodeQuery", () => {
  it("uses Qwen's instruction-query format for Qwen3 embedding models", async () => {
    const requests = captureEmbeddingRequests();
    const provider = new EmbeddingProviderHttp("http://127.0.0.1:18742", 3, false, "Qwen/Qwen3-Embedding-0.6B");

    await provider.encodeQuery("tool definition system");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.input[0]).toBe(
      "Instruct: Given a natural-language description of software behaviour, " +
        "retrieve the relevant source-code functions, types, interfaces, modules, and tool definitions.\n" +
        "Query: tool definition system",
    );
    expect(requests[0]?.priority).toBe("interactive");
  });

  it("does not impose a Qwen-specific instruction on other embedding models", async () => {
    const requests = captureEmbeddingRequests();
    const provider = new EmbeddingProviderHttp("http://127.0.0.1:18742", 3, false, "acme/code-embed-v1");

    await provider.encodeQuery("tool definition system");

    expect(requests).toEqual([{ input: ["tool definition system"], normalize: true, priority: "interactive" }]);
  });
});

describe("EmbeddingProviderHttp.encode", () => {
  it("lets the resource-aware server micro-batch the configured 64-item encode batch", async () => {
    const requests = captureEmbeddingRequests();
    const provider = new EmbeddingProviderHttp("http://127.0.0.1:18742", 3, false, "Qwen/Qwen3-Embedding-0.6B", {
      batchSize: 64,
    });

    await provider.encode(Array.from({ length: 65 }, (_, index) => `chunk ${index}`));

    expect(requests.map((request) => request.input.length)).toEqual([64, 1]);
    expect(requests.map((request) => request.priority)).toEqual(["background", "background"]);
  });
});
