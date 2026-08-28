import { describe, expect, it, vi } from "vitest";
import { QdrantCollectionAdmin } from "../src/rag/qdrant-collection-admin.ts";
import { QdrantVectorStore } from "../src/rag/vector-store.ts";

describe("Qdrant collection maintenance", () => {
  it("indexes the selective file identity field without indexing high-cardinality hashes", async () => {
    const createPayloadIndex = vi.fn().mockResolvedValue(undefined);
    const store = new QdrantVectorStore({ url: "http://localhost:6333", timeoutMs: 10_000 });
    (
      store as unknown as {
        client: { createPayloadIndex: typeof createPayloadIndex };
      }
    ).client = { createPayloadIndex };

    await store.createPayloadIndexes("collection");

    expect(createPayloadIndex.mock.calls.map(([, request]) => request)).toContainEqual({
      field_name: "fileId",
      field_schema: "keyword",
    });
    expect(createPayloadIndex.mock.calls.map(([, request]) => request)).not.toContainEqual({
      field_name: "fileHash",
      field_schema: "keyword",
    });
  });

  it("lists collections and backfills lifecycle indexes through the admin API", async () => {
    const requests: Array<{ body?: string; method?: string; url: string }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });
      return Response.json({
        result: url.endsWith("/collections")
          ? { collections: [{ name: "first" }, { name: "second" }] }
          : { status: "completed" },
      });
    });
    const admin = new QdrantCollectionAdmin({
      url: "http://localhost:6333",
      timeoutMs: 10_000,
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await expect(admin.listCollections()).resolves.toEqual(["first", "second"]);
    await admin.createPayloadIndexes("first");

    const indexes = requests.flatMap((request) => (request.body ? [JSON.parse(request.body) as unknown] : []));
    const indexRequests = requests.filter((request) => request.body);
    expect(indexRequests.every((request) => request.url.endsWith("/index?wait=true"))).toBe(true);
    expect(indexes).toContainEqual({ field_name: "fileId", field_schema: "keyword" });
    expect(indexes).not.toContainEqual({ field_name: "fileHash", field_schema: "keyword" });
  });

  it("surfaces payload-index backfill failures", async () => {
    const fetchImpl = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const admin = new QdrantCollectionAdmin({
      url: "http://localhost:6333",
      timeoutMs: 10_000,
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await expect(admin.createPayloadIndexes("first")).rejects.toThrow("returned HTTP 503");
  });

  it("rejects acknowledged but incomplete payload-index operations", async () => {
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      requests.push(String(input));
      return Response.json({ result: { operation_id: 7, status: "acknowledged" } });
    });
    const store = new QdrantVectorStore({
      url: "http://localhost:6333",
      timeoutMs: 10_000,
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await expect(store.createPayloadIndexes("first")).rejects.toThrow("payload index update did not complete");
    expect(requests).toEqual(["http://localhost:6333/collections/first/index?wait=true"]);
  });

  it("rejects acknowledged but incomplete admin backfills", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ result: { operation_id: 8, status: "acknowledged" } }));
    const admin = new QdrantCollectionAdmin({
      url: "http://localhost:6333",
      timeoutMs: 10_000,
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await expect(admin.createPayloadIndexes("first")).rejects.toThrow("payload index update did not complete");
  });

  it("deletes an encoded collection through the admin API", async () => {
    const requests: Array<{ body: BodyInit | null | undefined; method: string | undefined; url: string }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method, body: init?.body });
      return Response.json({ result: true });
    });
    const admin = new QdrantCollectionAdmin({
      url: "http://localhost:6333/",
      timeoutMs: 10_000,
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await admin.deleteCollection("repo/main generation");

    expect(requests).toEqual([
      {
        url: "http://localhost:6333/collections/repo%2Fmain%20generation",
        method: "DELETE",
        body: undefined,
      },
    ]);
  });

  it.each([new Error("socket closed"), "socket closed"])(
    "reports collection-list transport failures without losing their cause (%s)",
    async (failure) => {
      const admin = new QdrantCollectionAdmin({
        url: "http://localhost:6333",
        timeoutMs: 10_000,
        fetch: vi.fn(async () => Promise.reject(failure)) as unknown as typeof fetch,
      });

      await expect(admin.listCollections()).rejects.toThrow("Qdrant GET /collections failed: socket closed");
    },
  );

  it.each([
    ["invalid JSON", () => new Response("not-json"), "returned invalid JSON"],
    ["missing result", () => Response.json({ status: "ok" }), "response without a result"],
  ])("rejects malformed collection-list responses: %s", async (_case, response, expectedMessage) => {
    const admin = new QdrantCollectionAdmin({
      url: "http://localhost:6333",
      timeoutMs: 10_000,
      fetch: vi.fn(async () => response()) as unknown as typeof fetch,
    });

    await expect(admin.listCollections()).rejects.toThrow(expectedMessage);
  });
});
