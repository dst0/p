import { EventEmitter } from "node:events";
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chunkFile } from "../src/chunk.ts";
import { discoverFilesWithOptions } from "../src/discover.ts";
import { EmbeddingProviderHttp } from "../src/embed/http.ts";
import { QdrantServerManager } from "../src/embed/qdrant-server.ts";
import { EmbeddingServerManager } from "../src/embed/server.ts";
import { CodeIndexer } from "../src/indexer.ts";
import { QdrantClient } from "../src/qdrant.ts";
import { loadWorkspaceCodeRagSettings } from "../src/rag/config.ts";
import { loadManifest } from "../src/rag/manifest.ts";
import { WorkspaceCodeRagService } from "../src/rag/service.ts";
import type { StoredChunkPayload } from "../src/rag/types.ts";
import type { IndexConfig } from "../src/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("chunkFile symbol extraction across languages", () => {
  it("extracts symbols for all supported languages", () => {
    expect(chunkFile("pub fn my_fn() {}", "rust")[0]?.symbol).toBe("fn my_fn");
    expect(chunkFile("pub struct MyStruct {}", "rust")[0]?.symbol).toBe("struct MyStruct");
    expect(chunkFile("pub enum MyEnum {}", "enum")[0]?.symbol).toBeDefined();
    expect(chunkFile("impl MyStruct {}", "rust")[0]?.symbol).toBe("impl MyStruct");
    expect(chunkFile("pub trait MyTrait {}", "rust")[0]?.symbol).toBe("trait MyTrait");

    expect(chunkFile("def py_fn(): pass", "python")[0]?.symbol).toBe("def py_fn");
    expect(chunkFile("async def async_py_fn(): pass", "python")[0]?.symbol).toBe("async def async_py_fn");
    expect(chunkFile("class PyClass: pass", "python")[0]?.symbol).toBe("class PyClass");

    expect(chunkFile("function jsFn() {}", "javascript")[0]?.symbol).toBe("function jsFn");
    expect(chunkFile("class JsClass {}", "javascript")[0]?.symbol).toBe("class JsClass");
    expect(chunkFile("const jsConst = 1;", "javascript")[0]?.symbol).toBe("const jsConst");
    expect(chunkFile("let jsLet = 2;", "javascript")[0]?.symbol).toBe("let jsLet");
    expect(chunkFile("var jsVar = 3;", "javascript")[0]?.symbol).toBe("var jsVar");
    expect(chunkFile("interface TsInterface {}", "typescript")[0]?.symbol).toBe("interface TsInterface");
    expect(chunkFile("type TsType = string;", "typescript")[0]?.symbol).toBe("type TsType");

    expect(chunkFile("func HandleRequest(w http.ResponseWriter) {}", "go")[0]?.symbol).toBe(
      "func HandleRequest(w http.ResponseWriter)",
    );

    expect(chunkFile("void handle_c_fn() {}", "c")[0]?.symbol).toBe("void handle_c_fn");
    expect(chunkFile("int calculate_sum(int a) {}", "cpp")[0]?.symbol).toBe("int calculate_sum");

    expect(chunkFile("def ruby_method\nend", "ruby")[0]?.symbol).toBe("def ruby_method");
    expect(chunkFile("class RubyClass\nend", "ruby")[0]?.symbol).toBe("class RubyClass");

    expect(chunkFile("func swiftFunc() {}", "swift")[0]?.symbol).toBe("func swiftFunc");
    expect(chunkFile("class SwiftClass {}", "swift")[0]?.symbol).toBe("class SwiftClass");
    expect(chunkFile("struct SwiftStruct {}", "swift")[0]?.symbol).toBe("struct SwiftStruct");
    expect(chunkFile("enum SwiftEnum {}", "swift")[0]?.symbol).toBe("enum SwiftEnum");
    expect(chunkFile("protocol SwiftProtocol {}", "swift")[0]?.symbol).toBe("protocol SwiftProtocol");
  });

  it("handles whitespace-only sections in chunkBySymbols and chunkFixedSize", () => {
    const content = "function f1() {}\n\n   \n\nfunction f2() {}";
    const chunks = chunkFile(content, "typescript");
    expect(chunks.length).toBe(2);

    const fixedChunks = chunkFile("\n\n   \n\n", "unknown_lang", 10);
    expect(fixedChunks).toEqual([]);
  });
});

describe("discoverFilesWithOptions filter exception branch", () => {
  it("handles filesystem error during file filtering in discoverFilesWithOptions", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-disc-err-"));
    temporaryDirectories.push(dir);
    const file1 = join(dir, "f1.ts");
    writeFileSync(file1, "const a = 1;");

    const lstatSpy = vi.spyOn(fs, "lstatSync").mockImplementation((p: any) => {
      if (String(p).endsWith("f1.ts")) throw new Error("Permission error");
      return fs.lstatSync(p);
    });

    const files = discoverFilesWithOptions(dir, { maxFileSize: 1000 });
    expect(files).not.toContain(file1);
    lstatSpy.mockRestore();
  });
});

describe("indexer indexRepo 2000 chunk progress log and points upload", () => {
  it("indexes a repo with >2000 chunks and uploads points batch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-indexer-2000-"));
    temporaryDirectories.push(dir);
    mkdirSync(join(dir, ".git"));

    // Create 10 files with 250 functions each = 2500 chunks total
    for (let f = 0; f < 10; f++) {
      const codeLines: string[] = [];
      for (let fn = 0; fn < 250; fn++) {
        codeLines.push(`export function fn_${f}_${fn}() { return ${fn}; }`);
      }
      writeFileSync(join(dir, `file_${f}.ts`), codeLines.join("\n"));
    }

    const config: IndexConfig = {
      qdrantUrl: "http://localhost:6333",
      collection: "test_coll",
      modelId: "test-model",
      denseDim: 4,
      workspace: dir,
      bm25K1: 1.5,
      bm25B: 0.75,
      defaultChunkLines: 80,
      maxChunkLines: 300,
      maxFileSize: 10_000_000,
      batchSize: 128,
      encodeBatchSize: 64,
      maxEncodeChars: 1000,
      vocabPath: join(dir, "vocab.json"),
      embeddingServerUrl: "http://localhost:18742",
    };

    const indexer = new CodeIndexer(config);
    vi.spyOn(indexer.encoder, "encode").mockImplementation(async (texts) => {
      return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
    });
    vi.spyOn(indexer.qdrant, "upsertBatch").mockResolvedValue(undefined);

    const stats = await indexer.indexRepo(dir);
    expect(stats.chunks).toBeGreaterThanOrEqual(2500);
  });
});

describe("qdrant client vector dim fallback and searchDense Float32Array", () => {
  it("returns ? when vectorsConfig dense size is missing", async () => {
    const qdrant = new QdrantClient({
      qdrantUrl: "http://localhost:6333",
      collection: "coll",
      modelId: "m",
      denseDim: 4,
      workspace: "/tmp",
      bm25K1: 1.5,
      bm25B: 0.75,
      defaultChunkLines: 80,
      maxChunkLines: 300,
      maxFileSize: 1000,
      batchSize: 10,
      encodeBatchSize: 10,
      maxEncodeChars: 1000,
      vocabPath: "/tmp/vocab.json",
      embeddingServerUrl: "http://localhost:18742",
    });

    const raw = (qdrant as any).client;
    vi.spyOn(raw, "getCollection").mockResolvedValue({
      config: { params: { vectors: { dense: {} } } },
    });

    const status = await qdrant.getStatus();
    expect(status.vectorDim).toBe("?");
  });

  it("handles searchDense with Float32Array input", async () => {
    const qdrant = new QdrantClient({
      qdrantUrl: "http://localhost:6333",
      collection: "coll",
      modelId: "m",
      denseDim: 4,
      workspace: "/tmp",
      bm25K1: 1.5,
      bm25B: 0.75,
      defaultChunkLines: 80,
      maxChunkLines: 300,
      maxFileSize: 1000,
      batchSize: 10,
      encodeBatchSize: 10,
      maxEncodeChars: 1000,
      vocabPath: "/tmp/vocab.json",
      embeddingServerUrl: "http://localhost:18742",
    });

    const raw = (qdrant as any).client;
    vi.spyOn(raw, "search").mockResolvedValue([{ id: "1", score: 0.9, payload: { repo: "r", path: "p" } }]);

    const res = await qdrant.searchDense(new Float32Array([0.1, 0.2, 0.3, 0.4]), 5);
    expect(res).toHaveLength(1);
  });
});

describe("server managers alreadyRunning log branch and force kill", () => {
  it("logs already running when checkHealth returns true on second check inside start", async () => {
    const logs: Array<{ level: string; message: string }> = [];
    const manager = new EmbeddingServerManager(28743, "model", {
      onLog: (level, message) => logs.push({ level, message }),
    });

    vi.spyOn(manager as any, "checkHealth").mockResolvedValue(true);

    const started = await (manager as any).start();
    expect(started).toBe(false);
    expect(logs.some((l) => l.message.includes("already running"))).toBe(true);
  });

  it("executes force kill on SIGKILL during EmbeddingServerManager stop when process does not exit", async () => {
    vi.useFakeTimers();
    try {
      const mockChild = new EventEmitter() as any;
      mockChild.exitCode = null;
      mockChild.signalCode = null;
      mockChild.kill = vi.fn();

      const manager = new EmbeddingServerManager(28744);
      (manager as any).child = mockChild;

      const stopPromise = manager.stop();
      await vi.advanceTimersByTimeAsync(6000);
      expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");

      mockChild.emit("exit", 137, "SIGKILL");
      await stopPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it("executes force kill on SIGKILL during QdrantServerManager stop when process does not exit", async () => {
    vi.useFakeTimers();
    try {
      const mockChild = new EventEmitter() as any;
      mockChild.exitCode = null;
      mockChild.signalCode = null;
      mockChild.kill = vi.fn();

      const manager = new QdrantServerManager(64334);
      (manager as any).child = mockChild;

      const stopPromise = manager.stop();
      await vi.advanceTimersByTimeAsync(6000);
      expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");

      mockChild.emit("exit", 137, "SIGKILL");
      await stopPromise;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("EmbeddingProviderHttp final retry error throwing", () => {
  it("throws server_error on final retry attempt for HTTP 500", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:28745", 1024, false, "Qwen/Qwen3-Embedding-0.6B", {
      maxRetries: 0,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Server error details", { status: 500 }));

    await expect(provider.encode(["text"])).rejects.toThrow("Embedding server error 500");
  });

  it("throws server_down on final retry attempt for TimeoutError", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:28745", 1024, false, "Qwen/Qwen3-Embedding-0.6B", {
      maxRetries: 0,
    });

    const err = new Error("Timeout");
    err.name = "TimeoutError";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(err);

    await expect(provider.encode(["text"])).rejects.toThrow("Embedding server request timed out");
  });
});

describe("rag config, manifest, and service missing branches", () => {
  it("handles parseConfigFile invalid JSON syntax and file settings", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-env-cfg-"));
    temporaryDirectories.push(dir);
    const badJsonFile = join(dir, "bad.json");
    writeFileSync(badJsonFile, "{ invalid json");

    expect(() =>
      loadWorkspaceCodeRagSettings({
        workspaceRoot: dir,
        dataDirectory: join(dir, "data"),
        userConfigPath: badJsonFile,
        manageLocalBackends: false,
      }),
    ).toThrow("Invalid code RAG config");

    const validConfig = join(dir, "code-rag.json");
    writeFileSync(validConfig, JSON.stringify({ qdrantDataDirectory: join(dir, "qdata") }));
    const settings = loadWorkspaceCodeRagSettings({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      userConfigPath: validConfig,
      manageLocalBackends: false,
    });
    expect(settings.qdrantDataDirectory).toBe(join(dir, "qdata"));
  });

  it("handles manifest load errors and isManifest validation", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-manif-err-"));
    temporaryDirectories.push(dir);

    const badManifest = join(dir, "manifest.json");
    writeFileSync(badManifest, "invalid json");
    expect(() => loadManifest(badManifest)).toThrow("Unable to read code RAG manifest");

    const nonManifest = join(dir, "non-manifest.json");
    writeFileSync(nonManifest, JSON.stringify({ schemaVersion: 999 }));
    expect(() => loadManifest(nonManifest)).toThrow("Code RAG manifest is incompatible or malformed");
  });

  it("handles prepareFile chunk limit security block", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-chunks-sec-"));
    temporaryDirectories.push(dir);

    // Create file producing > 2000 chunks
    const lines: string[] = [];
    for (let i = 0; i < 2005; i++) {
      lines.push(`export function f_${i}() {}`);
    }
    writeFileSync(join(dir, "huge.ts"), lines.join("\n"));

    const service = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      manageLocalBackends: false,
      settings: {
        preparationWorkerMemoryBytes: 1 * 1024 * 1024,
        preparationMemoryReserveBytes: 1 * 1024 * 1024,
      },
    });

    await expect(service.refresh()).rejects.toThrow("File produced too many chunks");
  });

  it("handles performIncrementalRefresh vector dimension mismatch and unchanged file updates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-inc-dim-"));
    temporaryDirectories.push(dir);
    writeFileSync(join(dir, "f1.ts"), "const a = 1;");

    const mockStore: any = {
      collectionExists: async () => true,
      createCollection: async () => {},
      collectionStatus: async () => ({ points: 1, dimensions: 512 }), // mismatch vs 1024
      createPayloadIndexes: async () => {},
      upsert: async () => {},
      deleteFileVersions: async () => {},
    };

    const service = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      vectorStore: mockStore,
      embeddingProvider: {
        dim: 1024,
        encode: async () => [new Float32Array(1024)],
        encodeQuery: async () => new Float32Array(1024),
      },
      manageLocalBackends: false,
      settings: {
        preparationWorkerMemoryBytes: 1 * 1024 * 1024,
        preparationMemoryReserveBytes: 1 * 1024 * 1024,
      },
    });

    await service.refresh();
    expect((service as any).state).toBe("ready");

    // Force incremental refresh rather than sparse rebuild
    (service as any).settings.sparseRebuildDriftRatio = 1.0;
    (service as any).settings.fullSparseRebuildChangeRatio = 1.0;

    // Modify file so there is a change to index
    writeFileSync(join(dir, "f1.ts"), "const a = 2;");

    // Next refresh encounters dimension 512 mismatch in performIncrementalRefresh
    await expect(service.refresh()).rejects.toThrow("Stored vector dimensions are incompatible");
  });

  it("handles formatHits maxContextCharacters truncation", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-fmt-hits-"));
    temporaryDirectories.push(dir);

    const svc = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      manageLocalBackends: false,
    });
    // Override maxContextCharacters to a tiny value so the 2nd hit is truncated
    (svc as any).settings.maxContextCharacters = 100;

    const payload1 = {
      fileId: "f1",
      path: "src/f1.ts",
      startLine: 1,
      endLine: 10,
      fileHash: "h1",
      chunkHash: "c1",
      chunkOrdinal: 0,
      chunkerVersion: "2",
      indexGeneration: "gen1",
      isTest: false,
      isGenerated: false,
      content: "a".repeat(80),
      indexedAt: "2026-01-01",
    };

    const payload2 = {
      ...payload1,
      fileId: "f2",
      path: "src/f2.ts",
      chunkHash: "c2",
      content: "b".repeat(80),
    } as unknown as StoredChunkPayload;

    const res = (svc as any).formatHits(
      [
        { score: 0.9, payload: payload1 },
        { score: 0.8, payload: payload2 },
      ],
      { query: "q", limit: 10, freshness: "prefer_fresh" },
    );

    expect(res.truncated).toBe(true);
    expect(res.hits).toHaveLength(1);
  });

  it("handles manifestIncompatibility chunker settings mismatch and loadVocabulary missing file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-chunker-mismatch-"));
    temporaryDirectories.push(dir);
    writeFileSync(join(dir, "f1.ts"), "const a = 1;");

    const mockStore: any = {
      collectionExists: async () => true,
      createCollection: async () => {},
      collectionStatus: async () => ({ points: 1, dimensions: 1024 }),
      createPayloadIndexes: async () => {},
      upsert: async () => {},
      deleteFileVersions: async () => {},
    };

    const service = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      vectorStore: mockStore,
      embeddingProvider: {
        dim: 1024,
        encode: async () => [new Float32Array(1024)],
        encodeQuery: async () => new Float32Array(1024),
      },
      manageLocalBackends: false,
      settings: {
        preparationWorkerMemoryBytes: 1 * 1024 * 1024,
        preparationMemoryReserveBytes: 1 * 1024 * 1024,
      },
    });

    await service.refresh();
    expect((service as any).state).toBe("ready");

    // Change chunker settings
    (service as any).settings.defaultChunkLines = 100;
    (service as any).reloadPersistedState();
    expect((service as any).state).toBe("stale");
    expect((service as any).staleReason).toBe("Chunker settings changed");
  });
});
