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
		delete: vi.fn().mockResolvedValue(true),
	};
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

	it("skips creation when collection already exists with matching dimensions", async () => {
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

	it("deletes file versions with keepFileHash filter", async () => {
		const client = createMockClient();
		const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
		// @ts-expect-error — replacing private field for testing
		store.client = client;

		await store.deleteFileVersions("coll", "repo", "file1", "keep-hash");

		expect(client.delete).toHaveBeenCalledWith("coll", {
			wait: true,
			filter: {
				must: [
					{ key: "repoId", match: { value: "repo" } },
					{ key: "fileId", match: { value: "file1" } },
				],
				must_not: [{ key: "fileHash", match: { value: "keep-hash" } }],
			},
		});
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

	it("treats payload index creation as best-effort", async () => {
		const client = createMockClient();
		client.createPayloadIndex.mockRejectedValueOnce(new Error("already exists"));
		const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
		// @ts-expect-error — replacing private field for testing
		store.client = client;

		// Should not throw even if a payload index creation fails
		await expect(store.createCollection("test-best-effort", 3)).resolves.toBeUndefined();
		// Other indexes should still be attempted
		expect(client.createPayloadIndex).toHaveBeenCalledTimes(4);
	});
});
