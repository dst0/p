import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../src/embed/provider.ts";
import {
	type IndexingProgress,
	type RagVectorStore,
	type SparseVector,
	type VectorPoint,
	type VectorSearchFilters,
	type VectorSearchResult,
	WorkspaceCodeRagService,
} from "../src/index.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

class FakeEmbeddingProvider implements EmbeddingProvider {
	dim = 3;
	encodedTexts: string[] = [];
	onEncode: (() => void) | undefined;

	async encode(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
		if (signal?.aborted) throw signal.reason;
		const onEncode = this.onEncode;
		this.onEncode = undefined;
		onEncode?.();
		this.encodedTexts.push(...texts);
		return texts.map((text) => vectorFor(text));
	}

	async encodeQuery(text: string, signal?: AbortSignal): Promise<Float32Array> {
		if (signal?.aborted) throw signal.reason;
		return vectorFor(text);
	}
}

class FakeVectorStore implements RagVectorStore {
	collections = new Map<string, Map<string, VectorPoint>>();
	dimensions = new Map<string, number>();
	failNextUpsert = false;
	createdCollections: string[] = [];
	deletedCollections: string[] = [];

	async collectionExists(collection: string): Promise<boolean> {
		return this.collections.has(collection);
	}

	async createCollection(collection: string, denseDimensions: number): Promise<void> {
		if (!this.collections.has(collection)) {
			this.collections.set(collection, new Map());
			this.dimensions.set(collection, denseDimensions);
			this.createdCollections.push(collection);
		}
	}

	async deleteCollection(collection: string): Promise<void> {
		this.collections.delete(collection);
		this.dimensions.delete(collection);
		this.deletedCollections.push(collection);
	}

	async collectionStatus(collection: string): Promise<{ points: number; dimensions: number | undefined }> {
		const points = this.collections.get(collection);
		if (!points) throw new Error(`Collection not found: ${collection}`);
		return { points: points.size, dimensions: this.dimensions.get(collection) };
	}

	async upsert(collection: string, points: VectorPoint[]): Promise<void> {
		if (this.failNextUpsert) {
			this.failNextUpsert = false;
			throw new Error("synthetic upsert failure");
		}
		const target = this.collections.get(collection);
		if (!target) throw new Error(`Collection not found: ${collection}`);
		for (const point of points) target.set(point.id, point);
	}

	async deleteFileVersions(collection: string, repoId: string, fileId: string, keepFileHash?: string): Promise<void> {
		const target = this.collections.get(collection);
		if (!target) throw new Error(`Collection not found: ${collection}`);
		for (const [id, point] of target) {
			if (
				point.payload.repoId === repoId &&
				point.payload.fileId === fileId &&
				(!keepFileHash || point.payload.fileHash !== keepFileHash)
			) {
				target.delete(id);
			}
		}
	}

	async search(
		collection: string,
		_dense: Float32Array,
		_sparse: SparseVector,
		filters: VectorSearchFilters,
		limit: number,
	): Promise<VectorSearchResult[]> {
		const target = this.collections.get(collection);
		if (!target) throw new Error(`Collection not found: ${collection}`);
		return [...target.values()]
			.filter((point) => point.payload.repoId === filters.repoId)
			.filter((point) => !filters.languages || filters.languages.includes(point.payload.language))
			.filter((point) => filters.includeTests || !point.payload.isTest)
			.filter((point) => filters.includeGenerated || !point.payload.isGenerated)
			.slice(0, limit)
			.map((point, index) => ({ id: point.id, score: 1 - index / 100, payload: point.payload }));
	}

	allContents(): string[] {
		return [...this.collections.values()].flatMap((collection) =>
			[...collection.values()].map((point) => point.payload.content),
		);
	}
}

function vectorFor(text: string): Float32Array {
	return new Float32Array([text.length % 7, text.length % 11, text.length % 13]);
}

function createFixture(): { root: string; data: string } {
	const directory = mkdtempSync(join(tmpdir(), "p-code-rag-"));
	temporaryDirectories.push(directory);
	const root = join(directory, "repo");
	const data = join(directory, "data");
	mkdirSync(root);
	writeFileSync(join(root, "main.ts"), "export function initializeAuth() {\n\treturn 'unique-auth-token';\n}\n");
	return { root, data };
}

function createService(
	root: string,
	data: string,
	embeddingProvider: FakeEmbeddingProvider,
	vectorStore: FakeVectorStore,
	options: { embeddingModel?: string; allowSearchRefresh?: boolean } = {},
): WorkspaceCodeRagService {
	return new WorkspaceCodeRagService({
		workspaceRoot: root,
		dataDirectory: data,
		embeddingProvider,
		vectorStore,
		allowSearchRefresh: options.allowSearchRefresh,
		settings: {
			enabled: true,
			autoRefresh: false,
			embeddingDimensions: 3,
			embeddingModel: options.embeddingModel ?? "test-embedding-v1",
			fullSparseRebuildChangeRatio: 1,
		},
	});
}

describe("WorkspaceCodeRagService", () => {
	it("builds an isolated generation and returns source-located snippets", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);

		const summary = await service.rebuild();
		expect(summary.fullRebuild).toBe(true);
		expect(summary.status.state).toBe("ready");
		expect(summary.status.indexedFiles).toBe(1);
		expect(summary.status.indexedChunks).toBe(1);
		expect(summary.status.collection).toContain(summary.status.repoId.slice(0, 16));

		const response = await service.search({ query: "authentication initialization", freshness: "allow_stale" });
		expect(response.results[0]).toMatchObject({ path: "main.ts", startLine: 1, endLine: 3 });
		expect(response.results[0].content).toContain("unique-auth-token");
		await service.dispose();
	});

	it("performs no embedding on a no-change refresh and only embeds a changed file", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		await service.rebuild();
		const initialEmbeddings = embedding.encodedTexts.length;

		const noChange = await service.refresh();
		expect(noChange.chunksEmbedded).toBe(0);
		expect(embedding.encodedTexts).toHaveLength(initialEmbeddings);

		writeFileSync(
			join(root, "main.ts"),
			"export function initializeAuth() {\n\treturn 'replacement-auth-token';\n}\n",
		);
		const changed = await service.refresh();
		expect(changed.fullRebuild).toBe(false);
		expect(changed.filesChanged).toBe(1);
		expect(changed.chunksEmbedded).toBe(1);
		expect(store.allContents().join("\n")).toContain("replacement-auth-token");
		expect(store.allContents().join("\n")).not.toContain("unique-auth-token");
	});

	it("indexes the latest stable contents when a changed file changes again during refresh", async () => {
		const { root, data } = createFixture();
		const secondPath = join(root, "second.ts");
		writeFileSync(secondPath, "export const second = 'initial';\n");
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		await service.rebuild();

		writeFileSync(join(root, "main.ts"), "export const first = 'changed';\n");
		writeFileSync(secondPath, "export const second = 'intermediate';\n");
		embedding.onEncode = () => writeFileSync(secondPath, "export const second = 'latest';\n");

		const summary = await service.refresh();
		expect(summary.fullRebuild).toBe(false);
		expect(summary.filesChanged).toBe(2);
		expect(store.allContents().join("\n")).toContain("second = 'latest'");
		expect(store.allContents().join("\n")).not.toContain("second = 'intermediate'");
		expect((await service.status()).state).toBe("ready");
	});

	it("reports monotonic progress for full and incremental indexing", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		const rebuildProgress: IndexingProgress[] = [];

		await service.rebuild({ onProgress: (progress) => rebuildProgress.push(progress) });
		expect(rebuildProgress[0]).toMatchObject({ phase: "scanning", percent: 0 });
		expect(rebuildProgress.at(-1)).toMatchObject({ phase: "finalizing", percent: 100 });
		expect(
			rebuildProgress.every(
				(progress, index) => index === 0 || progress.percent >= rebuildProgress[index - 1].percent,
			),
		).toBe(true);

		writeFileSync(join(root, "main.ts"), "export const replacement = 'changed';\n");
		const refreshProgress: IndexingProgress[] = [];
		await service.refresh({ onProgress: (progress) => refreshProgress.push(progress) });
		expect(refreshProgress[0]).toMatchObject({ phase: "scanning", percent: 0 });
		expect(refreshProgress.at(-1)).toMatchObject({ phase: "finalizing", percent: 100 });
		expect(refreshProgress.some((progress) => progress.phase === "indexing" && progress.percent > 0.1)).toBe(true);
		expect(
			refreshProgress.every(
				(progress, index) => index === 0 || progress.percent >= refreshProgress[index - 1].percent,
			),
		).toBe(true);
	});

	it("removes deleted files and keeps repositories with the same basename isolated", async () => {
		const first = createFixture();
		const secondParent = mkdtempSync(join(tmpdir(), "p-code-rag-second-"));
		temporaryDirectories.push(secondParent);
		const secondRoot = join(secondParent, "repo");
		mkdirSync(secondRoot);
		writeFileSync(join(secondRoot, "main.ts"), "export const otherRepository = true;\n");
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const firstService = createService(first.root, first.data, embedding, store);
		const secondService = createService(secondRoot, first.data, embedding, store);
		await firstService.rebuild();
		await secondService.rebuild();
		const firstStatus = await firstService.status();
		const secondStatus = await secondService.status();
		expect(firstStatus.repoId).not.toBe(secondStatus.repoId);
		expect(firstStatus.collection).not.toBe(secondStatus.collection);

		rmSync(join(first.root, "main.ts"));
		const deleted = await firstService.refresh();
		expect(deleted.filesDeleted).toBe(1);
		const response = await firstService.search({ query: "unique auth", freshness: "allow_stale" });
		expect(response.results).toEqual([]);
	});

	it("preserves the prior generation when a rebuild fails", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		await service.rebuild();
		const priorStatus = await service.status();
		store.failNextUpsert = true;
		await expect(service.rebuild()).rejects.toThrow("synthetic upsert failure");
		const failedStatus = await service.status();
		expect(failedStatus.state).toBe("partial");
		expect(failedStatus.collection).toBe(priorStatus.collection);
		expect(store.collections.has(priorStatus.collection!)).toBe(true);
		expect(store.deletedCollections).toHaveLength(1);
	});

	it("marks an embedding model change incompatible and rebuilds into a new generation", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const firstService = createService(root, data, embedding, store, { embeddingModel: "model-a" });
		await firstService.rebuild();
		const firstCollection = (await firstService.status()).collection;
		const secondService = createService(root, data, embedding, store, { embeddingModel: "model-b" });
		const initialized = await secondService.initialize();
		expect(initialized.state).toBe("stale");
		expect(initialized.lastError?.code).toBe("RAG_INCOMPATIBLE_INDEX");
		const rebuilt = await secondService.refresh();
		expect(rebuilt.fullRebuild).toBe(true);
		expect(rebuilt.status.collection).not.toBe(firstCollection);
	});

	it("rebuilds when the persisted Qdrant collection is missing", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const original = createService(root, data, embedding, store);
		await original.rebuild();
		const originalCollection = (await original.status()).collection!;
		await original.dispose();
		await store.deleteCollection(originalCollection);

		const recovered = createService(root, data, embedding, store);
		const stale = await recovered.initialize();
		expect(stale).toMatchObject({
			state: "stale",
			lastError: { code: "RAG_INCOMPATIBLE_INDEX", message: "Qdrant collection is missing" },
		});
		const rebuilt = await recovered.refresh();
		expect(rebuilt.fullRebuild).toBe(true);
		expect(rebuilt.status.collection).not.toBe(originalCollection);
		const response = await recovered.search({ query: "authentication initialization", freshness: "allow_stale" });
		expect(response.results[0]?.content).toContain("unique-auth-token");
		await recovered.dispose();
	});

	it("reloads a newer manifest written by another service before searching", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const writer = createService(root, data, embedding, store);
		await writer.rebuild();
		const reader = createService(root, data, embedding, store);
		const originalCollection = (await reader.initialize()).collection;

		writeFileSync(join(root, "main.ts"), "export const replacementGeneration = 'manifest-reload-proof';\n");
		const rebuilt = await writer.rebuild();
		expect(rebuilt.status.collection).not.toBe(originalCollection);
		expect(store.collections.has(originalCollection!)).toBe(false);

		const response = await reader.search({ query: "replacement generation", freshness: "allow_stale" });
		expect(response.status.collection).toBe(rebuilt.status.collection);
		expect(response.results[0]?.content).toContain("manifest-reload-proof");
		await writer.dispose();
		await reader.dispose();
	});

	it("does not launch a local Qdrant for an explicitly allowed remote backend", async () => {
		const { root, data } = createFixture();
		const service = new WorkspaceCodeRagService({
			workspaceRoot: root,
			dataDirectory: data,
			settings: {
				remoteBackendsAllowed: true,
				qdrantUrl: "https://qdrant.example.test:6333",
			},
		});

		await expect(service.initialize()).resolves.toMatchObject({ state: "not_initialized" });
		await service.dispose();
	});
});

describe("discovery security", () => {
	it("excludes secrets, binaries, and symlinks while allowing environment samples", async () => {
		const { root, data } = createFixture();
		writeFileSync(join(root, ".env"), "REAL_SECRET=do-not-index\n");
		writeFileSync(join(root, ".env.example"), "SAFE_PLACEHOLDER=example\n");
		writeFileSync(join(root, "private.pem"), "private-key-material\n");
		writeFileSync(join(root, "binary.dat"), Buffer.from([0, 1, 2, 3]));
		const outside = join(root, "..", "outside.ts");
		writeFileSync(outside, "export const outsideSecret = true;\n");
		symlinkSync(outside, join(root, "outside-link.ts"));
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		await service.rebuild();
		const contents = store.allContents().join("\n");
		expect(contents).toContain("SAFE_PLACEHOLDER");
		expect(contents).not.toContain("REAL_SECRET");
		expect(contents).not.toContain("private-key-material");
		expect(contents).not.toContain("outsideSecret");
		const manifestPath = join(data, (await service.status()).repoId, "manifest.json");
		expect(readFileSync(manifestPath, "utf-8")).not.toContain("outside-link.ts");
	});
});

describe("search validation and edge cases", () => {
	it("throws for empty query", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		await service.rebuild();
		await expect(service.search({ query: "   " })).rejects.toThrow("must not be empty");
		await service.dispose();
	});

	it("throws for unknown language filter", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		await service.rebuild();
		await expect(service.search({ query: "test", languages: ["unknown"] })).rejects.toThrow(
			"Unknown language filter",
		);
		await service.dispose();
	});

	it("throws for unknown symbol type filter", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		await service.rebuild();
		await expect(service.search({ query: "test", symbolTypes: ["invalid"] })).rejects.toThrow(
			"Unknown symbol type filter",
		);
		await service.dispose();
	});

	it("throws for absolute path prefix", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		await service.rebuild();
		await expect(service.search({ query: "test", pathPrefix: "/absolute" })).rejects.toThrow(
			"Path filter must be repository-relative",
		);
		await service.dispose();
	});

	it("throws for path prefix that escapes the repository", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		await service.rebuild();
		await expect(service.search({ query: "test", pathPrefix: "../escape" })).rejects.toThrow(
			"Path filter cannot escape the repository",
		);
		await service.dispose();
	});

	it("search with no manifest returns empty results for all freshness levels", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		const response = await service.search({ query: "test", freshness: "allow_stale" });
		expect(response.results).toEqual([]);
		await service.dispose();
	});

	it("leaves prefer_fresh and require_fresh maintenance to the daemon when search refresh is disabled", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store, { allowSearchRefresh: false });
		await service.rebuild();
		writeFileSync(join(root, "main.ts"), "export const changedForDaemon = true;\n");
		const refreshSpy = vi.spyOn(service, "refresh");

		const staleResponse = await service.search({ query: "changed daemon code", freshness: "prefer_fresh" });
		expect(staleResponse.status.state).toBe("stale");
		expect(refreshSpy).not.toHaveBeenCalled();
		const encodedAfterStaleSearch = embedding.encodedTexts.length;
		const response = await service.search({ query: "changed daemon code", freshness: "require_fresh" });
		expect(response.status.state).toBe("stale");
		expect(response.results).toEqual([]);
		expect(refreshSpy).not.toHaveBeenCalled();
		expect(embedding.encodedTexts).toHaveLength(encodedAfterStaleSearch);

		const refreshed = await service.refresh();
		expect(refreshSpy).toHaveBeenCalledOnce();
		expect(refreshed.filesChanged).toBe(1);
		await service.dispose();
	});

	it("search cancels when signal is already aborted", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		await service.rebuild();
		const signal = AbortSignal.abort();
		await expect(service.search({ query: "test" }, signal)).rejects.toThrow("cancelled");
		await service.dispose();
	});

	it("search with embedding error marks state unavailable", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		await service.rebuild();
		// Make embedding provider fail
		embedding.encodeQuery = async () => {
			throw new Error("network error");
		};
		const response = await service.search({ query: "test" });
		expect(response.results).toEqual([]);
		// Search errors record lastError but preserve the prior state so subsequent searches can retry.
		const status = await service.status();
		expect(status.state).toBe("ready");
		expect(status.lastError?.code).toBe("RAG_NETWORK_ERROR");
		expect(status.lastError?.message).toContain("network error");
		await service.dispose();
	});

	it("disposal waits for pending refresh", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		await service.rebuild();
		// Dispose should not throw even when service was used
		await expect(service.dispose()).resolves.toBeUndefined();
	});

	it("disposed service throws on initialize", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		await service.dispose();
		await expect(service.initialize()).rejects.toThrow("disposed");
	});

	it("disabled service returns empty update summary", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const svc = new WorkspaceCodeRagService({
			workspaceRoot: root,
			dataDirectory: data,
			embeddingProvider: embedding,
			vectorStore: store,
			settings: { enabled: false, autoRefresh: false, embeddingDimensions: 3, embeddingModel: "test" },
		});
		const summary = await svc.refresh();
		expect(summary.filesAdded).toBe(0);
		expect(summary.fullRebuild).toBe(false);
		await svc.dispose();
	});
});

describe("abort and cancellation", () => {
	it("refresh aborts when signal fires during operation", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		await service.rebuild();
		// Trigger a refresh with a signal that we abort immediately
		const signal = AbortSignal.abort();
		await expect(service.refresh({}, signal)).rejects.toThrow("cancelled");
		await service.dispose();
	});

	it("rebuild aborts when signal fires during operation", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		await service.rebuild();
		const signal = AbortSignal.abort();
		await expect(service.rebuild({}, signal)).rejects.toThrow("cancelled");
		await service.dispose();
	});
});

describe("vocabulary persistence", () => {
	it("searches successfully after service recreation (persisted vocabulary round-trip)", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);

		const summary = await service.rebuild();
		expect(summary.fullRebuild).toBe(true);

		// Locate the vocabulary file from manifest
		const status = await service.status();
		const repoDir = join(data, status.repoId);
		const files = readdirSync(repoDir);
		const vocabFile = files.find((f) => f.startsWith("bm25-"));
		expect(vocabFile).toBeDefined();
		expect(existsSync(join(repoDir, vocabFile!))).toBe(true);

		// Dispose and create a fresh service that loads persisted state
		await service.dispose();
		const freshService = createService(root, data, embedding, store);
		const response = await freshService.search({ query: "authentication initialization", freshness: "allow_stale" });
		expect(response.results[0]).toMatchObject({ path: "main.ts", startLine: 1, endLine: 3 });
		expect(response.results[0].content).toContain("unique-auth-token");
		await freshService.dispose();
	});

	it("deleted vocabulary triggers automatic full rebuild on next refresh", async () => {
		const { root, data } = createFixture();
		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = createService(root, data, embedding, store);
		await service.rebuild();
		const oldStatus = await service.status();
		const oldCollection = oldStatus.collection;
		await service.dispose();

		// Delete vocabulary file to simulate corruption
		const repoDir = join(data, oldStatus.repoId);
		const files = readdirSync(repoDir);
		const vocabFile = files.find((f) => f.startsWith("bm25-"))!;
		rmSync(join(repoDir, vocabFile));
		expect(existsSync(join(repoDir, vocabFile))).toBe(false);

		// Fresh service should detect missing vocabulary and force rebuild
		const freshService = createService(root, data, embedding, store);
		const initStatus = await freshService.initialize();
		expect(initStatus.state).toBe("stale");
		expect(initStatus.lastError?.code).toBe("RAG_INCOMPATIBLE_INDEX");

		const rebuilt = await freshService.refresh();
		expect(rebuilt.fullRebuild).toBe(true);
		expect(rebuilt.status.collection).not.toBe(oldCollection);

		// Vocabulary file should be recreated
		const newRepoDir = join(data, rebuilt.status.repoId);
		const newFiles = readdirSync(newRepoDir);
		const newVocabFile = newFiles.find((f) => f.startsWith("bm25-"));
		expect(newVocabFile).toBeDefined();
		expect(existsSync(join(newRepoDir, newVocabFile!))).toBe(true);

		const response = await freshService.search({ query: "authentication initialization", freshness: "allow_stale" });
		expect(response.results[0]).toMatchObject({ path: "main.ts", startLine: 1, endLine: 3 });
		await freshService.dispose();
	});
});
