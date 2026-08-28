import { describe, expect, it, vi } from "vitest";
import type { StoredChunkPayload, VectorPoint } from "../src/index.ts";
import { QdrantVectorStore } from "../src/rag/vector-store.ts";

function makePayload(overrides: Partial<StoredChunkPayload> = {}): StoredChunkPayload {
  return {
    repoId: "test-repo",
    fileId: "file-id-1",
    path: "src/test.ts",
    language: "typescript",
    symbolName: "testFunc",
    symbolType: "function",
    startLine: 1,
    endLine: 3,
    fileHash: "abc123",
    chunkHash: "def456",
    chunkOrdinal: 0,
    chunkerVersion: "1.0",
    indexGeneration: "gen-1",
    isTest: false,
    isGenerated: false,
    content: "export function testFunc() { return true; }",
    indexedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePoint(id: string, payload: StoredChunkPayload): VectorPoint {
  return {
    id,
    vectors: {
      dense: [0.1, 0.2, 0.3],
      sparse: { indices: [0, 1], values: [1.0, 0.5] },
    },
    payload,
  };
}

function denseVector(value: number, dims: number = 3): Float32Array {
  return Float32Array.from({ length: dims }, () => value);
}

function createMockClient() {
  return {
    collectionExists: vi.fn().mockResolvedValue({ exists: false }),
    createCollection: vi.fn().mockResolvedValue(true),
    deleteCollection: vi.fn().mockResolvedValue(true),
    getCollection: vi.fn().mockResolvedValue({
      points_count: 0,
      config: { params: { vectors: { dense: { size: 3, distance: "Cosine" } } } },
    }),
    createPayloadIndex: vi.fn().mockResolvedValue(true),
    upsert: vi.fn().mockResolvedValue(true),
    search: vi.fn().mockResolvedValue([]),
    scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
    delete: vi.fn().mockResolvedValue(true),
  };
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const value of values) collected.push(value);
  return collected;
}

describe("QdrantVectorStore", () => {
  it("creates a collection with HNSW config, quantization, and payload indexes", async () => {
    const client = createMockClient();
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    await store.createCollection("test", 3);

    expect(client.createCollection).toHaveBeenCalledWith("test", {
      vectors: { dense: { size: 3, distance: "Cosine" } },
      sparse_vectors: { sparse: {} },
      on_disk_payload: true,
      hnsw_config: { m: 10, ef_construction: 128 },
      quantization_config: { scalar: { type: "int8" } },
    });

    expect(client.createPayloadIndex).toHaveBeenCalledWith("test", { field_name: "repoId", field_schema: "keyword" });
    expect(client.createPayloadIndex).toHaveBeenCalledWith("test", {
      field_name: "language",
      field_schema: "keyword",
    });
    expect(client.createPayloadIndex).toHaveBeenCalledWith("test", { field_name: "isTest", field_schema: "bool" });
    expect(client.createPayloadIndex).toHaveBeenCalledWith("test", {
      field_name: "isGenerated",
      field_schema: "bool",
    });
  });

  it("reuses an existing matching collection and backfills payload indexes", async () => {
    const client = createMockClient();
    client.collectionExists.mockResolvedValue({ exists: true });
    client.getCollection.mockResolvedValue({
      points_count: 10,
      config: { params: { vectors: { dense: { size: 3, distance: "Cosine" } } } },
    });
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    await store.createCollection("existing", 3);
    expect(client.createCollection).not.toHaveBeenCalled();
    expect(client.createPayloadIndex).toHaveBeenCalledTimes(5);
  });

  it("throws when existing collection has mismatched dimensions", async () => {
    const client = createMockClient();
    client.collectionExists.mockResolvedValue({ exists: true });
    client.getCollection.mockResolvedValue({
      points_count: 10,
      config: { params: { vectors: { dense: { size: 5, distance: "Cosine" } } } },
    });
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    await expect(store.createCollection("mismatch", 3)).rejects.toThrow("has 5 dimensions; expected 3");
  });

  it("deletes a collection only if it exists", async () => {
    const client = createMockClient();
    client.collectionExists.mockResolvedValue({ exists: true });
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    await store.deleteCollection("target");
    expect(client.deleteCollection).toHaveBeenCalledWith("target");
  });

  it("skips deleteCollection call when collection does not exist", async () => {
    const client = createMockClient();
    client.collectionExists.mockResolvedValue({ exists: false });
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    await store.deleteCollection("ghost");
    expect(client.deleteCollection).not.toHaveBeenCalled();
  });

  it("returns collection status with points and dimensions", async () => {
    const client = createMockClient();
    client.getCollection.mockResolvedValue({
      points_count: 42,
      config: { params: { vectors: { dense: { size: 768, distance: "Cosine" } } } },
    });
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    const status = await store.collectionStatus("stats");
    expect(status).toEqual({ points: 42, dimensions: 768 });
  });

  it("upserts points with correct payload mapping", async () => {
    const client = createMockClient();
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    const point = makePoint("p1", makePayload());
    await store.upsert("coll", [point]);

    expect(client.upsert).toHaveBeenCalledWith("coll", {
      wait: true,
      points: [{ id: "p1", vector: point.vectors, payload: point.payload }],
    });
  });

  it("skips upsert when points array is empty", async () => {
    const client = createMockClient();
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    await store.upsert("coll", []);
    expect(client.upsert).not.toHaveBeenCalled();
  });

  it("deletes all versions when keepFileHash is omitted", async () => {
    const client = createMockClient();
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    await store.deleteFileVersions("coll", "repo", "file1");

    expect(client.delete).toHaveBeenCalledWith("coll", {
      wait: true,
      filter: {
        must: [
          { key: "repoId", match: { value: "repo" } },
          { key: "fileId", match: { value: "file1" } },
        ],
      },
    });
  });

  it("scrolls stored points page by page with dense vectors", async () => {
    const client = createMockClient();
    const firstPayload = makePayload({ path: "src/first.ts" });
    const secondPayload = makePayload({ path: "src/second.ts" });
    client.scroll
      .mockResolvedValueOnce({
        points: [{ id: "point-1", payload: firstPayload, vector: { dense: [0.1, 0.2, 0.3] } }],
        next_page_offset: "point-1",
      })
      .mockResolvedValueOnce({
        points: [{ id: "point-2", payload: secondPayload, vector: { dense: [0.4, 0.5, 0.6] } }],
        next_page_offset: null,
      });
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    await expect(collect(store.iteratePoints("coll", "test-repo", true))).resolves.toEqual([
      { id: "point-1", payload: firstPayload, dense: [0.1, 0.2, 0.3] },
      { id: "point-2", payload: secondPayload, dense: [0.4, 0.5, 0.6] },
    ]);
    expect(client.scroll.mock.calls[0][1]).toEqual({
      limit: 256,
      filter: { must: [{ key: "repoId", match: { value: "test-repo" } }] },
      with_payload: true,
      with_vector: ["dense"],
    });
    expect(client.scroll.mock.calls[1][1]).toMatchObject({ offset: "point-1" });
  });

  it("scrolls payloads without requesting dense vectors", async () => {
    const client = createMockClient();
    const payload = makePayload();
    client.scroll.mockResolvedValueOnce({ points: [{ id: "point-1", payload }], next_page_offset: undefined });
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    await expect(collect(store.iteratePoints("coll", "test-repo", false))).resolves.toEqual([
      { id: "point-1", payload },
    ]);
    expect(client.scroll.mock.calls[0][1].with_vector).toBe(false);
  });

  it("cancels stored-point iteration before and between yielded points", async () => {
    const client = createMockClient();
    const payload = makePayload();
    client.scroll.mockResolvedValue({
      points: [
        { id: "point-1", payload },
        { id: "point-2", payload },
      ],
      next_page_offset: null,
    });
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    const alreadyAborted = AbortSignal.abort(new Error("already stopped"));
    await expect(collect(store.iteratePoints("coll", "test-repo", false, alreadyAborted))).rejects.toThrow(
      "already stopped",
    );
    expect(client.scroll).not.toHaveBeenCalled();

    const controller = new AbortController();
    const iterator = store.iteratePoints("coll", "test-repo", false, controller.signal)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ value: { id: "point-1" }, done: false });
    controller.abort(new Error("stopped between points"));
    await expect(iterator.next()).rejects.toThrow("stopped between points");
  });

  it("uses a default cancellation error when an aborted signal has no reason", async () => {
    const client = createMockClient();
    client.scroll.mockResolvedValue({
      points: [
        { id: "point-1", payload: makePayload() },
        { id: "point-2", payload: makePayload() },
      ],
      next_page_offset: null,
    });
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;
    const abortedWithoutReason = { aborted: true, reason: undefined } as AbortSignal;
    await expect(collect(store.iteratePoints("coll", "test-repo", false, abortedWithoutReason))).rejects.toThrow(
      "iteration cancelled",
    );

    let aborted = false;
    const signal = {
      get aborted() {
        return aborted;
      },
      reason: undefined,
    } as AbortSignal;
    const iterator = store.iteratePoints("coll", "test-repo", false, signal)[Symbol.asyncIterator]();
    await iterator.next();
    aborted = true;
    await expect(iterator.next()).rejects.toThrow("iteration cancelled");
  });

  it.each([
    ["non-string ID", { id: 1, payload: makePayload() }, false, "non-string ID"],
    ["missing payload", { id: "point-1" }, false, "invalid payload"],
    ["array payload", { id: "point-1", payload: [] }, false, "invalid payload"],
    [
      "invalid string payload field",
      { id: "point-1", payload: makePayload({ path: 1 as unknown as string }) },
      false,
      "invalid payload",
    ],
    [
      "invalid number payload field",
      { id: "point-1", payload: makePayload({ startLine: "1" as unknown as number }) },
      false,
      "invalid payload",
    ],
    [
      "invalid boolean payload field",
      { id: "point-1", payload: makePayload({ isTest: "false" as unknown as boolean }) },
      false,
      "invalid payload",
    ],
    ["missing named vectors", { id: "point-1", payload: makePayload() }, true, "invalid dense vector"],
    [
      "array vector container",
      { id: "point-1", payload: makePayload(), vector: [0.1, 0.2] },
      true,
      "invalid dense vector",
    ],
    [
      "non-array dense vector",
      { id: "point-1", payload: makePayload(), vector: { dense: "bad" } },
      true,
      "invalid dense vector",
    ],
    [
      "non-number dense vector value",
      { id: "point-1", payload: makePayload(), vector: { dense: [0.1, "bad"] } },
      true,
      "invalid dense vector",
    ],
    [
      "non-finite dense vector",
      { id: "point-1", payload: makePayload(), vector: { dense: [0.1, Number.NaN] } },
      true,
      "invalid dense vector",
    ],
  ])("rejects a stored point with %s", async (_case, point, withDense, expected) => {
    const client = createMockClient();
    client.scroll.mockResolvedValueOnce({ points: [point], next_page_offset: null });
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    await expect(collect(store.iteratePoints("coll", "test-repo", withDense))).rejects.toThrow(expected);
  });

  it("rejects a repeated scroll offset", async () => {
    const client = createMockClient();
    client.scroll
      .mockResolvedValueOnce({ points: [], next_page_offset: "same" })
      .mockResolvedValueOnce({ points: [], next_page_offset: "same" });
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    await expect(collect(store.iteratePoints("coll", "test-repo", false))).rejects.toThrow("repeated offset");
  });

  it("rejects malformed scroll pages and offsets", async () => {
    const client = createMockClient();
    client.scroll.mockResolvedValueOnce({ points: null, next_page_offset: null });
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;
    await expect(collect(store.iteratePoints("coll", "test-repo", false))).rejects.toThrow("invalid point page");

    client.scroll.mockResolvedValueOnce({ points: [], next_page_offset: { invalid: true } });
    await expect(collect(store.iteratePoints("coll", "test-repo", false))).rejects.toThrow("invalid offset");
  });

  it("performs dense and sparse search with RRF fusion", async () => {
    const client = createMockClient();
    const payload1 = makePayload({ path: "src/a.ts" });
    const payload2 = makePayload({ path: "src/b.ts" });
    client.search
      .mockResolvedValueOnce([
        { id: "dense-1", score: 0.9, payload: payload1 },
        { id: "dense-2", score: 0.8, payload: payload2 },
      ])
      .mockResolvedValueOnce([
        { id: "sparse-1", score: 0.85, payload: payload1 },
        { id: "sparse-3", score: 0.7, payload: makePayload({ path: "src/c.ts" }) },
      ]);
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    const results = await store.search(
      "coll",
      denseVector(0.1),
      { indices: [0], values: [1.0] },
      { repoId: "test-repo", includeTests: true, includeGenerated: true },
      10,
    );

    // Dense call should include quantization params
    expect(client.search.mock.calls[0][1].params).toMatchObject({
      hnsw_ef: 60,
      quantization: { rescore: true },
    });
    // Sparse call should include hnsw_ef but not quantization
    expect(client.search.mock.calls[1][1].params).toEqual({ hnsw_ef: 60 });

    // RRF fusion: both dense-1 and sparse-1 have same id (payload1), so dense-1 should rank highest
    expect(results[0].id).toBe("dense-1");
    // dense-2 and sparse-3 should also be present
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("handles empty sparse vector by skipping sparse search", async () => {
    const client = createMockClient();
    const payload = makePayload();
    client.search.mockResolvedValueOnce([{ id: "dense-only", score: 0.9, payload }]);
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    const results = await store.search(
      "coll",
      denseVector(0.1),
      { indices: [], values: [] },
      { repoId: "test-repo", includeTests: true, includeGenerated: true },
      10,
    );

    expect(client.search).toHaveBeenCalledTimes(1); // Only dense, no sparse
    expect(results[0].id).toBe("dense-only");
  });

  it("filters search results by languages, isTest, and isGenerated", async () => {
    const client = createMockClient();
    const payload = makePayload();
    client.search.mockResolvedValueOnce([{ id: "1", score: 0.9, payload }]);
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    await store.search(
      "coll",
      denseVector(0.1),
      { indices: [], values: [] },
      { repoId: "test-repo", languages: ["python"], includeTests: false, includeGenerated: false },
      5,
    );

    const callArgs = client.search.mock.calls[0][1];
    // Language filter
    expect(callArgs.filter.must).toContainEqual({ key: "language", match: { any: ["python"] } });
    // Exclude tests
    expect(callArgs.filter.must_not).toContainEqual({ key: "isTest", match: { value: true } });
    // Exclude generated
    expect(callArgs.filter.must_not).toContainEqual({ key: "isGenerated", match: { value: true } });
  });

  it("creates search filter with only repoId when no other filters", async () => {
    const client = createMockClient();
    const payload = makePayload();
    client.search.mockResolvedValueOnce([{ id: "1", score: 0.9, payload }]);
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    await store.search(
      "coll",
      denseVector(0.1),
      { indices: [], values: [] },
      { repoId: "test-repo", includeTests: true, includeGenerated: true },
      5,
    );

    const callArgs = client.search.mock.calls[0][1];
    expect(callArgs.filter.must).toHaveLength(1);
    expect(callArgs.filter.must[0]).toEqual({ key: "repoId", match: { value: "test-repo" } });
    expect(callArgs.filter.must_not).toBeUndefined();
  });

  it("rolls back a new collection when payload index creation fails", async () => {
    const client = createMockClient();
    client.createPayloadIndex.mockRejectedValueOnce(new Error("permission denied"));
    client.deleteCollection.mockRejectedValueOnce(new Error("rollback failed"));
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    // @ts-expect-error — replacing private field for testing
    store.client = client;

    await expect(store.createCollection("test-index-failure", 3)).rejects.toThrow("permission denied");
    expect(client.deleteCollection).toHaveBeenCalledWith("test-index-failure");
    expect(client.createPayloadIndex).toHaveBeenCalledOnce();
  });

  it("handles FetchQdrantRestClient HTTP errors and response parsing failures", async () => {
    // Network failure
    const storeNetworkErr = new QdrantVectorStore({
      url: "http://localhost:6333",
      timeoutMs: 1000,
      fetch: async () => {
        throw new Error("Network unreachable");
      },
    });
    await expect(storeNetworkErr.collectionExists("test")).rejects.toThrow("failed: Network unreachable");

    const storeNonError = new QdrantVectorStore({
      url: "http://localhost:6333",
      timeoutMs: 1000,
      fetch: async () => Promise.reject("offline"),
    });
    await expect(storeNonError.collectionExists("test")).rejects.toThrow("failed: offline");

    // HTTP 500 status
    const storeHttpErr = new QdrantVectorStore({
      url: "http://localhost:6333",
      timeoutMs: 1000,
      fetch: async () => new Response("Internal Qdrant Error", { status: 500 }),
    });
    await expect(storeHttpErr.collectionExists("test")).rejects.toThrow("HTTP 500");

    // Invalid JSON response
    const storeJsonErr = new QdrantVectorStore({
      url: "http://localhost:6333",
      timeoutMs: 1000,
      fetch: async () => new Response("not valid json {{", { status: 200 }),
    });
    await expect(storeJsonErr.collectionExists("test")).rejects.toThrow("invalid JSON");

    // Response missing 'result' field
    const storeNoResultErr = new QdrantVectorStore({
      url: "http://localhost:6333",
      timeoutMs: 1000,
      fetch: async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    });
    await expect(storeNoResultErr.collectionExists("test")).rejects.toThrow("without a result");
  });

  it("exercises FetchQdrantRestClient success methods over mock fetch", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/exists"))
        return new Response(JSON.stringify({ result: { exists: !u.includes("new-coll") } }), { status: 200 });
      if (u.includes("/points/search"))
        return new Response(JSON.stringify({ result: [{ id: "p1", payload: {} }] }), { status: 200 });
      if (u.includes("/points/scroll"))
        return new Response(
          JSON.stringify({
            result: { points: [{ id: "p1", payload: makePayload(), vector: { dense: [0.1, 0.2, 0.3] } }] },
          }),
          { status: 200 },
        );
      if (u.includes("/points/delete"))
        return new Response(JSON.stringify({ result: { status: "completed" } }), { status: 200 });
      if (u.includes("/points?wait="))
        return new Response(JSON.stringify({ result: { status: "completed" } }), { status: 200 });
      if (u.includes("/index"))
        return new Response(JSON.stringify({ result: { status: "completed" } }), { status: 200 });
      if (init?.method === "GET") {
        return new Response(
          JSON.stringify({
            result: { points_count: 10, config: { params: { vectors: { dense: { size: 3 } } } } },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ result: { status: "ok" } }), { status: 200 });
    });

    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 5000, fetch: mockFetch });

    // 1. collectionExists
    expect(await store.collectionExists("coll1")).toBe(true);

    // 2. createCollection when collection exists and dimensions match
    await store.createCollection("coll1", 3);
    await store.createCollection("new-coll", 3);

    // 3. collectionStatus
    const status = await store.collectionStatus("coll1");
    expect(status).toEqual({ points: 10, dimensions: 3 });

    // 4. createPayloadIndexes
    await store.createPayloadIndexes("coll1");

    // 5. upsert
    const payload = makePayload();
    await store.upsert("coll1", [makePoint("p1", payload)]);

    // 6. deleteFileVersions
    await store.deleteFileVersions("coll1", "repo1", "file1", "hash1");

    // 7. search
    const results = await store.search(
      "coll1",
      denseVector(0.1),
      { indices: [0], values: [1.0] },
      { repoId: "repo1", includeTests: true, includeGenerated: true },
      5,
    );
    expect(results.length).toBeGreaterThanOrEqual(1);

    // 8. scroll with an external cancellation signal
    const controller = new AbortController();
    const stored = await collect(store.iteratePoints("coll1", "repo1", true, controller.signal));
    expect(stored).toHaveLength(1);

    // 9. deleteCollection
    await store.deleteCollection("coll1");
  });

  describe("error handling and edge cases", () => {
    it("throws if request returns missing or non-object result", async () => {
      // Create a store with a mock fetch
      const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
      const client = (store as any).client;

      // Mock fetchImpl to return invalid result structure
      client.fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ not_result: true })),
      });
      await expect(client.collectionExists("test")).rejects.toThrow("without a result");

      client.fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ result: [1, 2, 3] })), // Wait, Array.isArray(decoded) checks decoded, not result!
      });
      // the check is `!decoded || typeof decoded !== "object" || Array.isArray(decoded) || !("result" in decoded)`
      client.fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify([1, 2, 3])), // decoded is an array
      });
      await expect(client.collectionExists("test")).rejects.toThrow("without a result");
    });

    it("throws if createCollection dimensions mismatch", async () => {
      const client = createMockClient();
      const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
      (store as any).client = client;

      client.collectionExists.mockResolvedValueOnce({ exists: true });
      client.getCollection.mockResolvedValueOnce({
        points_count: 5,
        config: { params: { vectors: { dense: { size: "unknown_size" } } } },
      });

      await expect(store.createCollection("test", 1024)).rejects.toThrow("unknown dimensions; expected 1024");
    });

    it("handles parsing dimensions from missing/array configs", async () => {
      const client = createMockClient();
      const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
      (store as any).client = client;

      // vectors is array
      client.getCollection.mockResolvedValueOnce({ config: { params: { vectors: [] } } });
      let status = await store.collectionStatus("test");
      expect(status.dimensions).toBeUndefined();

      // dense is array
      client.getCollection.mockResolvedValueOnce({ config: { params: { vectors: { dense: [] } } } });
      status = await store.collectionStatus("test");
      expect(status.dimensions).toBeUndefined();

      // dense.size is string
      client.getCollection.mockResolvedValueOnce({ config: { params: { vectors: { dense: { size: "512" } } } } });
      status = await store.collectionStatus("test");
      expect(status.dimensions).toBeUndefined();
    });

    it("search handles points without payloads", async () => {
      const client = createMockClient();
      const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
      (store as any).client = client;

      // Mock search to return points with missing payloads
      client.search.mockResolvedValueOnce([{ id: "point-1", score: 0.9, payload: undefined }]);
      client.search.mockResolvedValueOnce([
        { id: "point-1", score: 0.8, payload: undefined }, // sparse
      ]);

      const results = await store.search(
        "test",
        denseVector(0.1),
        { indices: [0], values: [1] },
        { repoId: "repo1", includeTests: true, includeGenerated: true },
        5,
      );
      expect(results.length).toBe(0); // Filters out points without payloads
    });
  });
});
