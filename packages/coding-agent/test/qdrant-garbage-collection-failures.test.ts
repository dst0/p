import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { QdrantServerManager } from "@dst0/p-code-index";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectObsoleteQdrantCollections,
  QDRANT_COLLECTION_GC_INTERVAL_MS,
  QdrantCollectionGarbageCollector,
} from "../src/core/indexing-daemon/qdrant-collection-garbage-collector.ts";
import { createQdrantDaemonRuntime } from "../src/core/indexing-daemon/qdrant-daemon-runtime.ts";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(name: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), name));
  temporaryDirectories.push(directory);
  return directory;
}

function collectionName(createdAt: number, suffix: string): string {
  return `p_code_chunks_${"a".repeat(16)}_${createdAt.toString(36)}-${suffix}`;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("Qdrant garbage collection failure contracts", () => {
  it("accounts for a failed deletion and continues through later eligible candidates", async () => {
    const now = Date.UTC(2026, 7, 28, 0, 0, 0);
    const dataDirectory = createTemporaryDirectory("p-qdrant-gc-delete-failure-");
    const failed = collectionName(now - 2 * QDRANT_COLLECTION_GC_INTERVAL_MS, "0badcafe");
    const boundary = collectionName(now - QDRANT_COLLECTION_GC_INTERVAL_MS, "feedbeef");
    const young = collectionName(now - QDRANT_COLLECTION_GC_INTERVAL_MS + 1, "a11ce001");
    const malformed = collectionName(now - 2 * QDRANT_COLLECTION_GC_INTERVAL_MS, "nothex00");
    const deleteCollection = vi.fn(async (collection: string) => {
      if (collection === failed) throw new Error("delete rejected");
    });

    const result = await collectObsoleteQdrantCollections({
      dataDirectory,
      collectionPrefix: "p_code_chunks",
      now: () => now,
      collectionAdmin: {
        listCollections: async () => [failed, young, malformed, boundary],
        deleteCollection,
      },
    });

    expect(deleteCollection.mock.calls.map(([collection]) => collection)).toEqual([failed, boundary]);
    expect(result).toEqual({ deleted: 1, failed: 1, retained: 3 });
  });

  it("fails closed before inventory when the repository metadata directory is missing", async () => {
    const parentDirectory = createTemporaryDirectory("p-qdrant-gc-missing-metadata-");
    const listCollections = vi.fn(async () => [collectionName(0, "0badcafe")]);

    await expect(
      collectObsoleteQdrantCollections({
        dataDirectory: path.join(parentDirectory, "missing"),
        collectionPrefix: "p_code_chunks",
        collectionAdmin: { listCollections, deleteCollection: async () => {} },
      }),
    ).rejects.toMatchObject({
      message: "Cannot safely enumerate persisted Qdrant collection references",
      cause: { code: "ENOENT" },
    });
    expect(listCollections).not.toHaveBeenCalled();
  });

  it("fails closed when an existing collection reference cannot be read", async () => {
    const dataDirectory = createTemporaryDirectory("p-qdrant-gc-unreadable-reference-");
    const repositoryDirectory = path.join(dataDirectory, "repository");
    const manifestPath = path.join(repositoryDirectory, "manifest.json");
    fs.mkdirSync(repositoryDirectory);
    fs.writeFileSync(manifestPath, JSON.stringify({ collection: collectionName(0, "0badcafe") }));
    const readFailure = Object.assign(new Error("permission denied"), { code: "EACCES" });
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw readFailure;
    });
    const listCollections = vi.fn(async () => []);

    await expect(
      collectObsoleteQdrantCollections({
        dataDirectory,
        collectionPrefix: "p_code_chunks",
        collectionAdmin: { listCollections, deleteCollection: async () => {} },
      }),
    ).rejects.toMatchObject({
      message: "Cannot safely read Qdrant collection reference",
      cause: readFailure,
    });
    expect(listCollections).not.toHaveBeenCalled();
  });

  it("rejects a parsed collection reference that is not an object", async () => {
    const dataDirectory = createTemporaryDirectory("p-qdrant-gc-invalid-reference-");
    const repositoryDirectory = path.join(dataDirectory, "repository");
    fs.mkdirSync(repositoryDirectory);
    fs.writeFileSync(path.join(repositoryDirectory, "manifest.json"), "[]\n");
    const listCollections = vi.fn(async () => []);

    await expect(
      collectObsoleteQdrantCollections({
        dataDirectory,
        collectionPrefix: "p_code_chunks",
        collectionAdmin: { listCollections, deleteCollection: async () => {} },
      }),
    ).rejects.toMatchObject({
      message: "Cannot safely read Qdrant collection reference",
      cause: { message: "Collection reference is not an object" },
    });
    expect(listCollections).not.toHaveBeenCalled();
  });

  it("logs failed passes, normalizes unknown errors, and recovers on the next daily run", async () => {
    vi.useFakeTimers();
    const collect = vi
      .fn()
      .mockRejectedValueOnce(new Error("inventory unavailable"))
      .mockRejectedValueOnce("untyped failure")
      .mockResolvedValueOnce({ deleted: 0, failed: 0, retained: 0 });
    const onLog = vi.fn();
    const garbageCollector = new QdrantCollectionGarbageCollector(collect, onLog);

    await garbageCollector.start();
    expect(onLog).toHaveBeenCalledWith("error", "Qdrant collection GC failed: inventory unavailable");

    await vi.advanceTimersByTimeAsync(QDRANT_COLLECTION_GC_INTERVAL_MS);
    expect(onLog).toHaveBeenCalledWith("error", "Qdrant collection GC failed: untyped failure");

    await vi.advanceTimersByTimeAsync(QDRANT_COLLECTION_GC_INTERVAL_MS);
    expect(collect).toHaveBeenCalledTimes(3);
    expect(onLog).toHaveBeenCalledWith("debug", "Qdrant collection GC deleted 0, retained 0, failed 0");
    await garbageCollector.stop();
  });

  it("logs typed and untyped collector startup rejections without blocking Qdrant readiness", async () => {
    vi.spyOn(QdrantServerManager.prototype, "ensureStarted").mockResolvedValue(true);
    const startGarbageCollection = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("collector startup failed"))
      .mockRejectedValueOnce("untyped startup failure");
    const garbageCollector = {
      start: startGarbageCollection,
      stop: vi.fn(async () => {}),
    };
    const onLog = vi.fn();
    const agentDirectory = createTemporaryDirectory("p-qdrant-gc-startup-failure-");
    const runtime = createQdrantDaemonRuntime({
      daemonOptions: {
        agentDir: agentDirectory,
        qdrantBinary: "unused",
        qdrantDataDirectory: path.join(agentDirectory, "qdrant"),
        pythonExecutable: "unused",
        embeddingModel: "unused",
        qdrantGarbageCollector: garbageCollector,
      },
      canDeleteCollections: () => true,
      onLog,
    });

    await expect(runtime.startMaintenance()).resolves.toBeUndefined();
    await vi.waitFor(() => {
      expect(onLog).toHaveBeenCalledWith("error", "Qdrant collection GC failed to start: collector startup failed");
    });
    await expect(runtime.startMaintenance()).resolves.toBeUndefined();
    await vi.waitFor(() => {
      expect(onLog).toHaveBeenCalledWith("error", "Qdrant collection GC failed to start: untyped startup failure");
    });
    expect(startGarbageCollection).toHaveBeenCalledTimes(2);
  });
});
