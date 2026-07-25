import fs, { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmbeddingError, VectorStoreError } from "../src/embed/errors.ts";
import { EmbeddingProviderHttp } from "../src/embed/http.ts";
import { EmbeddingServerManager } from "../src/embed/server.ts";
import { WorkspaceCodeRagService } from "../src/rag/service.ts";
import type {
  RagErrorCode,
  RagVectorStore,
  SparseVector,
  VectorPoint,
  VectorSearchFilters,
  VectorSearchResult,
} from "../src/rag/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function createWorkspace(): { workspaceRoot: string; dataDirectory: string } {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "p-rag-contract-workspace-"));
  const dataDirectory = mkdtempSync(join(tmpdir(), "p-rag-contract-data-"));
  temporaryDirectories.push(workspaceRoot, dataDirectory);
  writeFileSync(join(workspaceRoot, "source.ts"), "export const value = 1;");
  return { workspaceRoot, dataDirectory };
}

class TestVectorStore implements RagVectorStore {
  exists = false;
  dimensions = 1024;
  points: VectorPoint[] = [];
  searchError: Error | undefined;

  async collectionExists(): Promise<boolean> {
    return this.exists;
  }

  async createCollection(): Promise<void> {
    this.exists = true;
  }

  async deleteCollection(): Promise<void> {
    this.exists = false;
  }

  async collectionStatus(): Promise<{ points: number; dimensions: number | undefined }> {
    return { points: this.points.length, dimensions: this.dimensions };
  }

  async upsert(_collection: string, points: VectorPoint[]): Promise<void> {
    this.points.push(...points);
  }

  async deleteFileVersions(): Promise<void> {}

  async search(
    _collection: string,
    _dense: Float32Array,
    _sparse: SparseVector,
    _filters: VectorSearchFilters,
    _limit: number,
  ): Promise<VectorSearchResult[]> {
    if (this.searchError) throw this.searchError;
    return this.points.map((point, index) => ({
      id: point.id,
      score: 0.9 - index * 0.1,
      payload: point.payload,
    }));
  }
}

function createService(
  workspaceRoot: string,
  dataDirectory: string,
  vectorStore: TestVectorStore,
  settings: { autoRefresh?: boolean } = {},
): WorkspaceCodeRagService {
  return new WorkspaceCodeRagService({
    workspaceRoot,
    dataDirectory,
    vectorStore,
    embeddingProvider: {
      dim: 1024,
      encode: async (texts) => texts.map(() => new Float32Array(1024)),
      encodeQuery: async () => new Float32Array(1024),
    },
    settings: {
      preparationWorkerMemoryBytes: 1 * 1024 * 1024,
      preparationMemoryReserveBytes: 1 * 1024 * 1024,
      ...settings,
    },
    manageLocalBackends: false,
  });
}

describe("EmbeddingProviderHttp failure contract", () => {
  it("starts a managed local embedding server before use", async () => {
    const ensureStarted = vi.spyOn(EmbeddingServerManager.prototype, "ensureStarted").mockResolvedValue(false);
    const provider = new EmbeddingProviderHttp("http://127.0.0.1:18742", 1024, true);

    await provider.ensureReady();

    expect(ensureStarted).toHaveBeenCalledOnce();
  });

  it("classifies a terminal HTTP failure as a server error", async () => {
    const provider = new EmbeddingProviderHttp("http://127.0.0.1:18742", 1024, false, "Qwen/Qwen3-Embedding-0.6B", {
      maxRetries: 0,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Server Error", { status: 500 }));

    await expect(provider.encode(["text"])).rejects.toMatchObject({
      name: "EmbeddingError",
      type: "server_error",
      message: "Embedding server error 500: Server Error",
    });
  });
});

describe("WorkspaceCodeRagService public failure contract", () => {
  it.each<{
    error: Error;
    expectedCode: RagErrorCode;
  }>([
    {
      error: new EmbeddingError("server_down", "Embedding server is down"),
      expectedCode: "RAG_EMBEDDING_SERVER_DOWN",
    },
    {
      error: new EmbeddingError("server_error", "Embedding server returned 500"),
      expectedCode: "RAG_EMBEDDING_SERVER_ERROR",
    },
    {
      error: new VectorStoreError("qdrant_down", "Qdrant is down"),
      expectedCode: "RAG_QDRANT_DOWN",
    },
    {
      error: new VectorStoreError("network", "Qdrant network failed"),
      expectedCode: "RAG_NETWORK_ERROR",
    },
    {
      error: new VectorStoreError("qdrant_error", "Qdrant rejected the request"),
      expectedCode: "RAG_QDRANT_ERROR",
    },
    {
      error: Object.assign(new Error("Search timed out"), { name: "TimeoutError" }),
      expectedCode: "RAG_TIMEOUT",
    },
  ])("reports $expectedCode when search fails", async ({ error, expectedCode }) => {
    const { workspaceRoot, dataDirectory } = createWorkspace();
    const vectorStore = new TestVectorStore();
    const service = createService(workspaceRoot, dataDirectory, vectorStore, { autoRefresh: false });
    await service.refresh();
    vectorStore.searchError = error;

    const response = await service.search({ query: "value", freshness: "allow_stale" });

    expect(response.results).toEqual([]);
    expect(response.status.lastError).toMatchObject({
      code: expectedCode,
      message: expectedCode === "RAG_TIMEOUT" ? "Code RAG search timed out" : error.message,
    });
  });

  it("returns an unavailable status when persisted collection lookup fails", async () => {
    const { workspaceRoot, dataDirectory } = createWorkspace();
    const vectorStore = new TestVectorStore();
    await createService(workspaceRoot, dataDirectory, vectorStore).refresh();
    vi.spyOn(vectorStore, "collectionExists").mockRejectedValue(new Error("Connection refused"));

    const status = await createService(workspaceRoot, dataDirectory, vectorStore).initialize();

    expect(status).toMatchObject({
      state: "unavailable",
      lastError: {
        code: "RAG_BACKEND_UNAVAILABLE",
        message: "Connection refused",
      },
    });
  });

  it("reports a filesystem freshness failure through status", async () => {
    const { workspaceRoot, dataDirectory } = createWorkspace();
    const vectorStore = new TestVectorStore();
    const service = createService(workspaceRoot, dataDirectory, vectorStore);
    await service.refresh();
    vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw new Error("Filesystem unavailable");
    });

    const status = await service.initialize();

    expect(status).toMatchObject({
      state: "unavailable",
      lastError: {
        code: "RAG_BACKEND_UNAVAILABLE",
        message: "Filesystem unavailable",
      },
    });
  });

  it("rejects a repository-escaping path through the search API", async () => {
    const { workspaceRoot, dataDirectory } = createWorkspace();
    const service = createService(workspaceRoot, dataDirectory, new TestVectorStore());

    await expect(service.search({ query: "value", pathPrefix: ".." })).rejects.toMatchObject({
      code: "RAG_SECURITY_BLOCK",
      message: "Path filter cannot escape the repository",
    });
  });

  it("does not start a background refresh when auto-refresh is disabled", async () => {
    const { workspaceRoot, dataDirectory } = createWorkspace();
    const service = createService(workspaceRoot, dataDirectory, new TestVectorStore(), { autoRefresh: false });
    const refresh = vi.spyOn(service, "refresh");

    const response = await service.search({ query: "value", freshness: "prefer_fresh" });

    expect(response.results).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("marks a persisted index incompatible when its sparse vocabulary is missing", async () => {
    const { workspaceRoot, dataDirectory } = createWorkspace();
    const vectorStore = new TestVectorStore();
    await createService(workspaceRoot, dataDirectory, vectorStore).refresh();
    const repositoryDirectory = join(dataDirectory, readdirSync(dataDirectory)[0]);
    const vocabularyFile = readdirSync(repositoryDirectory).find((name) => name.startsWith("bm25-"));
    expect(vocabularyFile).toBeDefined();
    if (!vocabularyFile) throw new Error("Expected refresh to persist a sparse vocabulary");
    rmSync(join(repositoryDirectory, vocabularyFile));

    const status = await createService(workspaceRoot, dataDirectory, vectorStore).initialize();

    expect(status).toMatchObject({
      state: "stale",
      staleReason: "Sparse vocabulary file is missing",
      lastError: {
        code: "RAG_INCOMPATIBLE_INDEX",
        message: "Sparse vocabulary file is missing",
      },
    });
  });
});
