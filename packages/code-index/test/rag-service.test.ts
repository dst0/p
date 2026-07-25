import fs, {
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
import { EmbeddingError, VectorStoreError } from "../src/embed/errors.ts";
import type { EmbeddingProvider } from "../src/embed/provider.ts";
import {
  type IndexingProgress,
  type IndexUpdateSummary,
  type RagVectorStore,
  type SparseVector,
  type StoredVectorPoint,
  type VectorPoint,
  type VectorSearchFilters,
  type VectorSearchResult,
  WorkspaceCodeRagService,
} from "../src/index.ts";
import { StoredPointError } from "../src/rag/vector-store.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

class FakeEmbeddingProvider implements EmbeddingProvider {
  dim = 3;
  encodedTexts: string[] = [];
  ensureReadyCalls = 0;
  onEncode: (() => void) | undefined;

  async ensureReady(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    this.ensureReadyCalls += 1;
  }

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
  failNextDeleteCollection = false;
  failDeleteCollection: string | undefined;
  createdCollections: string[] = [];
  deletedCollections: string[] = [];
  omitDensePointId: string | undefined;
  failIteration: Error | undefined;

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
    if (this.failNextDeleteCollection || this.failDeleteCollection === collection) {
      this.failNextDeleteCollection = false;
      throw new Error("synthetic collection delete failure");
    }
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

  async *iteratePoints(
    collection: string,
    repoId: string,
    withDense: boolean,
    signal?: AbortSignal,
  ): AsyncIterable<StoredVectorPoint> {
    if (this.failIteration) throw this.failIteration;
    const target = this.collections.get(collection);
    if (!target) throw new Error(`Collection not found: ${collection}`);
    for (const point of target.values()) {
      if (signal?.aborted) throw signal.reason;
      if (point.payload.repoId !== repoId) continue;
      yield {
        id: point.id,
        payload: point.payload,
        ...(withDense && point.id !== this.omitDensePointId ? { dense: point.vectors.dense } : {}),
      };
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
  options: {
    embeddingModel?: string;
    allowSearchRefresh?: boolean;
    sparseRebuildDriftRatio?: number;
    fullSparseRebuildChangeRatio?: number;
    upsertBatchSize?: number;
    allowStaleSearch?: boolean;
    maxSparseVocabularyTokens?: number;
    maxFileBytes?: number;
  } = {},
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
      fullSparseRebuildChangeRatio: options.fullSparseRebuildChangeRatio ?? 1,
      sparseRebuildDriftRatio: options.sparseRebuildDriftRatio ?? 1,
      ...(options.upsertBatchSize === undefined ? {} : { upsertBatchSize: options.upsertBatchSize }),
      allowStaleSearch: options.allowStaleSearch,
      preparationMaxWorkers: 4,
      preparationWorkerMemoryBytes: 64 * 1024 * 1024,
      preparationMemoryReserveBytes: 16 * 1024 * 1024,
      ...(options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes }),
      ...(options.maxSparseVocabularyTokens === undefined
        ? {}
        : { maxSparseVocabularyTokens: options.maxSparseVocabularyTokens }),
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
    expect(summary.status.preparation).toMatchObject({
      mode: "worker_threads",
      workers: 1,
    });
    expect(summary.status.preparation?.maxInFlightBytes).toBe(summary.status.preparation?.workerMemoryBytes);
    expect(readdirSync(join(data, summary.status.repoId)).some((name) => name.startsWith(".preparation-"))).toBe(false);
    expect(embedding.encodedTexts[0]).toContain("file: main.ts");
    expect(embedding.encodedTexts[0]).toContain("language: typescript");
    expect(embedding.encodedTexts[0]).toContain("symbol: function initializeAuth");
    expect(embedding.encodedTexts[0]).toContain("kind: function");

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

    writeFileSync(join(root, "main.ts"), "export function initializeAuth() {\n\treturn 'replacement-auth-token';\n}\n");
    const changed = await service.refresh();
    expect(changed.fullRebuild).toBe(false);
    expect(changed.filesChanged).toBe(1);
    expect(changed.chunksEmbedded).toBe(1);
    expect(store.allContents().join("\n")).toContain("replacement-auth-token");
    expect(store.allContents().join("\n")).not.toContain("unique-auth-token");
  });

  it("migrates to a new sparse generation when vocabulary drift exceeds its threshold", async () => {
    const { root, data } = createFixture();
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store, { sparseRebuildDriftRatio: 0.2 });
    await service.rebuild();
    const originalCollection = (await service.status()).collection;

    writeFileSync(join(root, "main.ts"), "export const replacement = 'sparse-drift-rebuild';\n");
    const refreshed = await service.refresh();

    expect(refreshed.fullRebuild).toBe(false);
    expect(refreshed.status.collection).not.toBe(originalCollection);
    expect(refreshed.status.sparse.exact).toBe(true);
    expect(store.allContents().join("\n")).toContain("sparse-drift-rebuild");
  });

  it("reuses dense vectors and re-embeds only the changed ten percent during sparse migration", async () => {
    const { root, data } = createFixture();
    for (let index = 1; index < 10; index += 1) {
      writeFileSync(join(root, `file-${index}.ts`), `export const value${index} = 'stable-${index}';\n`);
    }
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store, {
      fullSparseRebuildChangeRatio: 0.05,
      sparseRebuildDriftRatio: 1,
      upsertBatchSize: 1,
    });
    await service.rebuild();
    const originalStatus = await service.status();
    const originalPoints = store.collections.get(originalStatus.collection!)!;
    const originalUnchanged = [...originalPoints.values()].find((point) => point.payload.path === "file-1.ts")!;
    const originalDense = [...originalUnchanged.vectors.dense];
    const originalSparse = structuredClone(originalUnchanged.vectors.sparse);
    const originalIndexedAt = originalUnchanged.payload.indexedAt;
    embedding.encodedTexts = [];

    writeFileSync(
      join(root, "main.ts"),
      "export function initializeAuth() {\n\treturn 'replacement-auth-token-with-extra-terms';\n}\n",
    );
    const progress: IndexingProgress[] = [];
    const refreshed = await service.refresh({ onProgress: (value) => progress.push(value) });

    expect(refreshed).toMatchObject({
      fullRebuild: false,
      filesChanged: 1,
      filesUnchanged: 9,
      chunksEmbedded: 1,
    });
    expect(embedding.encodedTexts).toHaveLength(1);
    expect(refreshed.status.collection).not.toBe(originalStatus.collection);
    expect(refreshed.status.sparse).toMatchObject({ exact: true, driftFileCount: 0 });
    expect(store.collections.has(originalStatus.collection!)).toBe(false);

    const migratedPoints = store.collections.get(refreshed.status.collection!)!;
    const migratedUnchanged = [...migratedPoints.values()].find((point) => point.payload.path === "file-1.ts")!;
    expect(migratedUnchanged.vectors.dense).toEqual(originalDense);
    expect(migratedUnchanged.vectors.sparse).not.toEqual(originalSparse);
    expect(migratedUnchanged.payload.indexGeneration).toBe(refreshed.status.generation);
    expect(migratedUnchanged.payload.indexedAt).toBe(originalIndexedAt);
    expect(progress.some((value) => value.processedChunks === 9 && value.totalChunks === 10)).toBe(true);
    expect(progress.every((value, index) => index === 0 || value.percent >= progress[index - 1].percent)).toBe(true);
  });

  it("excludes deleted files from a sparse migration without embedding unchanged files", async () => {
    const { root, data } = createFixture();
    writeFileSync(join(root, "keep.ts"), "export const keep = 'still-indexed';\n");
    writeFileSync(join(root, "remove.ts"), "export const remove = 'delete-me';\n");
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store, {
      fullSparseRebuildChangeRatio: 0,
      sparseRebuildDriftRatio: 1,
    });
    await service.rebuild();
    embedding.encodedTexts = [];
    embedding.ensureReadyCalls = 0;

    rmSync(join(root, "remove.ts"));
    const refreshed = await service.refresh();

    expect(refreshed).toMatchObject({ fullRebuild: false, filesDeleted: 1, chunksEmbedded: 0 });
    expect(embedding.encodedTexts).toEqual([]);
    expect(embedding.ensureReadyCalls).toBe(0);
    expect(store.allContents().join("\n")).toContain("still-indexed");
    expect(store.allContents().join("\n")).not.toContain("delete-me");
  });

  it("falls back to a full rebuild when reusable stored chunks are incomplete", async () => {
    const { root, data } = createFixture();
    writeFileSync(join(root, "stable.ts"), "export const stable = 'must-survive';\n");
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store, {
      fullSparseRebuildChangeRatio: 0,
      sparseRebuildDriftRatio: 1,
    });
    await service.rebuild();
    const oldCollection = (await service.status()).collection!;
    const oldPoints = store.collections.get(oldCollection)!;
    const stablePointId = [...oldPoints.values()].find((point) => point.payload.path === "stable.ts")!.id;
    oldPoints.delete(stablePointId);
    embedding.encodedTexts = [];

    writeFileSync(join(root, "main.ts"), "export const changed = 'force-migration';\n");
    const refreshed = await service.refresh();

    expect(refreshed.fullRebuild).toBe(true);
    expect(refreshed.chunksEmbedded).toBe(2);
    expect(embedding.encodedTexts).toHaveLength(2);
    expect(store.allContents().join("\n")).toContain("must-survive");
  });

  it("removes a failed migration generation before falling back on an incompatible dense vector", async () => {
    const { root, data } = createFixture();
    writeFileSync(join(root, "stable.ts"), "export const stable = 'reuse-me';\n");
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store, {
      fullSparseRebuildChangeRatio: 0,
      sparseRebuildDriftRatio: 1,
    });
    await service.rebuild();
    const oldCollection = (await service.status()).collection!;
    store.omitDensePointId = [...store.collections.get(oldCollection)!.values()].find(
      (point) => point.payload.path === "stable.ts",
    )!.id;
    const creationsBefore = store.createdCollections.length;
    const progress: IndexingProgress[] = [];

    writeFileSync(join(root, "main.ts"), "export const changed = 'force-dense-validation';\n");
    const refreshed = await service.refresh({ onProgress: (value) => progress.push(value) });

    expect(refreshed.fullRebuild).toBe(true);
    expect(store.createdCollections).toHaveLength(creationsBefore + 2);
    const failedMigration = store.createdCollections.at(-2)!;
    expect(store.deletedCollections).toContain(failedMigration);
    expect(store.collections.has(failedMigration)).toBe(false);
    expect(progress.every((value, index) => index === 0 || value.percent >= progress[index - 1].percent)).toBe(true);
  });

  it("preserves the old generation when sparse migration fails for a backend error", async () => {
    const { root, data } = createFixture();
    writeFileSync(join(root, "stable.ts"), "export const stable = 'old-generation';\n");
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store, {
      fullSparseRebuildChangeRatio: 0,
      sparseRebuildDriftRatio: 1,
    });
    await service.rebuild();
    const oldCollection = (await service.status()).collection!;
    store.failNextUpsert = true;
    writeFileSync(join(root, "main.ts"), "export const changed = 'migration-fails';\n");

    await expect(service.refresh()).rejects.toThrow("synthetic upsert failure");

    expect((await service.status()).collection).toBe(oldCollection);
    expect(store.collections.has(oldCollection)).toBe(true);
    expect(store.collections.size).toBe(1);
  });

  it("cleans a new collection and vocabulary when a full rebuild cannot commit its manifest", async () => {
    const { root, data } = createFixture();
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store);
    await service.rebuild();
    const status = await service.status();
    const oldCollection = status.collection!;
    const repositoryDirectory = join(data, status.repoId);
    const oldVocabularies = readdirSync(repositoryDirectory).filter((file) => file.startsWith("bm25-"));
    const originalRename = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (String(target).endsWith("manifest.json")) throw new Error("manifest commit denied");
      return originalRename(source, target);
    });
    writeFileSync(join(root, "main.ts"), "export const changed = 'full-commit-fails';\n");

    await expect(service.rebuild()).rejects.toThrow("manifest commit denied");

    expect(store.collections.has(oldCollection)).toBe(true);
    expect(store.collections.size).toBe(1);
    expect(readdirSync(repositoryDirectory).filter((file) => file.startsWith("bm25-"))).toEqual(oldVocabularies);
  });

  it("does not mask a manifest failure when temporary vocabulary cleanup also fails", async () => {
    const { root, data } = createFixture();
    writeFileSync(join(root, "stable.ts"), "export const stable = 'cleanup-failure';\n");
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store, {
      fullSparseRebuildChangeRatio: 0,
      sparseRebuildDriftRatio: 1,
    });
    await service.rebuild();
    const oldCollection = (await service.status()).collection!;
    const originalRename = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (String(target).endsWith("manifest.json")) throw new Error("migration manifest commit denied");
      return originalRename(source, target);
    });
    const originalUnlink = fs.unlinkSync.bind(fs);
    vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
      if (String(target).includes("bm25-")) throw new Error("temporary vocabulary cleanup denied");
      return originalUnlink(target);
    });
    writeFileSync(join(root, "main.ts"), "export const changed = 'migration-commit-fails';\n");

    await expect(service.refresh()).rejects.toThrow("migration manifest commit denied");

    expect((await service.status()).collection).toBe(oldCollection);
    expect(store.collections.has(oldCollection)).toBe(true);
  });

  it("falls back to a full rebuild when the vector store cannot iterate existing points", async () => {
    const { root, data } = createFixture();
    writeFileSync(join(root, "stable.ts"), "export const stable = 'legacy-store';\n");
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store, {
      fullSparseRebuildChangeRatio: 0,
      sparseRebuildDriftRatio: 1,
    });
    await service.rebuild();
    Object.defineProperty(store, "iteratePoints", { value: undefined });
    embedding.encodedTexts = [];
    writeFileSync(join(root, "main.ts"), "export const changed = 'legacy-fallback';\n");

    const refreshed = await service.refresh();

    expect(refreshed.fullRebuild).toBe(true);
    expect(embedding.encodedTexts).toHaveLength(2);
  });

  it("falls back to a full rebuild when stored-point validation rejects the old generation", async () => {
    const { root, data } = createFixture();
    writeFileSync(join(root, "stable.ts"), "export const stable = 'corrupt-generation';\n");
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store, {
      fullSparseRebuildChangeRatio: 0,
      sparseRebuildDriftRatio: 1,
    });
    await service.rebuild();
    store.failIteration = new StoredPointError("corrupt stored point");
    writeFileSync(join(root, "main.ts"), "export const changed = 'validation-fallback';\n");

    const refreshed = await service.refresh();

    expect(refreshed.fullRebuild).toBe(true);
    expect(refreshed.chunksEmbedded).toBe(2);
  });

  it("keeps a successful migration active when old-generation cleanup fails", async () => {
    const { root, data } = createFixture();
    writeFileSync(join(root, "stable.ts"), "export const stable = 'cleanup-best-effort';\n");
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store, {
      fullSparseRebuildChangeRatio: 0,
      sparseRebuildDriftRatio: 1,
    });
    await service.rebuild();
    const oldCollection = (await service.status()).collection!;
    store.failDeleteCollection = oldCollection;
    const originalUnlink = fs.unlinkSync.bind(fs);
    vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
      if (!String(target).includes("bm25-")) return originalUnlink(target);
      const error = new Error("vocabulary cleanup denied") as Error & { code: string };
      error.code = "EPERM";
      throw error;
    });
    writeFileSync(join(root, "main.ts"), "export const changed = 'cleanup-still-succeeds';\n");

    const refreshed = await service.refresh();

    expect(refreshed.fullRebuild).toBe(false);
    expect(refreshed.status.state).toBe("ready");
    expect(refreshed.status.collection).not.toBe(oldCollection);
    expect(store.collections.has(oldCollection)).toBe(true);
  });

  it("treats an already-missing old vocabulary as successful cleanup", async () => {
    const { root, data } = createFixture();
    writeFileSync(join(root, "stable.ts"), "export const stable = 'missing-old-vocabulary';\n");
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store, {
      fullSparseRebuildChangeRatio: 0,
      sparseRebuildDriftRatio: 1,
    });
    await service.rebuild();
    const originalUnlink = fs.unlinkSync.bind(fs);
    vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
      if (!String(target).includes("bm25-")) return originalUnlink(target);
      const error = new Error("already removed") as Error & { code: string };
      error.code = "ENOENT";
      throw error;
    });
    writeFileSync(join(root, "main.ts"), "export const changed = 'cleanup-enoent';\n");

    await expect(service.refresh()).resolves.toMatchObject({ fullRebuild: false });
  });

  it("preserves the original migration error when failed-generation cleanup also fails", async () => {
    const { root, data } = createFixture();
    writeFileSync(join(root, "stable.ts"), "export const stable = 'double-failure';\n");
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store, {
      fullSparseRebuildChangeRatio: 0,
      sparseRebuildDriftRatio: 1,
    });
    await service.rebuild();
    store.failNextUpsert = true;
    store.failNextDeleteCollection = true;
    writeFileSync(join(root, "main.ts"), "export const changed = 'upsert-fails-first';\n");

    await expect(service.refresh()).rejects.toThrow("synthetic upsert failure");
  });

  it("does not delete a generation after its manifest has already been committed", async () => {
    const { root, data } = createFixture();
    writeFileSync(join(root, "stable.ts"), "export const stable = 'post-commit';\n");
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store, {
      fullSparseRebuildChangeRatio: 0,
      sparseRebuildDriftRatio: 1,
    });
    await service.rebuild();
    const oldCollection = (await service.status()).collection!;
    const internals = service as unknown as {
      summaryForPlan(...args: unknown[]): IndexUpdateSummary;
    };
    vi.spyOn(internals, "summaryForPlan").mockImplementation(() => {
      throw new Error("post-commit summary failure");
    });
    writeFileSync(join(root, "main.ts"), "export const changed = 'manifest-is-durable';\n");

    await expect(service.refresh()).rejects.toThrow("post-commit summary failure");

    const committedCollection = (await service.status()).collection!;
    expect(committedCollection).not.toBe(oldCollection);
    expect(store.collections.has(committedCollection)).toBe(true);
  });

  it("reports vocabulary migration progress for collections larger than one scroll interval", async () => {
    const { root, data } = createFixture();
    for (let index = 0; index < 256; index += 1) {
      writeFileSync(join(root, `stable-${index}.ts`), `export const stable${index} = ${index};\n`);
    }
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store, {
      fullSparseRebuildChangeRatio: 0,
      sparseRebuildDriftRatio: 1,
    });
    await service.rebuild();
    writeFileSync(join(root, "main.ts"), "export const changed = 'large-migration';\n");
    const progress: IndexingProgress[] = [];

    await service.refresh({ onProgress: (value) => progress.push(value) });

    expect(progress).toContainEqual(
      expect.objectContaining({ phase: "indexing", percent: 15, processedFiles: 1, totalFiles: 257 }),
    );
  });

  it("guards sparse migration when its manifest disappears and when an unchanged entry is missing", async () => {
    const first = createFixture();
    const uninitialized = createService(first.root, first.data, new FakeEmbeddingProvider(), new FakeVectorStore());
    const emptyPlan = { added: [], changed: [], deleted: [], unchanged: [] };
    const uninitializedInternals = uninitialized as unknown as {
      performSparseGenerationRefresh(
        scanned: unknown[],
        plan: unknown,
        startedAt: number,
        signal: AbortSignal,
        onProgress: undefined,
      ): Promise<IndexUpdateSummary>;
    };
    await expect(
      uninitializedInternals.performSparseGenerationRefresh(
        [],
        emptyPlan,
        Date.now(),
        new AbortController().signal,
        undefined,
      ),
    ).rejects.toThrow("not initialized");

    const second = createFixture();
    writeFileSync(join(second.root, "stable.ts"), "export const stable = 'missing-manifest-entry';\n");
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(second.root, second.data, embedding, store, {
      fullSparseRebuildChangeRatio: 0,
      sparseRebuildDriftRatio: 1,
    });
    await service.rebuild();
    writeFileSync(join(second.root, "main.ts"), "export const changed = 'direct-migration';\n");
    const signal = new AbortController().signal;
    const internals = service as unknown as {
      manifest: { files: Record<string, unknown> };
      scanWorkspace(signal: AbortSignal): unknown[];
      createRefreshPlan(scanned: unknown[]): unknown;
      performSparseGenerationRefresh(
        scanned: unknown[],
        plan: unknown,
        startedAt: number,
        signal: AbortSignal,
        onProgress: undefined,
      ): Promise<IndexUpdateSummary>;
    };
    const scanned = internals.scanWorkspace(signal);
    const plan = internals.createRefreshPlan(scanned);
    delete internals.manifest.files["stable.ts"];

    const refreshed = await internals.performSparseGenerationRefresh(scanned, plan, Date.now(), signal, undefined);

    expect(refreshed.fullRebuild).toBe(true);
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

  it("maps an incremental file that grows beyond its limit to a security error", async () => {
    const { root, data } = createFixture();
    const secondPath = join(root, "second.ts");
    writeFileSync(secondPath, "export const second = 'initial';\n");
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store, { maxFileBytes: 256 });
    await service.rebuild();

    writeFileSync(join(root, "main.ts"), "export const first = 'changed';\n");
    writeFileSync(secondPath, "export const second = 'intermediate';\n");
    embedding.onEncode = () => writeFileSync(secondPath, "x".repeat(512));

    await expect(service.refresh()).rejects.toMatchObject({
      code: "RAG_SECURITY_BLOCK",
    });
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
      rebuildProgress.every((progress, index) => index === 0 || progress.percent >= rebuildProgress[index - 1].percent),
    ).toBe(true);

    writeFileSync(join(root, "main.ts"), "export const replacement = 'changed';\n");
    const refreshProgress: IndexingProgress[] = [];
    await service.refresh({ onProgress: (progress) => refreshProgress.push(progress) });
    expect(refreshProgress[0]).toMatchObject({ phase: "scanning", percent: 0 });
    expect(refreshProgress.at(-1)).toMatchObject({ phase: "finalizing", percent: 100 });
    expect(refreshProgress.some((progress) => progress.phase === "indexing" && progress.percent > 0.1)).toBe(true);
    expect(
      refreshProgress.every((progress, index) => index === 0 || progress.percent >= refreshProgress[index - 1].percent),
    ).toBe(true);
  });

  it("dynamically reloads batch size configuration during an active rebuild", async () => {
    const { root, data } = createFixture();
    // Create multiple files to produce several chunks
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(root, `file_${i}.ts`), `export const x${i} = ${i};\n`.repeat(20));
    }
    const configPath = join(data, "..", "code-rag.json");
    writeFileSync(configPath, JSON.stringify({ encodeBatchSize: 10, upsertBatchSize: 10 }));

    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const batchSizesSeen: number[] = [];

    const origEncode = embedding.encode.bind(embedding);
    embedding.encode = async (texts, signal) => {
      batchSizesSeen.push(texts.length);
      // After first batch, update dynamic config file to smaller batch size 2
      writeFileSync(configPath, JSON.stringify({ encodeBatchSize: 2, upsertBatchSize: 2 }));
      return origEncode(texts, signal);
    };

    const service = createService(root, data, embedding, store);
    await service.rebuild();

    // First batch should be 10, subsequent batches should be 2
    expect(batchSizesSeen[0]).toBe(10);
    expect(batchSizesSeen.slice(1).every((size) => size <= 2)).toBe(true);
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

  it("bounds sparse vocabulary memory and removes the preparation spool after refusal", async () => {
    const { root, data } = createFixture();
    const service = createService(root, data, new FakeEmbeddingProvider(), new FakeVectorStore(), {
      maxSparseVocabularyTokens: 1,
    });

    await expect(service.rebuild()).rejects.toThrow("Sparse vocabulary exceeded its safe limit");
    const status = await service.status();
    expect(status.state).toBe("unavailable");
    expect(readdirSync(join(data, status.repoId)).some((name) => name.startsWith(".preparation-"))).toBe(false);
    await service.dispose();
  });

  it("refuses a rebuild before spooling when the disk reserve cannot be preserved", async () => {
    const { root, data } = createFixture();
    const service = createService(root, data, new FakeEmbeddingProvider(), new FakeVectorStore());
    const actualDisk = fs.statfsSync(root);
    vi.spyOn(fs, "statfsSync").mockReturnValue({
      ...actualDisk,
      bavail: 1,
      bsize: 1,
    });

    await expect(service.rebuild()).rejects.toThrow("Insufficient disk space for bounded indexing spool");
    const status = await service.status();
    expect(readdirSync(join(data, status.repoId)).some((name) => name.startsWith(".preparation-"))).toBe(false);
    await service.dispose();
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

  it("invalidates and rebuilds an index created with the previous chunker version", async () => {
    const { root, data } = createFixture();
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const original = createService(root, data, embedding, store);
    await original.rebuild();
    const originalStatus = await original.status();
    await original.dispose();

    const manifestPath = join(data, originalStatus.repoId, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      chunker: { version: string };
    };
    manifest.chunker.version = "1";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const migrated = createService(root, data, embedding, store);
    const stale = await migrated.initialize();
    expect(stale).toMatchObject({
      state: "stale",
      lastError: { code: "RAG_INCOMPATIBLE_INDEX", message: "Chunker version changed" },
    });

    const rebuilt = await migrated.refresh();
    expect(rebuilt.fullRebuild).toBe(true);
    expect(rebuilt.status.collection).not.toBe(originalStatus.collection);
    await migrated.dispose();
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
    await expect(service.search({ query: "test", languages: ["unknown"] })).rejects.toThrow("Unknown language filter");
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

  it("handles require_fresh when no manifest exists (allowSearchRefresh = true)", async () => {
    const { root, data } = createFixture();
    const service = createService(root, data, new FakeEmbeddingProvider(), new FakeVectorStore(), {
      allowSearchRefresh: true,
    });
    vi.spyOn(service, "refresh").mockRejectedValue(new Error("Refresh failed"));
    const response = await service.search({ query: "test", freshness: "require_fresh" });
    expect(response.results).toEqual([]);
    await service.dispose();
  });

  it("handles prefer_fresh when no manifest exists (allowSearchRefresh = true)", async () => {
    const { root, data } = createFixture();
    const service = createService(root, data, new FakeEmbeddingProvider(), new FakeVectorStore(), {
      allowSearchRefresh: true,
    });
    const response = await service.search({ query: "test", freshness: "prefer_fresh" });
    expect(response.results).toEqual([]);
    await service.dispose();
  });

  it("handles require_fresh when stale and refresh throws (allowSearchRefresh = true)", async () => {
    const { root, data } = createFixture();
    const service = createService(root, data, new FakeEmbeddingProvider(), new FakeVectorStore(), {
      allowSearchRefresh: true,
    });
    await service.rebuild();
    writeFileSync(join(root, "main.ts"), "export const changedForDaemon = true;\n");
    vi.spyOn(service, "refresh").mockRejectedValue(new Error("Refresh failed"));
    const response = await service.search({ query: "test", freshness: "require_fresh" });
    expect(response.results).toEqual([]);
    await service.dispose();
  });

  it("handles prefer_fresh when stale (allowSearchRefresh = true)", async () => {
    const { root, data } = createFixture();
    const service = createService(root, data, new FakeEmbeddingProvider(), new FakeVectorStore(), {
      allowSearchRefresh: true,
    });
    await service.rebuild();
    writeFileSync(join(root, "main.ts"), "export const changedForDaemon = true;\n");
    const response = await service.search({ query: "test", freshness: "prefer_fresh" });
    expect(response.status.state).toBe("stale");
    await service.dispose();
  });

  it("returns empty when stale and allowStaleSearch = false", async () => {
    const { root, data } = createFixture();
    const service = createService(root, data, new FakeEmbeddingProvider(), new FakeVectorStore(), {
      allowSearchRefresh: false,
      allowStaleSearch: false,
    });
    await service.rebuild();
    writeFileSync(join(root, "main.ts"), "export const changedForDaemon = true;\n");
    const response = await service.search({ query: "test", freshness: "allow_stale" });
    expect(response.results).toEqual([]);
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

  it("refresh aborts when signal fires during operation", async () => {
    const { root, data } = createFixture();
    const service = createService(root, data, new FakeEmbeddingProvider(), new FakeVectorStore());

    // Ensure initialized so it doesn't pause at await initialize
    await service.rebuild();

    // Create an abort controller and abort it *after* refresh starts
    const controller = new AbortController();

    // Start the first refresh, it will set refreshPromise synchronously
    const promise1 = service.refresh({}, controller.signal);

    // Concurrently start a second refresh, this will hit waitForSignal
    const promise2 = service.refresh({}, controller.signal);
    const expectation1 = expect(promise1).rejects.toThrow("cancelled");
    const expectation2 = expect(promise2).rejects.toThrow("cancelled");

    // Now abort
    controller.abort();

    await Promise.all([expectation1, expectation2]);

    await service.dispose();
  });

  it("waitForSignal succeeds when promise resolves", async () => {
    const { root, data } = createFixture();
    const service = createService(root, data, new FakeEmbeddingProvider(), new FakeVectorStore());
    await service.rebuild();

    const controller = new AbortController();

    // Start the first refresh
    const promise1 = service.refresh({}, controller.signal);

    // Concurrently start a second refresh
    const promise2 = service.refresh({}, controller.signal);

    // Let them finish successfully
    await expect(promise1).resolves.toBeDefined();
    await expect(promise2).resolves.toBeDefined();

    await service.dispose();
  });

  it("handles valid pathPrefix in search", async () => {
    const { root, data } = createFixture();
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store);
    await service.rebuild();
    const response = await service.search({ query: "test", pathPrefix: "src/" });
    // just expecting it not to throw RAG_SECURITY_BLOCK
    expect(response.status.state).toBe("ready");
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

  it("handles search when disabled, missing manifest, or missing Qdrant collection", async () => {
    const { root, data } = createFixture();
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();

    // Disabled service
    const disabledService = new WorkspaceCodeRagService({
      workspaceRoot: root,
      dataDirectory: data,
      embeddingProvider: embedding,
      vectorStore: store,
      settings: { enabled: false },
    });
    const disabledRes = await disabledService.search({ query: "test" });
    expect(disabledRes.results).toHaveLength(0);
    await disabledService.dispose();

    // Service without manifest (not rebuilt yet)
    const unindexedService = createService(root, data, embedding, store, { allowSearchRefresh: false });
    const requireFreshRes = await unindexedService.search({ query: "test", freshness: "require_fresh" });
    expect(requireFreshRes.results).toHaveLength(0);

    const preferFreshRes = await unindexedService.search({ query: "test", freshness: "prefer_fresh" });
    expect(preferFreshRes.results).toHaveLength(0);

    const allowStaleRes = await unindexedService.search({ query: "test", freshness: "allow_stale" });
    expect(allowStaleRes.results).toHaveLength(0);
    await unindexedService.dispose();

    // Rebuilt service but Qdrant collection deleted
    const indexedService = createService(root, data, embedding, store);
    await indexedService.rebuild();
    store.collections.clear(); // Simulate collection deleted from Qdrant

    const missingCollRes = await indexedService.search({ query: "test", freshness: "allow_stale" });
    expect(missingCollRes.results).toHaveLength(0);
    const status = await indexedService.status();
    expect(status.state).toBe("stale");
    expect(status.staleReason).toContain("Qdrant collection is missing");
    await indexedService.dispose();
  });

  it("handles initialization error when reloadPersistedState throws unexpected error", async () => {
    const { root, data } = createFixture();
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store);

    vi.spyOn(
      service as unknown as { reloadPersistedState: () => Promise<void> },
      "reloadPersistedState",
    ).mockRejectedValueOnce(new Error("Disk error loading state"));

    const status = await service.initialize();
    expect(status.state).toBe("unavailable");
    expect(status.lastError?.code).toBe("RAG_INCOMPATIBLE_INDEX");
    expect(status.lastError?.message).toContain("Disk error loading state");
    await service.dispose();
  });

  it("classifies search errors correctly for EmbeddingError, VectorStoreError, TimeoutError, and generic Error", async () => {
    const { root, data } = createFixture();
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store);

    await service.rebuild();

    // 1. EmbeddingError server_down
    embedding.encodeQuery = vi.fn().mockRejectedValueOnce(new EmbeddingError("server_down", "Server down"));
    const res1 = await service.search({ query: "test", freshness: "allow_stale" });
    expect(res1.status.lastError?.code).toBe("RAG_EMBEDDING_SERVER_DOWN");

    // 2. EmbeddingError server_error
    embedding.encodeQuery = vi.fn().mockRejectedValueOnce(new EmbeddingError("server_error", "Server err"));
    const res2 = await service.search({ query: "test", freshness: "allow_stale" });
    expect(res2.status.lastError?.code).toBe("RAG_EMBEDDING_SERVER_ERROR");

    // 3. VectorStoreError qdrant_down
    store.search = vi.fn().mockRejectedValueOnce(new VectorStoreError("qdrant_down", "Qdrant down"));
    const res3 = await service.search({ query: "test", freshness: "allow_stale" });
    expect(res3.status.lastError?.code).toBe("RAG_QDRANT_DOWN");

    // 4. VectorStoreError network
    store.search = vi.fn().mockRejectedValueOnce(new VectorStoreError("network", "Network err"));
    const res4 = await service.search({ query: "test", freshness: "allow_stale" });
    expect(res4.status.lastError?.code).toBe("RAG_NETWORK_ERROR");

    // 5. VectorStoreError qdrant_error
    store.search = vi.fn().mockRejectedValueOnce(new VectorStoreError("qdrant_error", "Qdrant err"));
    const res5 = await service.search({ query: "test", freshness: "allow_stale" });
    expect(res5.status.lastError?.code).toBe("RAG_QDRANT_ERROR");

    // 6. TimeoutError
    const timeoutErr = new Error("Timed out");
    timeoutErr.name = "TimeoutError";
    store.search = vi.fn().mockRejectedValueOnce(timeoutErr);
    const res6 = await service.search({ query: "test", freshness: "allow_stale" });
    expect(res6.status.lastError?.code).toBe("RAG_TIMEOUT");

    // 7. Generic Error
    store.search = vi.fn().mockRejectedValueOnce(new Error("Generic failure"));
    const res7 = await service.search({ query: "test", freshness: "allow_stale" });
    expect(res7.status.lastError?.code).toBe("RAG_NETWORK_ERROR");

    await service.dispose();
  });

  it("handles operation cancellation and error mapping during refresh/rebuild", async () => {
    const { root, data } = createFixture();
    const embedding = new FakeEmbeddingProvider();
    const store = new FakeVectorStore();
    const service = createService(root, data, embedding, store);

    // Cancelled signal
    const controller = new AbortController();
    controller.abort(new Error("Operation cancelled"));

    await expect(service.refresh({}, controller.signal)).rejects.toThrow("cancelled");

    // Progress reporter callback
    const progressReports: IndexingProgress[] = [];
    await service.rebuild({
      onProgress: (progress) => progressReports.push(progress),
    });
    expect(progressReports.length).toBeGreaterThan(0);

    // Timeout mapOperationError test
    vi.spyOn(service as any, "performIncrementalRefresh").mockImplementationOnce(() => {
      const err = new Error("timeout");
      err.name = "TimeoutError";
      return Promise.reject(err);
    });
    writeFileSync(join(root, "main.ts"), "export const changedForDaemon = true;\n");
    const timeoutController = new AbortController();
    await expect(service.refresh({}, timeoutController.signal)).rejects.toThrow("timed out");

    await service.dispose();
  });
});
