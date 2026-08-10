import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../src/embed/provider.ts";
import { WorkspaceCodeRagService } from "../src/rag/service/workspacecoderagservice.ts";
import type { RagVectorStore, VectorPoint } from "../src/rag/types.ts";
import { QdrantVectorStore } from "../src/rag/vector-store.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("BM25-only indexing", () => {
  it("rebuilds and searches without starting or calling the embedding provider", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p-bm25-only-"));
    temporaryDirectories.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, ".git"));
    fs.writeFileSync(path.join(workspaceRoot, "rocket.ts"), "export const launchRocket = () => 'orbit';\n");
    const points: VectorPoint[] = [];
    let collectionExists = false;
    const search = vi.fn<RagVectorStore["search"]>(async (_collection, dense, sparse) => {
      expect(dense).toHaveLength(0);
      expect(sparse.indices.length).toBeGreaterThan(0);
      return points.map((point) => ({ id: point.id, score: 1, payload: point.payload }));
    });
    const vectorStore: RagVectorStore = {
      collectionExists: async () => collectionExists,
      createCollection: async () => {
        collectionExists = true;
      },
      deleteCollection: async () => {},
      collectionStatus: async () => ({ points: points.length, dimensions: 1024 }),
      upsert: async (_collection, nextPoints) => {
        points.push(...nextPoints);
      },
      deleteFileVersions: async () => {},
      search,
    };
    const ensureReady = vi.fn(async () => {});
    const encode = vi.fn(async () => [new Float32Array(1024)]);
    const encodeQuery = vi.fn(async () => new Float32Array(1024));
    const embeddingProvider: EmbeddingProvider = { dim: 1024, ensureReady, encode, encodeQuery };
    const service = new WorkspaceCodeRagService({
      workspaceRoot,
      dataDirectory: path.join(workspaceRoot, ".index"),
      settings: { autoRefresh: false, searchMode: "bm25-only" },
      embeddingProvider,
      vectorStore,
    });

    const rebuilt = await service.rebuild();
    const result = await service.search({ query: "launch rocket into orbit", freshness: "allow_stale" });

    expect(rebuilt.status.state).toBe("ready");
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point) => point.vectors.dense === undefined)).toBe(true);
    expect(result.results.some((hit) => hit.path === "rocket.ts")).toBe(true);
    expect(search).toHaveBeenCalledOnce();
    expect(ensureReady).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
    expect(encodeQuery).not.toHaveBeenCalled();
    await service.dispose();
  });

  it("sends only a sparse Qdrant search when the dense query is empty", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { vector: { name: string } };
      expect(body.vector.name).toBe("sparse");
      return new Response(JSON.stringify({ result: [] }), { status: 200 });
    });
    const store = new QdrantVectorStore({ url: "http://127.0.0.1:6333", timeoutMs: 10_000, fetch: fetchMock });

    await store.search(
      "collection",
      new Float32Array(0),
      { indices: [1], values: [1] },
      { repoId: "repo", includeTests: true, includeGenerated: true },
      10,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
