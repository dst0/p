import type {
  RagVectorStore,
  SparseVector,
  StoredVectorPoint,
  VectorPoint,
  VectorSearchFilters,
  VectorSearchResult,
} from "../src/index.ts";

export class FakeVectorStore implements RagVectorStore {
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
