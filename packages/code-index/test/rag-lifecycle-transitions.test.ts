import fs, { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWorkspaceCodeRagSettings } from "../src/rag/config.ts";
import { acquireRepositoryLock } from "../src/rag/manifest.ts";
import { WorkspaceCodeRagService } from "../src/rag/service.ts";
import type {
  RagVectorStore,
  SparseVector,
  VectorPoint,
  VectorSearchFilters,
  VectorSearchResult,
} from "../src/rag/types.ts";

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
  async upsert(_collection: string, points: VectorPoint[]): Promise<void> {
    this.points.push(...points);
  }
  async deleteFileVersions(_collection: string, _repoId: string, _fileId: string): Promise<void> {}
  async search(
    _collection: string,
    _dense: Float32Array,
    _sparse: SparseVector,
    _filters: VectorSearchFilters,
    _limit: number,
  ): Promise<VectorSearchResult[]> {
    return this.points.map((p, idx) => ({ id: p.id, score: 0.9 - idx * 0.1, payload: p.payload }));
  }
}

describe("RAG lifecycle states and repository lock management", () => {
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

    const openSyncSpy = vi.spyOn(fs, "openSync").mockImplementation((_path: unknown, flags: unknown) => {
      if (flags === "wx") {
        const err = new Error("Permission denied") as Error & { code?: string };
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
      const err = new Error("Access denied") as Error & { code?: string };
      err.code = "EPERM";
      throw err;
    });

    expect(() => lock.release()).toThrow("Access denied");
    unlinkSyncSpy.mockRestore();
  });

  it("transitions to stale state when file set changes during fast freshness check", async () => {
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
        encode: async (texts: string[]) => texts.map(() => new Float32Array(1024)),
        encodeQuery: async () => new Float32Array(1024),
      },
      manageLocalBackends: false,
      settings: {
        preparationWorkerMemoryBytes: 1 * 1024 * 1024,
        preparationMemoryReserveBytes: 1 * 1024 * 1024,
      },
    });

    await service.refresh();
    expect((service as unknown as { state: string }).state).toBe("ready");

    writeFileSync(join(dir, "f2.ts"), "const y = 2;");
    (service as unknown as { updateFastFreshness(): void }).updateFastFreshness();
    expect((service as unknown as { state: string }).state).toBe("stale");
    expect((service as unknown as { staleReason?: string }).staleReason).toContain("indexed file set changed");
  });

  it("handles disabled service and disposed service states", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "p-rag-disabled-"));
    temporaryDirectories.push(tmpDir);

    const service = new WorkspaceCodeRagService({
      workspaceRoot: tmpDir,
      dataDirectory: tmpDir,
      settings: { enabled: false },
    });

    const status = await service.initialize();
    expect(status.state).toBe("disabled");

    const searchRes = await service.search({ query: "test" });
    expect(searchRes.results).toEqual([]);

    const refreshRes = await service.refresh();
    expect(refreshRes.fullRebuild).toBe(false);

    const rebuildRes = await service.rebuild();
    expect(rebuildRes.fullRebuild).toBe(true);

    await service.dispose();
    await service.dispose(); // idempotent

    await expect(service.initialize()).rejects.toThrow("Code RAG service has been disposed");
  });

  it("handles configuration error states gracefully", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "p-rag-conf-err-"));
    temporaryDirectories.push(tmpDir);

    const service = new WorkspaceCodeRagService({
      workspaceRoot: tmpDir,
      dataDirectory: tmpDir,
      settings: { embeddingServerUrl: "bad-url-no-protocol" },
    });

    expect((service as unknown as { configurationError?: Error }).configurationError).toBeDefined();
    const status = await service.initialize();
    expect(status.state).toBe("unavailable");

    await expect(service.refresh()).rejects.toThrow("Code RAG embeddingServerUrl must be a valid absolute URL");
  });

  it("throws error when workspace root is not a directory", () => {
    const tmpFile = join(tmpdir(), `p-rag-file-${Date.now()}.txt`);
    writeFileSync(tmpFile, "not a directory");
    temporaryDirectories.push(tmpFile);

    expect(() => {
      new WorkspaceCodeRagService({
        workspaceRoot: tmpFile,
        dataDirectory: tmpdir(),
      });
    }).toThrow("Code RAG workspace is not a directory");
  });

  it("uses default port 6333 when qdrantUrl omits explicit port", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "p-qdrant-defport-"));
    temporaryDirectories.push(tmpDir);

    const service = new WorkspaceCodeRagService({
      workspaceRoot: tmpDir,
      dataDirectory: tmpDir,
      settings: { qdrantUrl: "http://127.0.0.1" },
    });
    expect((service.qdrantServerManager as unknown as { port: number })?.port).toBe(6333);
    expect(service.settings.qdrantUrl).toBe("http://127.0.0.1:6333");
    expect((service.vectorStore as unknown as { client: { baseUrl: string } }).client.baseUrl).toBe(
      "http://127.0.0.1:6333",
    );
  });
});
