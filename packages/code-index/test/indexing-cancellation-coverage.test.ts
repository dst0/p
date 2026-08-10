import { describe, expect, it, vi } from "vitest";
import { BM25Vocabulary } from "../src/bm25.ts";
import type { PreparedChunk } from "../src/rag/service/types.ts";
import type { WorkspaceCodeRagService } from "../src/rag/service/workspacecoderagservice.ts";
import { do_encodeAndUpsert } from "../src/rag/service/workspacecoderagservice-methods/incremental-refresh.ts";

describe("indexing cancellation coverage", () => {
  it("skips dense embedding when incremental indexing is BM25-only", async () => {
    const ensureReady = vi.fn(async () => {});
    const encode = vi.fn(async () => [new Float32Array([1])]);
    const upsert = vi.fn(async () => {});
    const service = {
      settings: { searchMode: "bm25-only", encodeBatchSize: 8, upsertBatchSize: 8 },
      embeddingProvider: { ensureReady, encode },
      refreshSettingsSilently: () => {},
      vectorStore: { upsert },
    } as unknown as WorkspaceCodeRagService;
    const vocabulary = new BM25Vocabulary();
    vocabulary.register("chunk text");
    vocabulary.finalize();
    const chunks: PreparedChunk[] = [
      {
        id: "chunk-1",
        retrievalText: "chunk text",
        payload: {
          repoId: "repo",
          fileId: "file",
          path: "file.ts",
          language: "typescript",
          symbolName: "example",
          symbolType: "function",
          startLine: 1,
          endLine: 1,
          fileHash: "file-hash",
          chunkHash: "chunk-hash",
          chunkOrdinal: 0,
          chunkerVersion: "test",
          indexGeneration: "generation",
          isTest: false,
          isGenerated: false,
          content: "chunk text",
          indexedAt: new Date(0).toISOString(),
        },
      },
    ];

    await do_encodeAndUpsert(service, "collection", chunks, vocabulary, new AbortController().signal);

    expect(encode).not.toHaveBeenCalled();
    expect(ensureReady).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith("collection", [
      expect.objectContaining({ vectors: expect.not.objectContaining({ dense: expect.anything() }) }),
    ]);
  });
});
