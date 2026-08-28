import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EmbeddingServerManager, QdrantCollectionAdmin, QdrantServerManager } from "@dst0/p-code-index";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IndexingDaemon } from "../src/core/indexing-daemon.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("indexing daemon backends", () => {
  it("starts Qdrant without the embedding server in fast BM25 mode", async () => {
    const ensureQdrant = vi.spyOn(QdrantServerManager.prototype, "ensureStarted").mockResolvedValue(true);
    const ensureEmbedding = vi.spyOn(EmbeddingServerManager.prototype, "ensureStarted").mockResolvedValue(true);
    const qdrantGarbageCollector = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
    const agentDir = path.join(os.tmpdir(), "p-indexing-daemon-bm25");
    const daemon = new IndexingDaemon({
      agentDir,
      qdrantBinary: "unused",
      qdrantDataDirectory: path.join(agentDir, "qdrant"),
      pythonExecutable: "unused",
      embeddingModel: "unused",
      useDenseEmbeddings: false,
      qdrantGarbageCollector,
    });

    await daemon._ensureBackendsRaw();

    expect(ensureQdrant).toHaveBeenCalledOnce();
    expect(ensureEmbedding).not.toHaveBeenCalled();
    expect(qdrantGarbageCollector.start).toHaveBeenCalledOnce();
  });

  it("passes the configured recovery budget to the managed Qdrant process", async () => {
    let observedTimeoutMs: number | undefined;
    let observedPort: number | undefined;
    vi.spyOn(QdrantServerManager.prototype, "ensureStarted").mockImplementation(function (this: QdrantServerManager) {
      observedTimeoutMs = (
        this as unknown as {
          options: { startupTimeoutMs: number };
        }
      ).options.startupTimeoutMs;
      observedPort = (this as unknown as { port: number }).port;
      return Promise.resolve(true);
    });
    const qdrantGarbageCollector = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
    const agentDir = path.join(os.tmpdir(), "p-indexing-daemon-qdrant-timeout");
    const daemon = new IndexingDaemon({
      agentDir,
      qdrantBinary: "unused",
      qdrantUrl: "http://127.0.0.1:7444",
      qdrantDataDirectory: path.join(agentDir, "qdrant"),
      qdrantStartupTimeoutMs: 345_000,
      pythonExecutable: "unused",
      embeddingModel: "unused",
      useDenseEmbeddings: false,
      qdrantGarbageCollector,
    });

    await daemon._ensureBackendsRaw();

    expect(observedTimeoutMs).toBe(345_000);
    expect(observedPort).toBe(7444);
  });

  it("checks but never locally manages or garbage-collects a remote Qdrant backend", async () => {
    const ensureQdrant = vi.spyOn(QdrantServerManager.prototype, "ensureStarted").mockResolvedValue(false);
    const listCollections = vi.spyOn(QdrantCollectionAdmin.prototype, "listCollections").mockResolvedValue([]);
    const qdrantGarbageCollector = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
    const agentDir = path.join(os.tmpdir(), "p-indexing-daemon-remote-qdrant");
    const daemon = new IndexingDaemon({
      agentDir,
      qdrantBinary: "unused",
      qdrantUrl: "https://qdrant.example.test:7444",
      qdrantDataDirectory: path.join(agentDir, "qdrant"),
      qdrantApiKey: "remote-secret",
      pythonExecutable: "unused",
      embeddingModel: "unused",
      useDenseEmbeddings: false,
      qdrantGarbageCollector,
    });

    await daemon._ensureBackendsRaw();

    expect(ensureQdrant).not.toHaveBeenCalled();
    expect(listCollections).toHaveBeenCalledOnce();
    expect(qdrantGarbageCollector.start).not.toHaveBeenCalled();
    await daemon.disposeBackends();
  });

  it("rejects repository-local Qdrant endpoints that diverge from the daemon endpoint", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-daemon-endpoint-"));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-workspace-endpoint-"));
    fs.mkdirSync(path.join(workspace, ".p"));
    fs.writeFileSync(
      path.join(workspace, ".p", "code-rag.json"),
      JSON.stringify({ remoteBackendsAllowed: true, qdrantUrl: "https://qdrant.example.test:7444" }),
    );
    const daemon = new IndexingDaemon({
      agentDir,
      qdrantBinary: "unused",
      qdrantUrl: "http://127.0.0.1:6333",
      qdrantDataDirectory: path.join(agentDir, "qdrant"),
      pythonExecutable: "unused",
      embeddingModel: "unused",
      useDenseEmbeddings: false,
    });

    try {
      expect(() => daemon.serviceFactory(workspace)).toThrow("must match the daemon Qdrant endpoint");
    } finally {
      fs.rmSync(agentDir, { force: true, recursive: true });
      fs.rmSync(workspace, { force: true, recursive: true });
    }
  });

  it("does not garbage-collect a pre-existing unauthenticated loopback Qdrant", async () => {
    const ensureQdrant = vi.spyOn(QdrantServerManager.prototype, "ensureStarted").mockResolvedValue(false);
    const ensureEmbedding = vi.spyOn(EmbeddingServerManager.prototype, "ensureStarted").mockResolvedValue(false);
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-daemon-startup-gc-"));
    const qdrantDataDirectory = path.join(agentDir, "code-rag", "qdrant");
    fs.mkdirSync(path.join(qdrantDataDirectory, "storage", "collections", "persisted"), { recursive: true });
    const qdrantGarbageCollector = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
    const trayManager = { start: vi.fn(() => true), stop: vi.fn(), isRunning: vi.fn(() => false) };
    const daemon = new IndexingDaemon({
      agentDir,
      qdrantBinary: "unused",
      qdrantDataDirectory,
      pythonExecutable: "unused",
      embeddingModel: "unused",
      qdrantGarbageCollector,
      trayManager,
      disposeBackends: async () => {},
    });
    vi.spyOn(daemon, "watchRegistry").mockImplementation(() => {});
    vi.spyOn(daemon, "syncRegistry").mockResolvedValue(undefined);
    vi.spyOn(daemon, "writeStatus").mockImplementation(() => {});

    try {
      await daemon.start();
      expect(ensureQdrant).toHaveBeenCalledOnce();
      expect(ensureEmbedding).not.toHaveBeenCalled();
      expect(qdrantGarbageCollector.start).not.toHaveBeenCalled();
    } finally {
      await daemon.stop();
      fs.rmSync(agentDir, { force: true, recursive: true });
    }
  });

  it("garbage-collects a pre-existing authenticated owned loopback Qdrant", async () => {
    vi.spyOn(QdrantServerManager.prototype, "ensureStarted").mockResolvedValue(false);
    const proveOwnership = vi.spyOn(QdrantServerManager.prototype, "isOwnedServerHealthy").mockResolvedValue(true);
    const qdrantGarbageCollector = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
    const agentDir = path.join(os.tmpdir(), "p-indexing-daemon-owned-qdrant");
    const daemon = new IndexingDaemon({
      agentDir,
      qdrantBinary: "unused",
      qdrantDataDirectory: path.join(agentDir, "qdrant"),
      pythonExecutable: "unused",
      embeddingModel: "unused",
      useDenseEmbeddings: false,
      qdrantGarbageCollector,
    });

    await daemon._ensureBackendsRaw();

    expect(proveOwnership).toHaveBeenCalledOnce();
    expect(qdrantGarbageCollector.start).toHaveBeenCalledOnce();
  });

  it("rejects repository-local collection prefixes that diverge from daemon ownership", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-daemon-prefix-"));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-workspace-prefix-"));
    fs.mkdirSync(path.join(workspace, ".p"));
    fs.writeFileSync(path.join(workspace, ".p", "code-rag.json"), JSON.stringify({ collectionPrefix: "other" }));
    const daemon = new IndexingDaemon({
      agentDir,
      qdrantBinary: "unused",
      qdrantDataDirectory: path.join(agentDir, "qdrant"),
      pythonExecutable: "unused",
      embeddingModel: "unused",
      useDenseEmbeddings: false,
    });

    try {
      expect(() => daemon.serviceFactory(workspace)).toThrow("collectionPrefix must match daemon ownership");
    } finally {
      fs.rmSync(agentDir, { force: true, recursive: true });
      fs.rmSync(workspace, { force: true, recursive: true });
    }
  });

  it("accepts repository collection prefixes with the same normalized ownership", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-daemon-normalized-prefix-"));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-workspace-normalized-prefix-"));
    fs.mkdirSync(path.join(workspace, ".p"));
    fs.writeFileSync(path.join(workspace, ".p", "code-rag.json"), JSON.stringify({ collectionPrefix: "owned?prefix" }));
    const daemon = new IndexingDaemon({
      agentDir,
      collectionPrefix: "owned/prefix",
      qdrantBinary: "unused",
      qdrantDataDirectory: path.join(agentDir, "qdrant"),
      pythonExecutable: "unused",
      embeddingModel: "unused",
      useDenseEmbeddings: false,
    });

    try {
      expect(() => daemon.serviceFactory(workspace)).not.toThrow();
    } finally {
      fs.rmSync(agentDir, { force: true, recursive: true });
      fs.rmSync(workspace, { force: true, recursive: true });
    }
  });

  it("stops startup GC deletions when the daemon begins quiescing", async () => {
    vi.spyOn(QdrantServerManager.prototype, "ensureStarted").mockResolvedValue(true);
    vi.spyOn(QdrantServerManager.prototype, "isOwnedServerHealthy").mockResolvedValue(true);
    const createdAt = (Date.now() - 2 * 24 * 60 * 60_000).toString(36);
    const collections = ["0badcafe", "feedbeef"].map(
      (suffix) => `p_code_chunks_${"a".repeat(16)}_${createdAt}-${suffix}`,
    );
    vi.spyOn(QdrantCollectionAdmin.prototype, "listCollections").mockResolvedValue(collections);
    let daemon: IndexingDaemon;
    const deleteCollection = vi
      .spyOn(QdrantCollectionAdmin.prototype, "deleteCollection")
      .mockImplementation(async () => {
        daemon.quiescing = true;
      });
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-daemon-quiescing-gc-"));
    fs.mkdirSync(path.join(agentDir, "code-rag"), { recursive: true });
    daemon = new IndexingDaemon({
      agentDir,
      qdrantBinary: "unused",
      qdrantDataDirectory: path.join(agentDir, "qdrant"),
      pythonExecutable: "unused",
      embeddingModel: "unused",
      useDenseEmbeddings: false,
      disposeBackends: async () => {},
    });
    let finishCollection: (() => void) | undefined;
    const completed = new Promise<void>((resolve) => {
      finishCollection = resolve;
    });
    vi.spyOn(daemon, "log").mockImplementation((_level, message) => {
      if (message.startsWith("Qdrant collection GC deleted")) finishCollection?.();
    });

    try {
      await daemon._ensureBackendsRaw();
      await completed;
      expect(deleteCollection).toHaveBeenCalledOnce();
    } finally {
      await daemon.disposeBackends();
      fs.rmSync(agentDir, { force: true, recursive: true });
    }
  });

  it("does not block backend readiness on startup garbage collection", async () => {
    vi.spyOn(QdrantServerManager.prototype, "ensureStarted").mockResolvedValue(true);
    let finishGarbageCollection: (() => void) | undefined;
    const qdrantGarbageCollector = {
      start: vi.fn(
        async () =>
          new Promise<void>((resolve) => {
            finishGarbageCollection = resolve;
          }),
      ),
      stop: vi.fn(async () => {}),
    };
    const agentDir = path.join(os.tmpdir(), "p-indexing-daemon-nonblocking-gc");
    const daemon = new IndexingDaemon({
      agentDir,
      qdrantBinary: "unused",
      qdrantDataDirectory: path.join(agentDir, "qdrant"),
      pythonExecutable: "unused",
      embeddingModel: "unused",
      useDenseEmbeddings: false,
      qdrantGarbageCollector,
    });

    const startup = daemon._ensureBackendsRaw();
    const outcome = await Promise.race([
      startup.then(() => "ready"),
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 50)),
    ]);
    finishGarbageCollection?.();
    await startup;

    expect(outcome).toBe("ready");
    expect(qdrantGarbageCollector.start).toHaveBeenCalledOnce();
  });
});
