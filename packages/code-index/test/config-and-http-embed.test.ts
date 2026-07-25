import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig, DEFAULT_CONFIG, EXCLUDE_DIRS, EXCLUDE_EXTS, LANG_MAP } from "../src/config.ts";
import { EmbeddingError, VectorStoreError } from "../src/embed/errors.ts";
import { createDefaultProvider, EmbeddingProviderHttp } from "../src/embed/http.ts";

describe("code-index config", () => {
  it("returns default config when no overrides are given", () => {
    const cfg = createConfig();
    expect(cfg.qdrantUrl).toBe(DEFAULT_CONFIG.qdrantUrl);
    expect(cfg.denseDim).toBe(1024);
  });

  it("applies defined overrides and ignores undefined ones", () => {
    const cfg = createConfig({ denseDim: 512, qdrantUrl: undefined });
    expect(cfg.denseDim).toBe(512);
    expect(cfg.qdrantUrl).toBe(DEFAULT_CONFIG.qdrantUrl);
  });

  it("exports exclusion sets and language mappings", () => {
    expect(EXCLUDE_DIRS.has(".git")).toBe(true);
    expect(EXCLUDE_EXTS.has(".png")).toBe(true);
    expect(LANG_MAP[".ts"]).toBe("typescript");
  });
});

describe("code-index errors", () => {
  it("constructs EmbeddingError properly", () => {
    const err = new EmbeddingError("server_down", "Server connection failed");
    expect(err.name).toBe("EmbeddingError");
    expect(err.type).toBe("server_down");
    expect(err.message).toBe("Server connection failed");
  });

  it("constructs VectorStoreError properly", () => {
    const err = new VectorStoreError("qdrant_error", "Collection missing");
    expect(err.name).toBe("VectorStoreError");
    expect(err.type).toBe("qdrant_error");
    expect(err.message).toBe("Collection missing");
  });
});

describe("EmbeddingProviderHttp", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("encodes texts and query using HTTP endpoints", async () => {
    const dummyVec = Array.from({ length: 4 }, (_, i) => i * 0.1);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: [dummyVec],
      }),
    });

    const provider = new EmbeddingProviderHttp("http://localhost:18742", 4, false, "Qwen/Qwen3-Embedding-0.6B");
    const vectors = await provider.encode(["test text"]);

    expect(vectors.length).toBe(1);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
    expect(vectors[0].length).toBe(4);

    const queryVec = await provider.encodeQuery("query text");
    expect(queryVec).toBeInstanceOf(Float32Array);

    provider.stop();
    await provider.dispose();
  });

  it("handles HTTP errors and invalid response shapes", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Error",
    });

    const provider = new EmbeddingProviderHttp("http://localhost:18742", 4, false, "non-qwen", { maxRetries: 0 });
    await expect(provider.encode(["fail"])).rejects.toThrow(EmbeddingError);

    // Non-500 status (e.g. 400 Bad Request)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Bad Request",
    });
    await expect(provider.encode(["fail"])).rejects.toThrow("Embedding server error 400");

    const defaultProv = createDefaultProvider("http://localhost:18742", 4);
    expect(defaultProv).toBeInstanceOf(EmbeddingProviderHttp);
  });

  it("handles pre-aborted signal and in-flight aborted signal", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:18742", 4, false);
    const controller = new AbortController();
    controller.abort(new Error("custom cancel"));

    await expect(provider.encode(["test"], controller.signal)).rejects.toThrow("custom cancel");
    await expect(provider.encodeQuery("query", controller.signal)).rejects.toThrow("custom cancel");
  });

  it("handles invalid response JSON and structure errors", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:18742", 4, false, "non-qwen", { maxRetries: 0 });

    // Invalid non-object response
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => "not-an-object",
    });
    await expect(provider.encode(["text"])).rejects.toThrow("invalid response");

    // Missing/wrong length embeddings array
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embeddings: [] }),
    });
    await expect(provider.encode(["text"])).rejects.toThrow("expected 1");

    // Vector dimension mismatch
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2]] }),
    });
    await expect(provider.encode(["text"])).rejects.toThrow("dimensions do not match");

    // Vector with NaN / non-number element
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embeddings: [[0.1, "invalid", 0.3, 0.4]] }),
    });
    await expect(provider.encode(["text"])).rejects.toThrow("dimensions do not match");
  });

  it("handles TimeoutError and network connection failures with retries", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:18742", 4, false, "non-qwen", { maxRetries: 1 });

    // TimeoutError
    const timeoutErr = new Error("Request timed out");
    timeoutErr.name = "TimeoutError";
    globalThis.fetch = vi.fn().mockRejectedValue(timeoutErr);

    await expect(provider.encode(["text"])).rejects.toThrow("timed out");

    // Network connection refused
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:18742"));
    await expect(provider.encode(["text"])).rejects.toThrow("unreachable");
  });

  it("delegates ensureReady to serverManager when present", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:18742", 4, false);
    await expect(provider.ensureReady()).resolves.toBeUndefined();
  });
});
