import fs, { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverFilesWithOptions } from "../src/discover.ts";
import { EmbeddingError, VectorStoreError } from "../src/embed/errors.ts";
import { EmbeddingProviderHttp } from "../src/embed/http.ts";
import { WorkspaceCodeRagService } from "../src/rag/service.ts";
import type { RagVectorStore, VectorPoint, VectorSearchFilters } from "../src/rag/types.ts";
import { QdrantVectorStore } from "../src/rag/vector-store.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

class MockVectorStore implements RagVectorStore {
  public exists = false;
  public dimensions = 1024;
  public points: VectorPoint[] = [];

  async collectionExists(_collection: string): Promise<boolean> {
    return this.exists;
  }
  async createCollection(_collection: string, _denseDimensions: number): Promise<void> {
    this.exists = true;
  }
  async deleteCollection(_collection: string): Promise<void> {
    this.exists = false;
  }
  async collectionStatus(_collection: string): Promise<{ points: number; dimensions: number | undefined }> {
    return { points: this.points.length, dimensions: this.dimensions };
  }
  async createPayloadIndexes(_collection: string): Promise<void> {}
  async upsert(_collection: string, points: VectorPoint[]): Promise<void> {
    this.points.push(...points);
  }
  async deleteFileVersions(_collection: string, _repoId: string, _fileId: string): Promise<void> {}
  async search(
    _collection: string,
    _dense: Float32Array,
    _sparse: any,
    _filters: VectorSearchFilters,
    _limit: number,
  ): Promise<any[]> {
    return this.points.map((p, idx) => ({ id: p.id, score: 0.9 - idx * 0.1, payload: p.payload }));
  }
}

class ErrorThrowingVectorStore implements RagVectorStore {
  public errorToThrow: Error = new Error("Vector store error");

  async collectionExists(_collection: string): Promise<boolean> {
    return true;
  }
  async createCollection(_collection: string, _denseDimensions: number): Promise<void> {}
  async deleteCollection(_collection: string): Promise<void> {}
  async collectionStatus(_collection: string): Promise<{ points: number; dimensions: number | undefined }> {
    return { points: 1, dimensions: 1024 };
  }
  async createPayloadIndexes(_collection: string): Promise<void> {}
  async upsert(_collection: string, _points: any[]): Promise<void> {}
  async deleteFileVersions(_collection: string, _repoId: string, _fileId: string): Promise<void> {}
  async search(
    _collection: string,
    _dense: Float32Array,
    _sparse: any,
    _filters: VectorSearchFilters,
    _limit: number,
  ): Promise<any[]> {
    throw this.errorToThrow;
  }
}

describe("QdrantVectorStore createCollection PUT request line 91", () => {
  it("executes PUT request to create collection when non-existent", async () => {
    const store = new QdrantVectorStore({ url: "http://127.0.0.1:6333", timeoutMs: 5000 });
    const client = (store as any).client;

    vi.spyOn(client, "collectionExists").mockResolvedValue({ exists: false });
    const putSpy = vi.spyOn(client, "request").mockResolvedValue({});
    vi.spyOn(store, "createPayloadIndexes").mockResolvedValue(undefined);

    await store.createCollection("test_coll", 1024);
    expect(putSpy).toHaveBeenCalledWith("PUT", "/collections/test_coll", expect.anything());
  });
});

describe("EmbeddingProviderHttp ensureReady and error branches", () => {
  it("executes ensureReady when serverManager is present", async () => {
    const provider = new EmbeddingProviderHttp("http://127.0.0.1:18742", 1024, true);
    const startSpy = vi.spyOn((provider as any).serverManager, "ensureStarted").mockResolvedValue(false);

    await provider.ensureReady();
    expect(startSpy).toHaveBeenCalled();
  });

  it("throws server_error on final retry attempt", async () => {
    const provider = new EmbeddingProviderHttp("http://127.0.0.1:18742", 1024, false, "Qwen/Qwen3-Embedding-0.6B", {
      maxRetries: 0,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Server Error", { status: 500 }));

    await expect(provider.encode(["text"])).rejects.toThrow("Embedding server error 500");
  });
});

describe("discoverFilesWithOptions containment check absolute path branch", () => {
  it("handles absolute containmentPath in discoverFilesWithOptions", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-disc-abs-"));
    temporaryDirectories.push(dir);
    writeFileSync(join(dir, "test.ts"), "export const x = 1;");

    const relSpy = vi.spyOn(require("node:path"), "relative").mockImplementation((from: any, to: any) => {
      if (to.endsWith("test.ts")) return "/absolute/escaping/path";
      return require("node:path").posix.relative(from, to);
    });

    const files = discoverFilesWithOptions(dir, { maxFileSize: 1000 });
    expect(files).not.toContain(join(dir, "test.ts"));
    relSpy.mockRestore();
  });
});

describe("WorkspaceCodeRagService error classification and waitForSignal coverage", () => {
  it("classifies all search error types", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-service-err-cl-"));
    temporaryDirectories.push(dir);
    writeFileSync(join(dir, "f1.ts"), "const x = 1;");

    const store = new ErrorThrowingVectorStore();
    const service = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      vectorStore: store,
      embeddingProvider: {
        dim: 1024,
        encode: async () => [new Float32Array(1024)],
        encodeQuery: async () => new Float32Array(1024),
      },
      manageLocalBackends: false,
    });

    await service.refresh();

    // Test EmbeddingError (server_down, server_error, unknown)
    store.errorToThrow = new EmbeddingError("server_down", "Server down");
    let resp = await service.search({ query: "q" });
    expect(resp.status.lastError?.code).toBe("RAG_EMBEDDING_SERVER_DOWN");

    store.errorToThrow = new EmbeddingError("server_error", "Server 500");
    resp = await service.search({ query: "q" });
    expect(resp.status.lastError?.code).toBe("RAG_EMBEDDING_SERVER_ERROR");

    store.errorToThrow = new EmbeddingError("unknown" as any, "Other embed error");
    resp = await service.search({ query: "q" });
    expect(resp.status.lastError?.code).toBe("RAG_EMBEDDING_SERVER_ERROR");

    // Test VectorStoreError (qdrant_down, network, unknown)
    store.errorToThrow = new VectorStoreError("qdrant_down", "Qdrant down");
    resp = await service.search({ query: "q" });
    expect(resp.status.lastError?.code).toBe("RAG_QDRANT_DOWN");

    store.errorToThrow = new VectorStoreError("network", "Network down");
    resp = await service.search({ query: "q" });
    expect(resp.status.lastError?.code).toBe("RAG_NETWORK_ERROR");

    store.errorToThrow = new VectorStoreError("unknown" as any, "Other store error");
    resp = await service.search({ query: "q" });
    expect(resp.status.lastError?.code).toBe("RAG_QDRANT_ERROR");

    // Test TimeoutError
    const timeoutErr = new Error("Timeout");
    timeoutErr.name = "TimeoutError";
    store.errorToThrow = timeoutErr;
    resp = await service.search({ query: "q" });
    expect(resp.status.lastError?.code).toBe("RAG_TIMEOUT");
  });

  it("handles operation cancellation when signal is aborted during refresh", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-service-abort-refresh-"));
    temporaryDirectories.push(dir);
    writeFileSync(join(dir, "f1.ts"), "const x = 1;");

    const service = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      manageLocalBackends: false,
    });

    const controller = new AbortController();
    controller.abort();

    await expect(service.refresh({}, controller.signal)).rejects.toThrow("Code RAG operation was cancelled");
  });

  it("handles reloadPersistedState when vectorStore.collectionExists throws", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-service-reload-err-"));
    temporaryDirectories.push(dir);
    writeFileSync(join(dir, "f1.ts"), "const x = 1;");

    const store = new MockVectorStore();
    const service = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      vectorStore: store,
      embeddingProvider: {
        dim: 1024,
        encode: async () => [new Float32Array(1024)],
        encodeQuery: async () => new Float32Array(1024),
      },
      manageLocalBackends: false,
    });

    await service.refresh();

    // Now collectionExists throws
    vi.spyOn(store, "collectionExists").mockRejectedValue(new Error("Connection refused"));

    const service2 = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      vectorStore: store,
      manageLocalBackends: false,
    });

    const _status = await service2.initialize();
    expect((service2 as any).state).toBe("unavailable");
    expect((service2 as any).lastError?.message).toContain("Connection refused");
  });

  it("handles updateFastFreshness filesystem error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-service-ff-err-"));
    temporaryDirectories.push(dir);
    writeFileSync(join(dir, "f1.ts"), "const x = 1;");

    const store = new MockVectorStore();
    const service = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      vectorStore: store,
      embeddingProvider: {
        dim: 1024,
        encode: async () => [new Float32Array(1024)],
        encodeQuery: async () => new Float32Array(1024),
      },
      manageLocalBackends: false,
    });

    await service.refresh();
    expect((service as any).state).toBe("ready");

    // Make statSync throw during updateFastFreshness
    vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw new Error("FS error during freshness check");
    });

    (service as any).updateFastFreshness();
    expect((service as any).state).toBe("unavailable");
    expect((service as any).lastError?.code).toBe("RAG_BACKEND_UNAVAILABLE");
  });

  it("handles loadVocabulary missing vocabulary file error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-vocab-missing-"));
    temporaryDirectories.push(dir);

    const service = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      manageLocalBackends: false,
    });

    expect(() =>
      (service as any).loadVocabulary({
        sparse: { generation: "gen1", vocabularyFile: "non-existent-vocab.json" },
      }),
    ).toThrow("Sparse vocabulary is missing");
  });

  it("handles normalizePathFilter escaping path Security error", () => {
    const service = new WorkspaceCodeRagService({
      workspaceRoot: "/tmp",
      dataDirectory: "/tmp/data",
      manageLocalBackends: false,
    });

    expect(() => (service as any).normalizeSearchInput({ query: "q", pathPrefix: ".." })).toThrow(
      "Path filter cannot escape the repository",
    );
  });

  it("handles startBackgroundRefresh when autoRefresh is false", () => {
    const service = new WorkspaceCodeRagService({
      workspaceRoot: "/tmp",
      dataDirectory: "/tmp/data",
      manageLocalBackends: false,
    });
    (service as any).settings.autoRefresh = false;

    // Should return early
    (service as any).startBackgroundRefresh();
  });
});
