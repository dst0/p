import fs, { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWorkspaceCodeRagSettings } from "../src/rag/config.ts";
import { executeFilePreparationTask } from "../src/rag/file-preparation-core.ts";
import { acquireRepositoryLock } from "../src/rag/manifest.ts";
import { WorkspaceCodeRagService } from "../src/rag/service.ts";
import type { RagVectorStore, StoredChunkPayload, VectorPoint, VectorSearchFilters } from "../src/rag/types.ts";
import { QdrantVectorStore } from "../src/rag/vector-store.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

class MockVectorStore implements RagVectorStore {
  public exists = false;
  public dimensions = 1024;
  public points: VectorPoint[] = [];

  async collectionExists(_collection: string): Promise<boolean> {
    return this.exists;
  }
  async createCollection(_collection: string, _denseDimensions: number): Promise<void> {
    this.exists = true;
  }
  async deleteCollection(_collection: string): Promise<void> {
    this.exists = false;
  }
  async collectionStatus(_collection: string): Promise<{ points: number; dimensions: number | undefined }> {
    return { points: this.points.length, dimensions: this.dimensions };
  }
  async createPayloadIndexes(_collection: string): Promise<void> {}
  async upsert(_collection: string, points: VectorPoint[]): Promise<void> {
    this.points.push(...points);
  }
  async deleteFileVersions(_collection: string, _repoId: string, _fileId: string): Promise<void> {}
  async search(
    _collection: string,
    _dense: Float32Array,
    _sparse: any,
    _filters: VectorSearchFilters,
    _limit: number,
  ): Promise<any[]> {
    return this.points.map((p, idx) => ({ id: p.id, score: 0.9 - idx * 0.1, payload: p.payload }));
  }
}

describe("rag config & manifest deep coverage", () => {
  it("parses valid boolean and string fields in loadWorkspaceCodeRagSettings", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-rag-cfg-"));
    temporaryDirectories.push(dir);
    const userCfg = join(dir, "code-rag.json");
    writeFileSync(
      userCfg,
      JSON.stringify({
        enabled: true,
        autoRefresh: false,
        qdrantUrl: "http://127.0.0.1:6333",
        embeddingModel: "Qwen/Qwen3-Embedding-0.6B",
      }),
    );

    const settings = loadWorkspaceCodeRagSettings({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      userConfigPath: userCfg,
      manageLocalBackends: false,
    });
    expect(settings.enabled).toBe(true);
    expect(settings.autoRefresh).toBe(false);
    expect(settings.qdrantUrl).toBe("http://127.0.0.1:6333");
  });

  it("handles acquireRepositoryLock error branches", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-lock-err-"));
    temporaryDirectories.push(dir);

    // Make lock file unopenable (or mock openSync error)
    const openSyncSpy = vi.spyOn(fs, "openSync").mockImplementation((_path: any, flags: any) => {
      if (flags === "wx") {
        const err = new Error("Permission denied") as any;
        err.code = "EACCES";
        throw err;
      }
      return 1;
    });

    expect(() => acquireRepositoryLock(dir)).toThrow("Permission denied");
    openSyncSpy.mockRestore();
  });

  it("handles lock.release error branch when unlinkSync throws non-ENOENT error", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-lock-rel-"));
    temporaryDirectories.push(dir);

    const lock = acquireRepositoryLock(dir);

    const unlinkSyncSpy = vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
      const err = new Error("Access denied") as any;
      err.code = "EPERM";
      throw err;
    });

    expect(() => lock.release()).toThrow("Access denied");
    unlinkSyncSpy.mockRestore();
  });
});

describe("QdrantVectorStore createCollection when missing", () => {
  it("calls fetch PUT to create collection when collectionExists returns false", async () => {
    const store = new QdrantVectorStore({ url: "http://127.0.0.1:6333", timeoutMs: 5000 });
    const client = (store as any).client;

    vi.spyOn(client, "collectionExists").mockResolvedValue({ exists: false });
    const createSpy = vi.spyOn(client, "createCollection").mockResolvedValue(undefined);
    vi.spyOn(store, "createPayloadIndexes").mockResolvedValue(undefined);

    await store.createCollection("new_coll", 1024);
    expect(createSpy).toHaveBeenCalledWith("new_coll", expect.objectContaining({ on_disk_payload: true }));
  });
});

describe("WorkspaceCodeRagService deep coverage", () => {
  it("handles constructor config error", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-bad-cfg-"));
    temporaryDirectories.push(dir);

    const service = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      settings: { defaultLimit: 500 } as any, // invalid limit > maxLimit (100)
      manageLocalBackends: false,
    });

    expect((service as any).state).toBe("unavailable");
  });

  it("handles search require_fresh when refresh fails and when allowStaleSearch is false", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-service-stale-"));
    temporaryDirectories.push(dir);
    writeFileSync(join(dir, "test.ts"), "export const a = 1;");

    const store = new MockVectorStore();
    const service = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      vectorStore: store,
      embeddingProvider: {
        dim: 1024,
        encode: async () => [new Float32Array(1024)],
        encodeQuery: async () => new Float32Array(1024),
      },
      manageLocalBackends: false,
    });

    await service.initialize();
    (service as any).state = "stale";
    (service as any).staleReason = "Test stale";

    // Refresh throws
    vi.spyOn(service, "refresh").mockRejectedValue(new Error("Refresh failed"));

    const resp = await service.search({ query: "test", freshness: "require_fresh" });
    expect(resp.results).toEqual([]);

    // allowStaleSearch is false
    (service as any).settings.allowStaleSearch = false;
    const respStaleBlocked = await service.search({ query: "test", freshness: "prefer_fresh" });
    expect(respStaleBlocked.results).toEqual([]);
  });

  it("handles formatHits truncation for maxResultCharacters and maxContextCharacters", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-trunc-test-"));
    temporaryDirectories.push(dir);

    const store = new MockVectorStore();
    const payloadLong: StoredChunkPayload = {
      repoId: "r1",
      fileId: "f1",
      path: "src/long.ts",
      language: "typescript",
      symbolName: "fnLong",
      symbolType: "function",
      startLine: 1,
      endLine: 100,
      fileHash: "h1",
      chunkHash: "c1",
      chunkOrdinal: 0,
      chunkerVersion: "2",
      indexGeneration: "gen1",
      isTest: false,
      isGenerated: false,
      content: "x".repeat(5000), // > maxResultCharacters (4000)
      indexedAt: "2026-01-01",
    };

    store.points.push({
      id: "p1",
      vectors: { dense: [0.1], sparse: { indices: [0], values: [1] } },
      payload: payloadLong as any,
    });

    const service = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      vectorStore: store,
      embeddingProvider: {
        dim: 1024,
        encode: async () => [new Float32Array(1024)],
        encodeQuery: async () => new Float32Array(1024),
      },
      manageLocalBackends: false,
    });

    const formatRes = (service as any).formatHits([{ score: 0.9, payload: payloadLong }], {
      query: "test",
      limit: 10,
      includeTests: true,
      includeGenerated: false,
      freshness: "prefer_fresh",
    });

    expect(formatRes.truncated).toBe(true);
    expect(formatRes.hits[0].content).toContain("[snippet truncated]");
  });

  it("handles formatHits pathPrefix filtering", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-prefix-test-"));
    temporaryDirectories.push(dir);

    const payload1: StoredChunkPayload = {
      repoId: "r1",
      fileId: "f1",
      path: "src/components/button.ts",
      language: "typescript",
      symbolName: "Button",
      symbolType: "function",
      startLine: 1,
      endLine: 10,
      fileHash: "h1",
      chunkHash: "c1",
      chunkOrdinal: 0,
      chunkerVersion: "2",
      indexGeneration: "gen1",
      isTest: false,
      isGenerated: false,
      content: "export const Button = () => {};",
      indexedAt: "2026-01-01",
    };

    const service = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      manageLocalBackends: false,
    });

    const res = (service as any).formatHits([{ score: 0.9, payload: payload1 }], {
      query: "test",
      limit: 10,
      pathPrefix: "src/utils", // prefix doesn't match
      includeTests: true,
      includeGenerated: false,
      freshness: "prefer_fresh",
    });

    expect(res.hits).toHaveLength(0);
  });

  it("handles updateFastFreshness file set change and file stat change", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-fast-fresh-"));
    temporaryDirectories.push(dir);
    const file1 = join(dir, "f1.ts");
    writeFileSync(file1, "const x = 1;");

    const store = new MockVectorStore();
    const service = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      vectorStore: store,
      embeddingProvider: {
        dim: 1024,
        encode: async () => [new Float32Array(1024)],
        encodeQuery: async () => new Float32Array(1024),
      },
      manageLocalBackends: false,
    });

    await service.refresh();
    expect((service as any).state).toBe("ready");

    // Touch file so set of indexed files changes
    writeFileSync(join(dir, "f2.ts"), "const y = 2;");
    (service as any).updateFastFreshness();
    expect((service as any).state).toBe("stale");
    expect((service as any).staleReason).toContain("indexed file set changed");
  });

  it("rejects a file that changes throughout all stable-read attempts", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-mutate-test-"));
    temporaryDirectories.push(dir);
    const file = join(dir, "changing.ts");
    writeFileSync(file, "content 1");
    const actualStat = fs.statSync(file);
    let count = 0;
    vi.spyOn(fs, "fstatSync").mockImplementation(() => {
      count++;
      return {
        ...actualStat,
        size: actualStat.size + count,
        mtimeMs: actualStat.mtimeMs + count,
        isFile: () => true,
      } as fs.Stats;
    });

    expect(() =>
      executeFilePreparationTask({
        operation: "prepare",
        absPath: file,
        path: "changing.ts",
        language: "typescript",
        isTest: false,
        isGenerated: false,
        maxFileBytes: 1024,
        defaultChunkLines: 80,
        maxChunkLines: 300,
        maxChunksPerFile: 2_000,
      }),
    ).toThrow("File kept changing while indexing");
  });

  it("handles normalizePathFilter security validations", () => {
    const service = new WorkspaceCodeRagService({
      workspaceRoot: "/tmp",
      dataDirectory: "/tmp/data",
      manageLocalBackends: false,
    });

    expect(() => (service as any).normalizeSearchInput({ query: "q", pathPrefix: "../escape" })).toThrow(
      "Path filter cannot escape the repository",
    );
    expect(() => (service as any).normalizeSearchInput({ query: "q", pathPrefix: "/abs/path" })).toThrow(
      "Path filter must be repository-relative",
    );
  });
});
