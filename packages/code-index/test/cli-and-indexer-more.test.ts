import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.ts";
import { CodeIndexer } from "../src/indexer.ts";
import { QdrantClient } from "../src/qdrant.ts";
import type { ChunkPayload, IndexConfig } from "../src/types.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("cli process handlers and collection creation fallback", () => {
  it("invokes SIGINT/exit cleanup handlers registered by cli main", async () => {
    const processOnListeners: Record<string, ((...args: any[]) => void)[]> = {};
    vi.spyOn(process, "on").mockImplementation((event: any, listener: any) => {
      if (!processOnListeners[event]) processOnListeners[event] = [];
      processOnListeners[event].push(listener);
      return process;
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(CodeIndexer.prototype, "getStatus").mockResolvedValue(undefined);

    await main(["node", "cli.js", "--status"]);

    expect(processOnListeners.SIGINT).toBeDefined();
    expect(processOnListeners.exit).toBeDefined();

    // Trigger cleanup
    for (const fn of processOnListeners.SIGINT ?? []) {
      fn();
    }
    for (const fn of processOnListeners.exit ?? []) {
      fn();
    }
    expect(exitSpy).toHaveBeenCalled();
  });

  it("handles getStatus failure when indexing single repo by creating collection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-cli-repo-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, "index.ts"), "export const x = 1;");

    vi.spyOn(CodeIndexer.prototype, "load").mockResolvedValue(undefined);
    vi.spyOn(CodeIndexer.prototype, "getStatus").mockRejectedValue(new Error("Collection missing"));
    const createCollSpy = vi.spyOn(QdrantClient.prototype, "createCollection").mockResolvedValue(undefined);
    vi.spyOn(CodeIndexer.prototype, "indexRepo").mockResolvedValue({ files: 1, chunks: 1, skipped: 0, errors: 0 });

    await main(["node", "cli.js", "--repo", dir]);

    expect(createCollSpy).toHaveBeenCalled();
  });
});

describe("indexer vocab progress and search symbol formatting", () => {
  it("formats search results with and without symbol metadata", async () => {
    const config: IndexConfig = {
      qdrantUrl: "http://localhost:6333",
      collection: "test_coll",
      modelId: "test-model",
      denseDim: 4,
      workspace: "/tmp",
      bm25K1: 1.5,
      bm25B: 0.75,
      defaultChunkLines: 80,
      maxChunkLines: 300,
      maxFileSize: 1000,
      batchSize: 10,
      encodeBatchSize: 10,
      maxEncodeChars: 1000,
      vocabPath: "/tmp/vocab.json",
      embeddingServerUrl: "http://localhost:18742",
    };

    const indexer = new CodeIndexer(config);
    vi.spyOn(indexer.encoder, "encodeQuery").mockResolvedValue(new Float32Array([0.1, 0.2, 0.3, 0.4]));

    const payloadWithSymbol: ChunkPayload = {
      workspace: "local",
      repo: "myrepo",
      repoPath: "myrepo",
      path: "src/file.ts",
      absPath: "/tmp/myrepo/src/file.ts",
      language: "typescript",
      symbol: "myFunc",
      chunkType: "function",
      startLine: 1,
      endLine: 10,
      fileHash: "hash1",
      chunkHash: "hash2",
      branch: "main",
      commit: "123",
      lastIndexed: "2026-01-01",
    };

    const payloadWithoutSymbol: ChunkPayload = {
      ...payloadWithSymbol,
      symbol: "",
    };

    vi.spyOn(indexer.qdrant, "search").mockResolvedValue([
      { id: 1, score: 0.9, payload: payloadWithSymbol },
      { id: 2, score: 0.8, payload: payloadWithoutSymbol },
    ]);

    vi.spyOn(indexer.qdrant, "searchDense").mockResolvedValue([
      { id: 1, score: 0.9, payload: payloadWithSymbol },
      { id: 2, score: 0.8, payload: payloadWithoutSymbol },
    ]);

    indexer.vocab.register("query");
    const results = await indexer.search("query");
    expect(results).toHaveLength(2);

    const denseResults = await indexer.searchDense("query");
    expect(denseResults).toHaveLength(2);
  });

  it("logs vocab progress when total chunks exceed 2000", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-large-vocab-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, ".git"));

    const config: IndexConfig = {
      qdrantUrl: "http://localhost:6333",
      collection: "test_coll",
      modelId: "test-model",
      denseDim: 4,
      workspace: dir,
      bm25K1: 1.5,
      bm25B: 0.75,
      defaultChunkLines: 80,
      maxChunkLines: 300,
      maxFileSize: 10_000_000,
      batchSize: 10,
      encodeBatchSize: 10,
      maxEncodeChars: 1000,
      vocabPath: join(dir, "vocab.json"),
      embeddingServerUrl: "http://localhost:18742",
    };

    const indexer = new CodeIndexer(config);

    // Create 2001 files
    const allChunkTexts: string[] = [];
    for (let i = 0; i < 2001; i++) {
      allChunkTexts.push(`chunk_token_${i}`);
    }

    // Register all 2001 texts to trigger the 2000-chunk progress log
    for (let idx = 0; idx < allChunkTexts.length; idx++) {
      indexer.vocab.register(allChunkTexts[idx]);
    }
    indexer.vocab.finalize();

    expect(indexer.vocab.totalDocs).toBe(2001);
  });
});

describe("QdrantClient vector config and search payload fallbacks", () => {
  it("handles getStatus with nested dense vector configuration and missing payload", async () => {
    const config: IndexConfig = {
      qdrantUrl: "http://localhost:6333",
      collection: "test_coll",
      modelId: "test-model",
      denseDim: 4,
      workspace: "/tmp",
      bm25K1: 1.5,
      bm25B: 0.75,
      defaultChunkLines: 80,
      maxChunkLines: 300,
      maxFileSize: 1000,
      batchSize: 10,
      encodeBatchSize: 10,
      maxEncodeChars: 1000,
      vocabPath: "/tmp/vocab.json",
      embeddingServerUrl: "http://localhost:18742",
    };

    const qdrant = new QdrantClient(config);
    const rawClient = (qdrant as any).client;

    vi.spyOn(rawClient, "getCollection").mockResolvedValue({
      config: {
        params: {
          vectors: {
            dense: { size: 1024 },
          },
          sparse_vectors: {},
        },
      },
      points_count: 50,
      indexed_vectors_count: 50,
      segments_count: 2,
    });

    const status = await qdrant.getStatus();
    expect(status.vectorDim).toBe(1024);
    expect(status.sparseVectors).toBe(true);

    // Test getStatus when vectors is not an object or has no size
    vi.spyOn(rawClient, "getCollection").mockResolvedValueOnce({
      config: { params: { vectors: "invalid_vectors_config" } },
    });
    const status2 = await qdrant.getStatus();
    expect(status2.vectorDim).toBe("?");
  });

  it("handles search and searchDense with number[] input and null/undefined payloads", async () => {
    const config: IndexConfig = {
      qdrantUrl: "http://localhost:6333",
      collection: "test_coll",
      modelId: "test-model",
      denseDim: 4,
      workspace: "/tmp",
      bm25K1: 1.5,
      bm25B: 0.75,
      defaultChunkLines: 80,
      maxChunkLines: 300,
      maxFileSize: 1000,
      batchSize: 10,
      encodeBatchSize: 10,
      maxEncodeChars: 1000,
      vocabPath: "/tmp/vocab.json",
      embeddingServerUrl: "http://localhost:18742",
    };

    const qdrant = new QdrantClient(config);
    const rawClient = (qdrant as any).client;

    vi.spyOn(rawClient, "search").mockResolvedValue([{ id: "point-1", score: 0.95, payload: undefined }]);

    const results = await qdrant.search([0.1, 0.2, 0.3, 0.4], { indices: [0], values: [1.0] }, 5);
    expect(results).toHaveLength(1);
    expect(results[0].payload).toEqual({});

    const denseResults = await qdrant.searchDense([0.1, 0.2, 0.3, 0.4], 5);
    expect(denseResults).toHaveLength(1);
    expect(denseResults[0].payload).toEqual({});
  });
});
