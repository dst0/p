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

    const defaultProv = createDefaultProvider("http://localhost:18742", 4);
    expect(defaultProv).toBeInstanceOf(EmbeddingProviderHttp);
  });
});
