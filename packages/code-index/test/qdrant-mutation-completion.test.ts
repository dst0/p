import { describe, expect, it, vi } from "vitest";
import type { VectorPoint } from "../src/rag/types.ts";
import { QdrantVectorStore } from "../src/rag/vector-store.ts";

const ACKNOWLEDGED_RESULT = { result: { operation_id: 9, status: "acknowledged" } };

function makePoint(): VectorPoint {
  return {
    id: "point-1",
    vectors: { dense: [0.1], sparse: { indices: [1], values: [1] } },
    payload: {
      repoId: "repo",
      fileId: "file",
      path: "source.ts",
      language: "typescript",
      symbolName: "value",
      symbolType: "variable",
      startLine: 1,
      endLine: 1,
      fileHash: "new-hash",
      chunkHash: "chunk-hash",
      chunkOrdinal: 0,
      chunkerVersion: "1",
      indexGeneration: "generation",
      isTest: false,
      isGenerated: false,
      content: "export const value = 1;",
      indexedAt: "2026-08-28T00:00:00.000Z",
    },
  };
}

describe("Qdrant mutation completion", () => {
  it("rejects an acknowledged but incomplete point upsert", async () => {
    const fetchImpl = vi.fn(async () => Response.json(ACKNOWLEDGED_RESULT));
    const store = new QdrantVectorStore({
      url: "http://localhost:6333",
      timeoutMs: 10_000,
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await expect(store.upsert("collection", [makePoint()])).rejects.toThrow("point upsert did not complete");
  });

  it("rejects an acknowledged but incomplete filtered deletion", async () => {
    const fetchImpl = vi.fn(async () => Response.json(ACKNOWLEDGED_RESULT));
    const store = new QdrantVectorStore({
      url: "http://localhost:6333",
      timeoutMs: 10_000,
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await expect(store.deleteFileVersions("collection", "repo", "file")).rejects.toThrow(
      "filtered point deletion did not complete",
    );
  });

  it("rejects an acknowledged but incomplete explicit-ID deletion", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/points/scroll")) {
        return Response.json({ result: { points: [{ id: "old-point", payload: { fileHash: "old-hash" } }] } });
      }
      return Response.json(ACKNOWLEDGED_RESULT);
    });
    const store = new QdrantVectorStore({
      url: "http://localhost:6333",
      timeoutMs: 10_000,
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await expect(store.deleteFileVersions("collection", "repo", "file", "new-hash")).rejects.toThrow(
      "point ID deletion did not complete",
    );
  });
});
