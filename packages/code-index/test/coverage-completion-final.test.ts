import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCliMain } from "../src/cli.ts";
import { findRepos } from "../src/discover.ts";
import { EmbeddingProviderHttp } from "../src/embed/http.ts";
import { QdrantServerManager } from "../src/embed/qdrant-server.ts";
import { EmbeddingServerManager } from "../src/embed/server.ts";
import { CodeIndexer } from "../src/indexer.ts";
import { loadWorkspaceCodeRagSettings } from "../src/rag/config.ts";
import { acquireRepositoryLock } from "../src/rag/manifest.ts";
import { WorkspaceCodeRagService } from "../src/rag/service.ts";
import type { RagVectorStore, VectorSearchFilters } from "../src/rag/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

class MockVectorStore implements RagVectorStore {
  public exists = true;
  public dimensions = 1024;
  public points: any[] = [];
  public searchRejects = false;

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
  async upsert(_collection: string, points: any[]): Promise<void> {
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
    if (this.searchRejects) throw new Error("Search failed");
    return this.points.map((p, idx) => ({ id: p.id, score: 0.9 - idx * 0.1, payload: p.payload }));
  }
}

describe("cli.ts runCliMain exported function", () => {
  it("runs runCliMain and handles errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(CodeIndexer.prototype, "getStatus").mockRejectedValue(new Error("Cli main error test"));

    await runCliMain(["node", "cli.ts", "--status"]);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("discover.ts findRepos permission error branch", () => {
  it("handles readdirSync throwing in subdirectories during findRepos", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-find-perm-"));
    temporaryDirectories.push(dir);
    const sub = join(dir, "sub");
    mkdirSync(sub);

    const readdirSpy = vi.spyOn(fs as any, "readdirSync").mockImplementation((p: any, opts: any) => {
      if (String(p) === sub) throw new Error("EACCES");
      return fs.readdirSync(p, opts);
    });

    expect(findRepos(dir)).toEqual([]);
    readdirSpy.mockRestore();
  });
});

describe("embed/http.ts retry loop multiple attempts", () => {
  it("retries on HTTP 500 and throws on maxRetries", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:28752", 1024, false, "Qwen/Qwen3-Embedding-0.6B", {
      maxRetries: 1,
    });

    let attempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      attempts++;
      return new Response(`500 Error attempt ${attempts}`, { status: 500 });
    });

    await expect(provider.encode(["text"])).rejects.toThrow("Embedding server error 500");
    expect(attempts).toBe(2);
  });

  it("retries on TimeoutError and throws on maxRetries", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:28752", 1024, false, "Qwen/Qwen3-Embedding-0.6B", {
      maxRetries: 1,
      requestTimeoutMs: 100,
    });

    let attempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      attempts++;
      const err = new Error("Timeout");
      err.name = "TimeoutError";
      throw err;
    });

    await expect(provider.encode(["text"])).rejects.toThrow("Embedding server request timed out");
    expect(attempts).toBe(2);
  });
});

describe("server managers onAbort pre-aborted signal branch", () => {
  it("executes onAbort immediately when signal is pre-aborted in EmbeddingServerManager", async () => {
    const manager = new EmbeddingServerManager(28753);
    const controller = new AbortController();
    controller.abort(new Error("Pre-aborted signal"));

    await expect(manager.ensureStarted(controller.signal)).rejects.toThrow("Pre-aborted signal");
  });

  it("executes onAbort immediately when signal is pre-aborted in QdrantServerManager", async () => {
    const manager = new QdrantServerManager(64353);
    const controller = new AbortController();
    controller.abort(new Error("Pre-aborted Qdrant signal"));

    await expect(manager.ensureStarted(controller.signal)).rejects.toThrow("Pre-aborted Qdrant signal");
  });
});

describe("rag/config.ts invalid JSON parse and positive number validation", () => {
  it("throws error for invalid JSON syntax in config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-bad-json-"));
    temporaryDirectories.push(dir);
    const badCfg = join(dir, "bad-code-rag.json");
    writeFileSync(badCfg, "{ bad json syntax ");

    expect(() =>
      loadWorkspaceCodeRagSettings({
        workspaceRoot: dir,
        dataDirectory: join(dir, "data"),
        userConfigPath: badCfg,
        manageLocalBackends: false,
      }),
    ).toThrow("Invalid code RAG config");
  });

  it("throws error for non-positive numeric settings", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-nonpos-"));
    temporaryDirectories.push(dir);

    expect(() =>
      loadWorkspaceCodeRagSettings({
        workspaceRoot: dir,
        dataDirectory: join(dir, "data"),
        settings: { searchTimeoutMs: 0 } as any,
        manageLocalBackends: false,
      }),
    ).toThrow("Code RAG numeric settings must be positive");
  });
});

describe("rag/manifest.ts lock file stale cleanup and stat error", () => {
  it("handles lock file with dead PID and cleans up stale lock", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-stale-lock-"));
    temporaryDirectories.push(dir);
    const lockFile = join(dir, "refresh.lock");
    writeFileSync(lockFile, JSON.stringify({ pid: 9999999 })); // non-existent PID

    const lock = acquireRepositoryLock(dir);
    expect(lock).toBeDefined();
    lock.release();
  });

  it("handles statSync throwing non-ENOENT error during acquireRepositoryLock", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-stat-err-"));
    temporaryDirectories.push(dir);

    const statSpy = vi.spyOn(fs, "statSync").mockImplementation(() => {
      const err = new Error("Permission error") as any;
      err.code = "EACCES";
      throw err;
    });

    expect(() => acquireRepositoryLock(dir)).toThrow("Permission error");
    statSpy.mockRestore();
  });
});

describe("rag/service.ts partial state search, background refresh, and unchanged files", () => {
  it("handles search when state is partial and freshness is require_fresh and refresh fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-svc-partial-req-"));
    temporaryDirectories.push(dir);
    writeFileSync(join(dir, "f1.ts"), "const x = 1;");

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
    (service as any).state = "partial";

    vi.spyOn(service, "refresh").mockRejectedValue(new Error("Refresh failed in partial state"));

    const resp = await service.search({ query: "q", freshness: "require_fresh" });
    expect(resp.results).toEqual([]);
  });

  it("handles search when state is partial and freshness is prefer_fresh and background refresh starts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-svc-partial-pref-"));
    temporaryDirectories.push(dir);
    writeFileSync(join(dir, "f1.ts"), "const x = 1;");

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
    (service as any).state = "partial";

    const refreshSpy = vi.spyOn(service, "refresh").mockResolvedValue({} as any);

    const resp = await service.search({ query: "q", freshness: "prefer_fresh" });
    expect(resp.results).toBeDefined();
    expect(refreshSpy).toHaveBeenCalled();
  });

  it("handles search when state is partial and allowStaleSearch is false", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-svc-partial-nostale-"));
    temporaryDirectories.push(dir);
    writeFileSync(join(dir, "f1.ts"), "const x = 1;");

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
    (service as any).state = "partial";
    (service as any).settings.allowStaleSearch = false;

    const resp = await service.search({ query: "q", freshness: "prefer_fresh" });
    expect(resp.results).toEqual([]);
  });

  it("handles performIncrementalRefresh updating unchanged files entries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-inc-unchanged-"));
    temporaryDirectories.push(dir);
    const file1 = join(dir, "f1.ts");
    const file2 = join(dir, "f2.ts");
    writeFileSync(file1, "const a = 1;");
    writeFileSync(file2, "const b = 2;");

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
    });

    await service.refresh();
    expect((service as any).state).toBe("ready");

    // Force incremental refresh with 1 changed file and 1 unchanged file
    (service as any).settings.sparseRebuildDriftRatio = 1.0;
    (service as any).settings.fullSparseRebuildChangeRatio = 1.0;
    writeFileSync(file1, "const a = 100;");

    const summary = await service.refresh();
    expect(summary.filesChanged).toBe(1);
    expect(summary.filesUnchanged).toBe(1);
  });
});
