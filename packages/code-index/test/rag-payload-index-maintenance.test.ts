import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceCodeRagService } from "../src/rag/service.ts";
import type {
  RagVectorStore,
  SparseVector,
  StoredVectorPoint,
  VectorPoint,
  VectorSearchFilters,
  VectorSearchResult,
} from "../src/rag/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

class PayloadIndexStore implements RagVectorStore {
  readonly collections = new Map<string, VectorPoint[]>();
  readonly payloadIndexCollections: string[] = [];
  readonly searchedCollections: string[] = [];
  readonly operations: string[] = [];
  failNextPayloadIndexMaintenance = false;
  payloadIndexMaintenanceGate: Promise<void> | undefined;

  async collectionExists(collection: string): Promise<boolean> {
    return this.collections.has(collection);
  }

  async createCollection(collection: string): Promise<void> {
    this.collections.set(collection, []);
  }

  async deleteCollection(collection: string): Promise<void> {
    this.collections.delete(collection);
  }

  async collectionStatus(collection: string): Promise<{ points: number; dimensions: number | undefined }> {
    return { points: this.collections.get(collection)?.length ?? 0, dimensions: 1024 };
  }

  async createPayloadIndexes(collection: string): Promise<void> {
    this.payloadIndexCollections.push(collection);
    this.operations.push(`index:${collection}`);
    await this.payloadIndexMaintenanceGate;
    if (this.failNextPayloadIndexMaintenance) {
      this.failNextPayloadIndexMaintenance = false;
      throw new Error("synthetic payload-index maintenance failure");
    }
  }

  async upsert(collection: string, points: VectorPoint[]): Promise<void> {
    this.collections.set(collection, [...(this.collections.get(collection) ?? []), ...points]);
  }

  async deleteFileVersions(
    _collection: string,
    _repoId: string,
    _fileId: string,
    _currentFileHash?: string,
  ): Promise<void> {}

  async *iteratePoints(collection: string, repoId: string, withDense: boolean): AsyncIterable<StoredVectorPoint> {
    this.operations.push(`iterate:${collection}`);
    for (const point of this.collections.get(collection) ?? []) {
      if (point.payload.repoId !== repoId) continue;
      yield {
        id: point.id,
        ...(withDense && point.vectors.dense ? { dense: point.vectors.dense } : {}),
        payload: point.payload,
      };
    }
  }

  async search(
    collection: string,
    _dense: Float32Array,
    _sparse: SparseVector,
    _filters: VectorSearchFilters,
    _limit: number,
  ): Promise<VectorSearchResult[]> {
    this.searchedCollections.push(collection);
    return (this.collections.get(collection) ?? []).map((point, index) => ({
      id: point.id,
      score: 0.9 - index * 0.1,
      payload: point.payload,
    }));
  }
}

describe("RAG payload-index maintenance", () => {
  it("shares one retryable maintenance attempt across concurrent searches", async () => {
    const { options, store } = createFixture();
    const collection = await createPersistedGeneration(options);
    const service = new WorkspaceCodeRagService(options);
    await service.initialize();

    store.failNextPayloadIndexMaintenance = true;
    expect((await service.search({ query: "value" })).results).toEqual([]);
    expect(store.payloadIndexCollections).toEqual([collection]);
    expect(store.searchedCollections).toEqual([]);

    let releaseMaintenance: (() => void) | undefined;
    store.payloadIndexMaintenanceGate = new Promise<void>((resolve) => {
      releaseMaintenance = resolve;
    });
    let settledSearches = 0;
    const searches = [service.search({ query: "value" }), service.search({ query: "value" })].map((search) =>
      search.finally(() => {
        settledSearches += 1;
      }),
    );
    await vi.waitFor(() => expect(store.payloadIndexCollections).toHaveLength(2));
    expect(store.payloadIndexCollections).toEqual([collection, collection]);
    expect(store.searchedCollections).toEqual([]);
    expect(settledSearches).toBe(0);

    releaseMaintenance?.();
    const responses = await Promise.all(searches);
    store.payloadIndexMaintenanceGate = undefined;
    expect(settledSearches).toBe(2);
    expect(responses.every((response) => response.results.length > 0)).toBe(true);
    expect(store.searchedCollections).toEqual([collection, collection]);

    await service.search({ query: "value" });
    expect(store.payloadIndexCollections).toEqual([collection, collection]);
  });

  it("maintains the replacement collection before a pending search uses it", async () => {
    const { options, store } = createFixture();
    const firstCollection = await createPersistedGeneration(options);
    const service = new WorkspaceCodeRagService(options);
    await service.initialize();
    let releaseMaintenance: (() => void) | undefined;
    store.payloadIndexMaintenanceGate = new Promise<void>((resolve) => {
      releaseMaintenance = resolve;
    });

    const search = service.search({ query: "value" });
    await vi.waitFor(() => expect(store.payloadIndexCollections).toEqual([firstCollection]));
    await service.rebuild();
    const replacementCollection = service.manifest?.collection;
    expect(replacementCollection).toBeDefined();
    expect(replacementCollection).not.toBe(firstCollection);

    releaseMaintenance?.();
    const response = await search;
    expect(store.payloadIndexCollections).toEqual([firstCollection, replacementCollection]);
    expect(store.searchedCollections).toEqual([replacementCollection]);
    expect(response.results.length).toBeGreaterThan(0);
  });

  it("applies the search timeout while payload-index maintenance is pending", async () => {
    const { options, store } = createFixture(25);
    await createPersistedGeneration(options);
    const service = new WorkspaceCodeRagService(options);
    await service.initialize();
    let releaseMaintenance: (() => void) | undefined;
    store.payloadIndexMaintenanceGate = new Promise<void>((resolve) => {
      releaseMaintenance = resolve;
    });
    const search = service.search({ query: "value" });
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const outcome = await Promise.race([
        search.then(() => "settled" as const),
        new Promise<"hung">((resolve) => {
          timeout = setTimeout(() => resolve("hung"), 500);
        }),
      ]);
      expect(outcome).toBe("settled");
    } finally {
      if (timeout) clearTimeout(timeout);
      releaseMaintenance?.();
      await search;
    }
    expect((await search).status.lastError?.code).toBe("RAG_TIMEOUT");
  });

  it("serializes concurrent refreshes after payload-index migration", async () => {
    const { directory, options, store } = createFixture(undefined, 5);
    const collection = await createPersistedGeneration(options);
    const service = new WorkspaceCodeRagService(options);
    await service.initialize();
    await service.search({ query: "value" });
    const runRefresh = vi.spyOn(service, "runRefresh");

    writeFileSync(join(directory, "source-0.ts"), "export const value0 = 100;\n");
    await Promise.all([service.refresh(), service.refresh()]);
    expect(runRefresh).toHaveBeenCalledTimes(1);
    expect(store.payloadIndexCollections).toEqual([collection]);
  });

  it("maintains legacy indexes before a sparse-generation scan", async () => {
    const { directory, options, store } = createFixture(undefined, 5);
    const collection = await createPersistedGeneration(options);
    const service = new WorkspaceCodeRagService(options);
    await service.initialize();
    store.operations.length = 0;

    writeFileSync(join(directory, "source-0.ts"), "export const value0 = 100;\n");
    await service.refresh({ transactional: true });

    expect(store.operations[0]).toBe(`index:${collection}`);
    expect(store.operations.filter((operation) => operation === `iterate:${collection}`)).toHaveLength(2);
  });

  it("rebuilds a missing collection without attempting legacy index maintenance", async () => {
    const { options, store } = createFixture();
    await createPersistedGeneration(options);
    store.collections.clear();
    store.failNextPayloadIndexMaintenance = true;
    const missingCollectionService = new WorkspaceCodeRagService(options);
    expect((await missingCollectionService.initialize()).state).toBe("stale");
    await expect(missingCollectionService.rebuild()).resolves.toMatchObject({ fullRebuild: true });
    expect(store.failNextPayloadIndexMaintenance).toBe(true);
  });

  it("revalidates payload indexes when the same collection disappears and returns", async () => {
    const { options, store } = createFixture();
    const collection = await createPersistedGeneration(options);
    const service = new WorkspaceCodeRagService(options);
    await service.initialize();
    await service.search({ query: "value" });
    const points = store.collections.get(collection);
    if (!points) throw new Error("Expected persisted fixture points");

    store.collections.clear();
    expect((await service.initialize()).state).toBe("stale");
    store.collections.set(collection, points);
    expect((await service.initialize()).state).toBe("ready");
    store.searchedCollections.length = 0;

    await service.search({ query: "value" });
    expect(store.payloadIndexCollections).toEqual([collection, collection]);
    expect(store.searchedCollections).toEqual([collection]);
  });
});

function createFixture(searchTimeoutMs?: number, fileCount = 1) {
  const directory = mkdtempSync(join(tmpdir(), "p-rag-payload-index-"));
  temporaryDirectories.push(directory);
  for (let index = 0; index < fileCount; index += 1) {
    writeFileSync(join(directory, `source-${index}.ts`), `export const value${index} = ${index};\n`);
  }
  const store = new PayloadIndexStore();
  const options = {
    workspaceRoot: directory,
    dataDirectory: join(directory, "data"),
    vectorStore: store,
    embeddingProvider: {
      dim: 1024,
      encode: async (texts: string[]) => texts.map(() => new Float32Array(1024)),
      encodeQuery: async () => new Float32Array(1024),
    },
    manageLocalBackends: false,
    settings: {
      fullSparseRebuildChangeRatio: 1,
      sparseRebuildDriftRatio: 1,
      ...(searchTimeoutMs === undefined ? {} : { searchTimeoutMs }),
    },
  };
  return { directory, options, store };
}

async function createPersistedGeneration(
  options: ConstructorParameters<typeof WorkspaceCodeRagService>[0],
): Promise<string> {
  const service = new WorkspaceCodeRagService(options);
  await service.refresh();
  const collection = service.manifest?.collection;
  if (!collection) throw new Error("Expected the fixture to create a collection");
  return collection;
}
