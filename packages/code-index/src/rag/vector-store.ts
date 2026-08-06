import type {
  RagVectorStore,
  SparseVector,
  StoredChunkPayload,
  StoredVectorPoint,
  VectorPoint,
  VectorSearchFilters,
  VectorSearchResult,
} from "./types.ts";

export interface QdrantVectorStoreOptions {
  url: string;
  timeoutMs: number;
  upsertBatchSize?: number;
  fetch?: typeof fetch;
}

type QdrantPointId = string | number;
type QdrantPayloadSchema = "bool" | "keyword";

interface QdrantFilterCondition {
  key: string;
  match: { value: string | boolean } | { any: string[] };
}

interface QdrantFilter {
  must: QdrantFilterCondition[];
  must_not?: QdrantFilterCondition[];
}

interface QdrantCreateCollectionRequest {
  vectors: { dense: { size: number; distance: "Cosine" } };
  sparse_vectors: { sparse: Record<string, never> };
  on_disk_payload: true;
  hnsw_config: { m: number; ef_construction: number };
  quantization_config: { scalar: { type: "int8" } };
}

interface QdrantCollectionInfo {
  points_count?: number;
  config?: { params?: { vectors?: unknown } };
}

interface QdrantSearchRequest {
  vector: { name: "dense"; vector: number[] } | { name: "sparse"; vector: SparseVector };
  filter: QdrantFilter;
  limit: number;
  with_payload: true;
  params: { hnsw_ef: number; quantization?: { rescore: true } };
}

interface QdrantStoredPoint {
  id: QdrantPointId;
  payload?: Record<string, unknown>;
  vector?: unknown;
}

interface QdrantScrollRequest {
  offset?: QdrantPointId;
  limit: number;
  filter: QdrantFilter;
  with_payload: true;
  with_vector: false | ["dense"];
}

interface QdrantScrollResult {
  points: QdrantStoredPoint[];
  next_page_offset?: QdrantPointId | null;
}

type QdrantScoredPoint = QdrantStoredPoint;

interface QdrantRestClient {
  collectionExists(collection: string): Promise<{ exists: boolean }>;
  createCollection(collection: string, request: QdrantCreateCollectionRequest): Promise<void>;
  deleteCollection(collection: string): Promise<void>;
  getCollection(collection: string): Promise<QdrantCollectionInfo>;
  createPayloadIndex(
    collection: string,
    request: { field_name: string; field_schema: QdrantPayloadSchema },
  ): Promise<void>;
  upsert(
    collection: string,
    request: {
      wait: true;
      points: Array<{ id: string; vector: VectorPoint["vectors"]; payload: Record<string, unknown> }>;
    },
  ): Promise<void>;
  delete(collection: string, request: { wait: true; filter: QdrantFilter }): Promise<void>;
  search(collection: string, request: QdrantSearchRequest): Promise<QdrantScoredPoint[]>;
  scroll(collection: string, request: QdrantScrollRequest, signal?: AbortSignal): Promise<QdrantScrollResult>;
}

class FetchQdrantRestClient implements QdrantRestClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: QdrantVectorStoreOptions) {
    this.baseUrl = options.url.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async collectionExists(collection: string): Promise<{ exists: boolean }> {
    return this.request("GET", `${this.collectionPath(collection)}/exists`);
  }

  async createCollection(collection: string, request: QdrantCreateCollectionRequest): Promise<void> {
    await this.request("PUT", this.collectionPath(collection), request);
  }

  async deleteCollection(collection: string): Promise<void> {
    await this.request("DELETE", this.collectionPath(collection));
  }

  async getCollection(collection: string): Promise<QdrantCollectionInfo> {
    return this.request("GET", this.collectionPath(collection));
  }

  async createPayloadIndex(
    collection: string,
    request: { field_name: string; field_schema: QdrantPayloadSchema },
  ): Promise<void> {
    await this.request("PUT", `${this.collectionPath(collection)}/index`, request);
  }

  async upsert(
    collection: string,
    request: {
      wait: true;
      points: Array<{ id: string; vector: VectorPoint["vectors"]; payload: Record<string, unknown> }>;
    },
  ): Promise<void> {
    const { wait, ...body } = request;
    await this.request("PUT", `${this.collectionPath(collection)}/points?wait=${wait}`, body);
  }

  async delete(collection: string, request: { wait: true; filter: QdrantFilter }): Promise<void> {
    const { wait, ...body } = request;
    await this.request("POST", `${this.collectionPath(collection)}/points/delete?wait=${wait}`, body);
  }

  async search(collection: string, request: QdrantSearchRequest): Promise<QdrantScoredPoint[]> {
    return this.request("POST", `${this.collectionPath(collection)}/points/search`, request);
  }

  async scroll(collection: string, request: QdrantScrollRequest, signal?: AbortSignal): Promise<QdrantScrollResult> {
    return this.request("POST", `${this.collectionPath(collection)}/points/scroll`, request, signal);
  }

  private collectionPath(collection: string): string {
    return `/collections/${encodeURIComponent(collection)}`;
  }

  private async request<T>(method: string, requestPath: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
      response = await this.fetchImpl(`${this.baseUrl}${requestPath}`, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Qdrant ${method} ${requestPath} failed: ${message}`, { cause: error });
    }

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Qdrant ${method} ${requestPath} returned HTTP ${response.status}: ${responseText.slice(0, 500)}`,
      );
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(responseText);
    } catch (error) {
      throw new Error(`Qdrant ${method} ${requestPath} returned invalid JSON`, { cause: error });
    }
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded) || !("result" in decoded)) {
      throw new Error(`Qdrant ${method} ${requestPath} returned a response without a result`);
    }
    return (decoded as { result: T }).result;
  }
}

/** HNSW query beam width — lower than default 100 for faster traversal. */
const HNSW_EF = 60;
/** HNSW graph max degree — leaner graph reduces traversal nodes. */
const HNSW_M = 10;
/** HNSW construction beam — higher than query ef for better build quality. */
const HNSW_EF_CONSTRUCTION = 128;
const SCROLL_PAGE_SIZE = 256;

export class StoredPointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoredPointError";
  }
}

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
      return;
    }
    await this.client.createCollection(collection, {
      vectors: { dense: { size: denseDimensions, distance: "Cosine" } },
      sparse_vectors: { sparse: {} },
      on_disk_payload: true,
      hnsw_config: { m: HNSW_M, ef_construction: HNSW_EF_CONSTRUCTION },
      quantization_config: { scalar: { type: "int8" } },
    });
    await this.createPayloadIndexes(collection);
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
    const indexes: Array<{ field_name: string; field_schema: QdrantPayloadSchema }> = [
      { field_name: "repoId", field_schema: "keyword" },
      { field_name: "language", field_schema: "keyword" },
      { field_name: "isTest", field_schema: "bool" },
      { field_name: "isGenerated", field_schema: "bool" },
    ];
    for (const idx of indexes) {
      try {
        await this.client.createPayloadIndex(collection, {
          field_name: idx.field_name,
          field_schema: idx.field_schema,
        });
      } catch {
        // Index may already exist from a prior run; best effort.
      }
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
    const filter: QdrantFilter = {
      must: [
        { key: "repoId", match: { value: repoId } },
        { key: "fileId", match: { value: fileId } },
      ],
    };
    if (keepFileHash) {
      filter.must_not = [{ key: "fileHash", match: { value: keepFileHash } }];
    }
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
    const filter = createSearchFilter(filters);
    const requestLimit = Math.max(limit, 1);
    const densePromise = this.client.search(collection, {
      vector: { name: "dense", vector: Array.from(dense) },
      filter,
      limit: requestLimit,
      with_payload: true,
      params: { hnsw_ef: HNSW_EF, quantization: { rescore: true } },
    });
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

function createSearchFilter(filters: VectorSearchFilters): QdrantFilter {
  const must: QdrantFilterCondition[] = [{ key: "repoId", match: { value: filters.repoId } }];
  const mustNot: QdrantFilterCondition[] = [];
  if (filters.languages && filters.languages.length > 0) {
    must.push({ key: "language", match: { any: filters.languages } });
  }
  if (!filters.includeTests) mustNot.push({ key: "isTest", match: { value: true } });
  if (!filters.includeGenerated) mustNot.push({ key: "isGenerated", match: { value: true } });
  return { must, ...(mustNot.length > 0 ? { must_not: mustNot } : {}) };
}
