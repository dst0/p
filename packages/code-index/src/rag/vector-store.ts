import { deleteObsoleteFileVersions } from "./qdrant-file-version-cleanup.ts";
import { QDRANT_PAYLOAD_INDEXES } from "./qdrant-payload-indexes.ts";
import {
  FetchQdrantRestClient,
  type QdrantFilter,
  type QdrantFilterCondition,
  type QdrantPointId,
  type QdrantRestClient,
  type QdrantStoredPoint,
  type QdrantVectorStoreOptions,
} from "./qdrant-rest-client.ts";
import { StoredPointError } from "./stored-point-error.ts";
import type {
  RagVectorStore,
  SparseVector,
  StoredChunkPayload,
  StoredVectorPoint,
  VectorPoint,
  VectorSearchFilters,
  VectorSearchResult,
} from "./types.ts";

export type { QdrantVectorStoreOptions } from "./qdrant-rest-client.ts";
export { StoredPointError } from "./stored-point-error.ts";

/** HNSW query beam width — lower than default 100 for faster traversal. */
const HNSW_EF = 60;
/** HNSW graph max degree — leaner graph reduces traversal nodes. */
const HNSW_M = 10;
/** HNSW construction beam — higher than query ef for better build quality. */
const HNSW_EF_CONSTRUCTION = 128;
const SCROLL_PAGE_SIZE = 256;

export class QdrantVectorStore implements RagVectorStore {
  private client: QdrantRestClient;
  private upsertBatchSize: number;

  constructor(options: QdrantVectorStoreOptions) {
    this.client = new FetchQdrantRestClient(options);
    this.upsertBatchSize = options.upsertBatchSize ?? 128;
  }

  async collectionExists(collection: string): Promise<boolean> {
    const existence = await this.client.collectionExists(collection);
    return existence.exists;
  }

  async createCollection(collection: string, denseDimensions: number): Promise<void> {
    const existence = await this.client.collectionExists(collection);
    if (existence.exists) {
      const status = await this.collectionStatus(collection);
      if (status.dimensions !== denseDimensions) {
        throw new Error(
          `Collection ${collection} has ${status.dimensions ?? "unknown"} dimensions; expected ${denseDimensions}`,
        );
      }
      await this.createPayloadIndexes(collection);
      return;
    }
    await this.client.createCollection(collection, {
      vectors: { dense: { size: denseDimensions, distance: "Cosine" } },
      sparse_vectors: { sparse: {} },
      on_disk_payload: true,
      hnsw_config: { m: HNSW_M, ef_construction: HNSW_EF_CONSTRUCTION },
      quantization_config: { scalar: { type: "int8" } },
    });
    try {
      await this.createPayloadIndexes(collection);
    } catch (error) {
      await this.client.deleteCollection(collection).catch(() => undefined);
      throw error;
    }
  }

  async deleteCollection(collection: string): Promise<void> {
    const existence = await this.client.collectionExists(collection);
    if (existence.exists) await this.client.deleteCollection(collection);
  }

  async collectionStatus(collection: string): Promise<{ points: number; dimensions: number | undefined }> {
    const info = await this.client.getCollection(collection);
    const vectors = info.config?.params?.vectors;
    let dimensions: number | undefined;
    if (vectors && typeof vectors === "object" && !Array.isArray(vectors)) {
      const dense = (vectors as Record<string, unknown>).dense;
      if (dense && typeof dense === "object" && !Array.isArray(dense)) {
        const size = (dense as Record<string, unknown>).size;
        if (typeof size === "number") dimensions = size;
      }
    }
    return { points: info.points_count ?? 0, dimensions };
  }

  async createPayloadIndexes(collection: string): Promise<void> {
    for (const idx of QDRANT_PAYLOAD_INDEXES) {
      await this.client.createPayloadIndex(collection, {
        field_name: idx.field_name,
        field_schema: idx.field_schema,
      });
    }
  }

  async upsert(collection: string, points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    const batchSize = Math.max(1, this.upsertBatchSize);
    for (let i = 0; i < points.length; i += batchSize) {
      const chunk = points.slice(i, i + batchSize);
      await this.client.upsert(collection, {
        wait: true,
        points: chunk.map((point) => ({
          id: point.id,
          vector: point.vectors,
          payload: point.payload as unknown as Record<string, unknown>,
        })),
      });
    }
  }

  async deleteFileVersions(collection: string, repoId: string, fileId: string, keepFileHash?: string): Promise<void> {
    if (keepFileHash) return deleteObsoleteFileVersions(this.client, collection, repoId, fileId, keepFileHash);
    const filter: QdrantFilter = {
      must: [
        { key: "repoId", match: { value: repoId } },
        { key: "fileId", match: { value: fileId } },
      ],
    };
    await this.client.delete(collection, { wait: true, filter });
  }

  async *iteratePoints(
    collection: string,
    repoId: string,
    withDense: boolean,
    signal?: AbortSignal,
  ): AsyncIterable<StoredVectorPoint> {
    let offset: QdrantPointId | undefined;
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new Error("Qdrant point iteration cancelled");
      const page = await this.client.scroll(
        collection,
        {
          ...(offset === undefined ? {} : { offset }),
          limit: SCROLL_PAGE_SIZE,
          filter: { must: [{ key: "repoId", match: { value: repoId } }] },
          with_payload: true,
          with_vector: withDense ? ["dense"] : false,
        },
        signal,
      );
      if (!Array.isArray(page.points)) throw new StoredPointError("Qdrant scroll returned an invalid point page");
      for (const point of page.points) {
        if (signal?.aborted) throw signal.reason ?? new Error("Qdrant point iteration cancelled");
        yield parseStoredPoint(point, withDense);
      }
      const nextOffset = page.next_page_offset;
      if (nextOffset === undefined || nextOffset === null) return;
      if (typeof nextOffset !== "string" && typeof nextOffset !== "number") {
        throw new StoredPointError("Qdrant scroll returned an invalid offset");
      }
      if (nextOffset === offset) throw new StoredPointError("Qdrant scroll returned a repeated offset");
      offset = nextOffset;
    }
  }

  async search(
    collection: string,
    dense: Float32Array,
    sparse: SparseVector,
    filters: VectorSearchFilters,
    limit: number,
  ): Promise<VectorSearchResult[]> {
    const must: QdrantFilterCondition[] = [{ key: "repoId", match: { value: filters.repoId } }];
    const mustNot: QdrantFilterCondition[] = [];
    if (filters.languages && filters.languages.length > 0) {
      must.push({ key: "language", match: { any: filters.languages } });
    }
    if (!filters.includeTests) mustNot.push({ key: "isTest", match: { value: true } });
    if (!filters.includeGenerated) mustNot.push({ key: "isGenerated", match: { value: true } });
    const filter: QdrantFilter = { must, ...(mustNot.length > 0 ? { must_not: mustNot } : {}) };
    const requestLimit = Math.max(limit, 1);
    const densePromise =
      dense.length > 0
        ? this.client.search(collection, {
            vector: { name: "dense", vector: Array.from(dense) },
            filter,
            limit: requestLimit,
            with_payload: true,
            params: { hnsw_ef: HNSW_EF, quantization: { rescore: true } },
          })
        : Promise.resolve([]);
    const sparsePromise =
      sparse.indices.length > 0
        ? this.client.search(collection, {
            vector: { name: "sparse", vector: sparse },
            filter,
            limit: requestLimit,
            with_payload: true,
            params: { hnsw_ef: HNSW_EF },
          })
        : Promise.resolve([]);
    const [denseResults, sparseResults] = await Promise.all([densePromise, sparsePromise]);

    const scores = new Map<string | number, number>();
    const payloads = new Map<string | number, StoredChunkPayload>();
    const rrfK = 15;
    for (const [rank, result] of denseResults.entries()) {
      scores.set(result.id, (scores.get(result.id) ?? 0) + 1 / (rrfK + rank + 1));
      if (result.payload) payloads.set(result.id, result.payload as unknown as StoredChunkPayload);
    }
    for (const [rank, result] of sparseResults.entries()) {
      scores.set(result.id, (scores.get(result.id) ?? 0) + 1 / (rrfK + rank + 1));
      if (result.payload && !payloads.has(result.id)) {
        payloads.set(result.id, result.payload as unknown as StoredChunkPayload);
      }
    }
    return [...scores.entries()]
      .filter(([id]) => payloads.has(id))
      .sort((left, right) => right[1] - left[1])
      .slice(0, requestLimit)
      .map(([id, score]) => ({ id, score, payload: payloads.get(id)! }));
  }
}

const STRING_PAYLOAD_FIELDS = [
  "repoId",
  "fileId",
  "path",
  "language",
  "symbolName",
  "symbolType",
  "fileHash",
  "chunkHash",
  "chunkerVersion",
  "indexGeneration",
  "content",
  "indexedAt",
] as const satisfies ReadonlyArray<keyof StoredChunkPayload>;

const NUMBER_PAYLOAD_FIELDS = ["startLine", "endLine", "chunkOrdinal"] as const satisfies ReadonlyArray<
  keyof StoredChunkPayload
>;

const BOOLEAN_PAYLOAD_FIELDS = ["isTest", "isGenerated"] as const satisfies ReadonlyArray<keyof StoredChunkPayload>;

function parseStoredPoint(point: QdrantStoredPoint, withDense: boolean): StoredVectorPoint {
  if (typeof point.id !== "string") throw new StoredPointError("Qdrant stored point has a non-string ID");
  const payload = point.payload;
  if (
    !payload ||
    Array.isArray(payload) ||
    STRING_PAYLOAD_FIELDS.some((field) => typeof payload[field] !== "string") ||
    NUMBER_PAYLOAD_FIELDS.some((field) => typeof payload[field] !== "number") ||
    BOOLEAN_PAYLOAD_FIELDS.some((field) => typeof payload[field] !== "boolean")
  ) {
    throw new StoredPointError(`Qdrant stored point ${point.id} has an invalid payload`);
  }
  if (!withDense) return { id: point.id, payload: payload as unknown as StoredChunkPayload };
  const vectors = point.vector;
  const dense =
    vectors && typeof vectors === "object" && !Array.isArray(vectors)
      ? (vectors as Record<string, unknown>).dense
      : undefined;
  if (!Array.isArray(dense) || dense.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new StoredPointError(`Qdrant stored point ${point.id} has an invalid dense vector`);
  }
  return { id: point.id, dense, payload: payload as unknown as StoredChunkPayload };
}
