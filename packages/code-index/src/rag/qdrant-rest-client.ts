import type { QdrantPayloadSchema } from "./qdrant-payload-indexes.ts";
import { assertQdrantUpdateCompleted } from "./qdrant-update-result.ts";
import type { SparseVector, VectorPoint } from "./types.ts";

export interface QdrantVectorStoreOptions {
  url: string;
  timeoutMs: number;
  apiKey?: string;
  upsertBatchSize?: number;
  fetch?: typeof fetch;
}

export type QdrantPointId = string | number;

export interface QdrantFilterCondition {
  key: string;
  match: { value: string | boolean } | { any: string[] };
}

export interface QdrantFilter {
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

export interface QdrantStoredPoint {
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

export interface QdrantRestClient {
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
  deletePoints(collection: string, request: { wait: true; points: QdrantPointId[] }): Promise<void>;
  search(collection: string, request: QdrantSearchRequest): Promise<QdrantScoredPoint[]>;
  scroll(collection: string, request: QdrantScrollRequest, signal?: AbortSignal): Promise<QdrantScrollResult>;
}

export class FetchQdrantRestClient implements QdrantRestClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly apiKey?: string;

  constructor(options: QdrantVectorStoreOptions) {
    this.baseUrl = options.url.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.apiKey = options.apiKey;
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
    const result = await this.request<unknown>("PUT", `${this.collectionPath(collection)}/index?wait=true`, request);
    assertQdrantUpdateCompleted(result, "payload index update");
  }

  async upsert(
    collection: string,
    request: {
      wait: true;
      points: Array<{ id: string; vector: VectorPoint["vectors"]; payload: Record<string, unknown> }>;
    },
  ): Promise<void> {
    const { wait, ...body } = request;
    const result = await this.request<unknown>("PUT", `${this.collectionPath(collection)}/points?wait=${wait}`, body);
    assertQdrantUpdateCompleted(result, "point upsert");
  }

  async delete(collection: string, request: { wait: true; filter: QdrantFilter }): Promise<void> {
    const { wait, ...body } = request;
    const result = await this.request<unknown>(
      "POST",
      `${this.collectionPath(collection)}/points/delete?wait=${wait}`,
      body,
    );
    assertQdrantUpdateCompleted(result, "filtered point deletion");
  }

  async deletePoints(collection: string, request: { wait: true; points: QdrantPointId[] }): Promise<void> {
    const { wait, ...body } = request;
    const result = await this.request<unknown>(
      "POST",
      `${this.collectionPath(collection)}/points/delete?wait=${wait}`,
      body,
    );
    assertQdrantUpdateCompleted(result, "point ID deletion");
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
      const headers: Record<string, string> = {};
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (this.apiKey) headers["api-key"] = this.apiKey;
      response = await this.fetchImpl(`${this.baseUrl}${requestPath}`, {
        method,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
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
