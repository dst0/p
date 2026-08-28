import { QDRANT_PAYLOAD_INDEXES } from "./qdrant-payload-indexes.ts";
import { assertQdrantUpdateCompleted } from "./qdrant-update-result.ts";

export interface QdrantCollectionAdminOptions {
  url: string;
  timeoutMs: number;
  apiKey?: string;
  fetch?: typeof fetch;
}

interface QdrantCollectionsInfo {
  collections: Array<{ name: string }>;
}

/** Performs collection-level maintenance outside repository search operations. */
export class QdrantCollectionAdmin {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: QdrantCollectionAdminOptions) {
    this.baseUrl = options.url.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async listCollections(): Promise<string[]> {
    const result = await this.request<QdrantCollectionsInfo>("GET", "/collections");
    return result.collections.map((collection) => collection.name);
  }

  async createPayloadIndexes(collection: string): Promise<void> {
    for (const index of QDRANT_PAYLOAD_INDEXES) {
      const result = await this.request<unknown>("PUT", `${this.collectionPath(collection)}/index?wait=true`, index);
      assertQdrantUpdateCompleted(result, "payload index update");
    }
  }

  async deleteCollection(collection: string): Promise<void> {
    await this.request("DELETE", this.collectionPath(collection));
  }

  private collectionPath(collection: string): string {
    return `/collections/${encodeURIComponent(collection)}`;
  }

  private async request<T>(method: string, requestPath: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      const headers: Record<string, string> = {};
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (this.apiKey) headers["api-key"] = this.apiKey;
      response = await this.fetchImpl(`${this.baseUrl}${requestPath}`, {
        method,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
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
