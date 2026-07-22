import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EmbeddingProvider } from "../src/embed/provider.ts";
import { WorkspaceCodeRagService } from "../src/rag/service.ts";
import type { RagVectorStore } from "../src/rag/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

class FakeEmbeddingProvider implements EmbeddingProvider {
	dim = 3;
	encodedTexts: string[] = [];

	async encode(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
		if (signal?.aborted) throw signal.reason;
		this.encodedTexts.push(...texts);
		return texts.map(() => new Float32Array([1, 2, 3]));
	}

	async encodeQuery(_text: string, signal?: AbortSignal): Promise<Float32Array> {
		if (signal?.aborted) throw signal.reason;
		return new Float32Array([1, 2, 3]);
	}
}

class FakeVectorStore implements RagVectorStore {
	async collectionExists(): Promise<boolean> { return true; }
	async createCollection(): Promise<void> {}
	async deleteCollection(): Promise<void> {}
	async collectionStatus(): Promise<{ points: number; dimensions: number | undefined }> {
		return { points: 0, dimensions: 3 };
	}
	async upsert(): Promise<void> {}
	async deleteFileVersions(): Promise<void> {}
	async search(): Promise<[]> {
		return [];
	}
}

describe("repository data directory auto-creation", () => {
	it("creates repository directory on initialize when parent data directory exists but repo subdir does not", async () => {
		const directory = mkdtempSync(join(tmpdir(), "p-code-rag-"));
		temporaryDirectories.push(directory);
		const root = join(directory, "repo");
		const data = join(directory, "data");
		mkdirSync(root);
		mkdirSync(data);
		// Data directory exists but no repo-specific subdirectory
		expect(existsSync(data)).toBe(true);

		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = new WorkspaceCodeRagService({
			workspaceRoot: root,
			dataDirectory: data,
			embeddingProvider: embedding,
			vectorStore: store,
			settings: {
				enabled: true,
				autoRefresh: false,
				embeddingDimensions: 3,
				embeddingModel: "test",
			},
		});

		const status = await service.initialize();
		expect(status.state).toBe("not_initialized");

		// Repository directory should now exist
		const repoDir = join(data, status.repoId);
		expect(existsSync(repoDir)).toBe(true);

		await service.dispose();
	});

	it("creates repository directory on search when it does not yet exist", async () => {
		const directory = mkdtempSync(join(tmpdir(), "p-code-rag-"));
		temporaryDirectories.push(directory);
		const root = join(directory, "repo");
		const data = join(directory, "data");
		mkdirSync(root);

		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = new WorkspaceCodeRagService({
			workspaceRoot: root,
			dataDirectory: data,
			embeddingProvider: embedding,
			vectorStore: store,
			settings: {
				enabled: true,
				autoRefresh: false,
				embeddingDimensions: 3,
				embeddingModel: "test",
			},
		});

		// Search triggers initialize internally
		const response = await service.search({ query: "test", freshness: "allow_stale" });
		expect(response.results).toEqual([]);

		const repoDir = join(data, (await service.status()).repoId);
		expect(existsSync(repoDir)).toBe(true);

		await service.dispose();
	});

	it("creates repository directory on status when it does not yet exist", async () => {
		const directory = mkdtempSync(join(tmpdir(), "p-code-rag-"));
		temporaryDirectories.push(directory);
		const root = join(directory, "repo");
		const data = join(directory, "data");
		mkdirSync(root);

		const embedding = new FakeEmbeddingProvider();
		const store = new FakeVectorStore();
		const service = new WorkspaceCodeRagService({
			workspaceRoot: root,
			dataDirectory: data,
			embeddingProvider: embedding,
			vectorStore: store,
			settings: {
				enabled: true,
				autoRefresh: false,
				embeddingDimensions: 3,
				embeddingModel: "test",
			},
		});

		const status = await service.status();
		const repoDir = join(data, status.repoId);
		expect(existsSync(repoDir)).toBe(true);

		await service.dispose();
	});
});
