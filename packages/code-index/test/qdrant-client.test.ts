import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../src/config.ts";
import { QdrantClient } from "../src/qdrant.ts";
import type { ChunkPayload } from "../src/types.ts";

function makeChunkPayload(overrides: Partial<ChunkPayload> = {}): ChunkPayload {
  return {
    workspace: "test-workspace",
    repo: "repo-1",
    repoPath: "repo-1",
    path: "src/file.ts",
    absPath: "/abs/src/file.ts",
    language: "typescript",
    symbol: "testFn",
    chunkType: "function",
    startLine: 1,
    endLine: 10,
    fileHash: "fh1",
    chunkHash: "ch1",
    branch: "main",
    commit: "c1",
    lastIndexed: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("QdrantClient wrapper", () => {
  let rawClientMock: {
    deleteCollection: ReturnType<typeof vi.fn>;
    createCollection: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    getCollection: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    rawClientMock = {
      deleteCollection: vi.fn().mockResolvedValue(true),
      createCollection: vi.fn().mockResolvedValue(true),
      upsert: vi.fn().mockResolvedValue(true),
      getCollection: vi.fn().mockResolvedValue({
        points_count: 50,
        indexed_vectors_count: 50,
        segments_count: 2,
        config: { params: { vectors: { size: 1024 }, sparse_vectors: {} } },
      }),
      delete: vi.fn().mockResolvedValue(true),
      search: vi.fn().mockResolvedValue([]),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createCollection deletes old collection if present and creates new", async () => {
    const config = createConfig();
    const qdrant = new QdrantClient(config);
    // @ts-expect-error replace underlying raw client
    qdrant.client = rawClientMock;

    await qdrant.createCollection();

    expect(rawClientMock.deleteCollection).toHaveBeenCalledWith(config.collection);
    expect(rawClientMock.createCollection).toHaveBeenCalledWith(config.collection, {
      vectors: { size: config.denseDim, distance: "Cosine" },
      sparse_vectors: { sparse: {} },
      optimizers_config: { default_segment_number: 4, indexing_threshold: 10000 },
    });
  });

  it("createCollection catches deleteCollection error when collection does not exist", async () => {
    rawClientMock.deleteCollection.mockRejectedValueOnce(new Error("Collection not found"));
    const config = createConfig();
    const qdrant = new QdrantClient(config);
    // @ts-expect-error replace underlying raw client
    qdrant.client = rawClientMock;

    await expect(qdrant.createCollection()).resolves.toBeUndefined();
    expect(rawClientMock.createCollection).toHaveBeenCalled();
  });

  it("upsertBatch formats points correctly", async () => {
    const config = createConfig();
    const qdrant = new QdrantClient(config);
    // @ts-expect-error replace underlying raw client
    qdrant.client = rawClientMock;

    const payload = makeChunkPayload();
    await qdrant.upsertBatch([
      {
        id: 123,
        vectors: { dense: [0.1, 0.2], sparse: { indices: [0], values: [1.0] } },
        payload,
      },
    ]);

    expect(rawClientMock.upsert).toHaveBeenCalledWith(config.collection, {
      wait: true,
      points: [
        {
          id: 123,
          vector: { dense: [0.1, 0.2], sparse: { indices: [0], values: [1.0] } },
          payload: payload as unknown as Record<string, unknown>,
        },
      ],
    });
  });

  it("getStatus parses vectorsConfig as number, object with size, object with dense, or missing", async () => {
    const config = createConfig();
    const qdrant = new QdrantClient(config);
    // @ts-expect-error replace underlying raw client
    qdrant.client = rawClientMock;

    // Case 1: vectors is an object with size as number
    rawClientMock.getCollection.mockResolvedValueOnce({
      points_count: 10,
      indexed_vectors_count: 10,
      segments_count: 1,
      config: { params: { vectors: { size: 1024 }, sparse_vectors: {} } },
    });
    let status = await qdrant.getStatus();
    expect(status.vectorDim).toBe(1024);

    // Case 2: vectors is object with dense: { size: 512 }
    rawClientMock.getCollection.mockResolvedValueOnce({
      points_count: 20,
      indexed_vectors_count: 20,
      segments_count: 1,
      config: { params: { vectors: { dense: { size: 512 } }, sparse_vectors: {} } },
    });
    status = await qdrant.getStatus();
    expect(status.vectorDim).toBe(512);

    // Case 3: vectors is missing or invalid size
    rawClientMock.getCollection.mockResolvedValueOnce({
      points_count: 0,
      config: { params: {} },
    });
    status = await qdrant.getStatus();
  });

  it("handles named vectors config in collection status", async () => {
    rawClientMock.getCollection.mockResolvedValueOnce({
      status: "green",
      points_count: 50,
      indexed_vectors_count: 50,
      segments_count: 2,
      config: {
        params: {
          vectors: {
            dense: { size: 768 },
          },
          sparse_vectors: { sparse: {} },
        },
      },
    });

    const config = createConfig();
    const client = new QdrantClient(config);
    (client as any).client = rawClientMock;
    const status = await client.getStatus();

    expect(status.vectorDim).toBe(768);
    expect(status.sparseVectors).toBe(true);
  });

  it("deleteRepo sends correct filter to qdrant", async () => {
    const config = createConfig();
    const qdrant = new QdrantClient(config);
    // @ts-expect-error replace underlying raw client
    qdrant.client = rawClientMock;

    await qdrant.deleteRepo("my-repo");

    expect(rawClientMock.delete).toHaveBeenCalledWith(config.collection, {
      wait: true,
      filter: {
        must: [{ key: "repo", match: { value: "my-repo" } }],
      },
    });
  });

  it("search combines dense and sparse results with RRF scoring", async () => {
    const config = createConfig();
    const qdrant = new QdrantClient(config);
    // @ts-expect-error replace underlying raw client
    qdrant.client = rawClientMock;

    const payload1 = makeChunkPayload({ path: "src/a.ts" });
    const payload2 = makeChunkPayload({ path: "src/b.ts" });

    const payload3 = makeChunkPayload({ path: "src/c.ts" });

    rawClientMock.search
      .mockResolvedValueOnce([
        { id: 1, payload: payload1 },
        { id: 2, payload: payload2 },
      ])
      .mockResolvedValueOnce([
        { id: 1, payload: payload1 },
        { id: 3, payload: payload3 },
      ]);

    const results = await qdrant.search(new Float32Array([0.1, 0.2]), { indices: [0], values: [1] }, 2);

    expect(results.length).toBe(2);
    // Result 1 matched in both dense and sparse, so higher RRF score
    expect(results[0].id).toBe(1);
  });

  it("searchDense queries dense vectors only", async () => {
    const config = createConfig();
    const qdrant = new QdrantClient(config);
    // @ts-expect-error replace underlying raw client
    qdrant.client = rawClientMock;

    const payload = makeChunkPayload();
    rawClientMock.search.mockResolvedValueOnce([{ id: 10, score: 0.92, payload }]);

    const results = await qdrant.searchDense([0.1, 0.2], 5);

    expect(rawClientMock.search).toHaveBeenCalledWith(config.collection, {
      vector: { name: "dense", vector: [0.1, 0.2] },
      limit: 5,
      with_payload: true,
    });
    expect(results).toEqual([{ id: 10, score: 0.92, payload }]);
  });

  it("initializes with qdrantApiKey in IndexConfig", () => {
    const configWithoutKey = createConfig();
    const qdrantWithoutKey = new QdrantClient(configWithoutKey);
    // @ts-expect-error inspect raw client private property
    expect(qdrantWithoutKey.client._https).toBe(false);

    const configWithKey = createConfig({ qdrantApiKey: "custom-api-key-test" });
    const qdrantWithKey = new QdrantClient(configWithKey);
    // @ts-expect-error inspect raw client private property
    expect(qdrantWithKey.client._https).toBe(true);
    // @ts-expect-error config check
    expect(qdrantWithKey.config.qdrantApiKey).toBe("custom-api-key-test");
  });
});
