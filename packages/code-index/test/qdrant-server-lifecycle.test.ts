import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { QdrantServerManager } from "../src/embed/qdrant-server.ts";
import { QdrantClient } from "../src/qdrant.ts";

describe("qdrant server manager lifecycle and client batching", () => {
  it("handles missing vectorsConfig dense and size properties in getStatus", async () => {
    const client = new QdrantClient({
      qdrantUrl: "http://127.0.0.1:6333",
      collection: "test-coll",
      batchSize: 0,
    } as unknown as ConstructorParameters<typeof QdrantClient>[0]);
    const mockGetCollection = vi.fn().mockResolvedValue({
      points_count: 5,
      indexed_vectors_count: 5,
      segments_count: 1,
      config: {
        params: {
          vectors: {},
          sparse_vectors: { bm25: {} },
        },
      },
    });
    (client as unknown as { client: { getCollection: typeof mockGetCollection } }).client = {
      getCollection: mockGetCollection,
    };

    const status = await client.getStatus();
    expect(status.vectorDim).toBe("?");
    expect(status.sparseVectors).toBe(true);
  });

  it("uses default batch size of 8 when batchSize is 0 in upsertBatch", async () => {
    const client = new QdrantClient({
      qdrantUrl: "http://127.0.0.1:6333",
      collection: "test-coll",
      batchSize: 0,
    } as unknown as ConstructorParameters<typeof QdrantClient>[0]);
    const mockUpsert = vi.fn().mockResolvedValue({ status: "completed" });
    (client as unknown as { client: { upsert: typeof mockUpsert } }).client = { upsert: mockUpsert };

    const points = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      vectors: { dense: [0.1, 0.2], sparse: { indices: [1], values: [1.0] } },
      payload: {
        repo: "repo",
        path: "f.ts",
        startLine: 1,
        endLine: 5,
        symbol: "",
        chunkType: "function" as const,
        hash: "h",
      } as unknown as Parameters<typeof client.upsertBatch>[0][0]["payload"],
    }));

    await client.upsertBatch(points);
    expect(mockUpsert).toHaveBeenCalledTimes(2); // 8 + 2
  });

  it("handles empty saved qdrant.key file gracefully and generates 64-char key", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-qdrant-empty-key-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "qdrant.key"), "  \n");
      const mgr = new QdrantServerManager(6333, { dataDirectory: tmpDir });
      const key = mgr.getApiKey();
      expect(key).toBeDefined();
      expect(key?.length).toBe(64);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles checkHealth receiving non-ok HTTP responses", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("Service Unavailable", { status: 503 }));
    try {
      const mgr = new QdrantServerManager(9999, { dataDirectory: "/tmp" });
      const isHealthy = await (mgr as unknown as { checkHealth(): Promise<boolean> }).checkHealth();
      expect(isHealthy).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
