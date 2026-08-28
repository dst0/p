import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectObsoleteQdrantCollections,
  QDRANT_COLLECTION_GC_INTERVAL_MS,
  QdrantCollectionGarbageCollector,
  type QdrantCollectionGcResult,
} from "../src/core/indexing-daemon/qdrant-collection-garbage-collector.ts";

const DAY_MS = 24 * 60 * 60_000;
let temporaryDirectory: string | undefined;

afterEach(() => {
  vi.useRealTimers();
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  temporaryDirectory = undefined;
});

function writeCollectionReference(directory: string, filename: string, collection: string): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, filename), `${JSON.stringify({ collection })}\n`);
}

describe("Qdrant collection garbage collection", () => {
  it("deletes only old unreferenced collections without migrating retained schemas", async () => {
    const now = Date.UTC(2026, 7, 28, 0, 0, 0);
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-qdrant-collection-gc-"));
    const prefix = "p_code_chunks";
    const repositoryId = "a".repeat(16);
    const collection = (createdAt: number, suffix: string) =>
      `${prefix}_${repositoryId}_${createdAt.toString(36)}-${suffix}`;
    const active = collection(now - 3 * DAY_MS, "a11ce001");
    const resumable = collection(now - 3 * DAY_MS, "e5011e01");
    const oldOrphan = collection(now - 2 * DAY_MS, "0badcafe");
    const youngOrphan = collection(now - 60_000, "70a11001");
    const foreign = `other_${repositoryId}_${(now - 3 * DAY_MS).toString(36)}-foreign1`;
    writeCollectionReference(path.join(temporaryDirectory, "repo-active"), "manifest.json", active);
    writeCollectionReference(path.join(temporaryDirectory, "repo-rebuild"), "rebuild-checkpoint.json", resumable);
    const deleted: string[] = [];

    const result = await collectObsoleteQdrantCollections({
      dataDirectory: temporaryDirectory,
      collectionPrefix: prefix,
      now: () => now,
      collectionAdmin: {
        listCollections: async () => [active, resumable, oldOrphan, youngOrphan, foreign],
        deleteCollection: async (name) => {
          deleted.push(name);
        },
      },
    });

    expect(deleted).toEqual([oldOrphan]);
    expect(result).toEqual({ deleted: 1, failed: 0, retained: 4 });
  });

  it("fails closed when persisted collection references cannot be trusted", async () => {
    const now = Date.UTC(2026, 7, 28, 0, 0, 0);
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-qdrant-collection-gc-corrupt-"));
    const repositoryDirectory = path.join(temporaryDirectory, "repo-corrupt");
    fs.mkdirSync(repositoryDirectory, { recursive: true });
    fs.writeFileSync(path.join(repositoryDirectory, "manifest.json"), "{not-json\n");
    const orphan = `p_code_chunks_${"a".repeat(16)}_${(now - 2 * DAY_MS).toString(36)}-0badcafe`;
    const deleteCollection = vi.fn(async () => {});

    await expect(
      collectObsoleteQdrantCollections({
        dataDirectory: temporaryDirectory,
        collectionPrefix: "p_code_chunks",
        now: () => now,
        collectionAdmin: {
          listCollections: async () => [orphan],
          deleteCollection,
        },
      }),
    ).rejects.toThrow("Cannot safely read Qdrant collection reference");
    expect(deleteCollection).not.toHaveBeenCalled();
  });

  it("retains old orphan candidates while a repository refresh is active", async () => {
    const now = Date.UTC(2026, 7, 28, 0, 0, 0);
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-qdrant-collection-gc-active-"));
    const orphan = `p_code_chunks_${"a".repeat(16)}_${(now - 2 * DAY_MS).toString(36)}-0badcafe`;
    const deleteCollection = vi.fn(async () => {});

    const result = await collectObsoleteQdrantCollections({
      dataDirectory: temporaryDirectory,
      collectionPrefix: "p_code_chunks",
      canDeleteCollections: () => false,
      now: () => now,
      collectionAdmin: {
        listCollections: async () => [orphan],
        deleteCollection,
      },
    });

    expect(deleteCollection).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: 0, failed: 0, retained: 1 });
  });

  it("stops deleting between candidates when the daemon begins shutdown", async () => {
    const now = Date.UTC(2026, 7, 28, 0, 0, 0);
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-qdrant-collection-gc-stop-"));
    const collection = (suffix: string) =>
      `p_code_chunks_${"a".repeat(16)}_${(now - 2 * DAY_MS).toString(36)}-${suffix}`;
    const first = collection("0badcafe");
    const second = collection("feedbeef");
    let canDelete = true;
    const deleteCollection = vi.fn(async () => {
      canDelete = false;
    });

    const result = await collectObsoleteQdrantCollections({
      dataDirectory: temporaryDirectory,
      collectionPrefix: "p_code_chunks",
      canDeleteCollections: () => canDelete,
      now: () => now,
      collectionAdmin: { listCollections: async () => [first, second], deleteCollection },
    });

    expect(deleteCollection).toHaveBeenCalledOnce();
    expect(deleteCollection).toHaveBeenCalledWith(first);
    expect(result).toEqual({ deleted: 1, failed: 0, retained: 1 });
  });

  it("blocks deletion when a refresh starts during the collection inventory", async () => {
    const now = Date.UTC(2026, 7, 28, 0, 0, 0);
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-qdrant-collection-gc-race-"));
    const repositoryDirectory = path.join(temporaryDirectory, "a".repeat(64));
    fs.mkdirSync(repositoryDirectory, { recursive: true });
    const orphan = `p_code_chunks_${"a".repeat(16)}_${(now - 2 * DAY_MS).toString(36)}-0badcafe`;
    const deleteCollection = vi.fn(async () => {});

    const result = await collectObsoleteQdrantCollections({
      dataDirectory: temporaryDirectory,
      collectionPrefix: "p_code_chunks",
      now: () => now,
      collectionAdmin: {
        listCollections: async () => {
          fs.writeFileSync(
            path.join(repositoryDirectory, "refresh.lock"),
            JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
          );
          return [orphan];
        },
        deleteCollection,
      },
    });

    expect(deleteCollection).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: 0, failed: 0, retained: 1 });
  });

  it("protects both manifests when a refresh commits during the collection inventory", async () => {
    const now = Date.UTC(2026, 7, 28, 0, 0, 0);
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-qdrant-collection-gc-commit-"));
    const repositoryDirectory = path.join(temporaryDirectory, "a".repeat(64));
    const oldCollection = `p_code_chunks_${"a".repeat(16)}_${(now - 3 * DAY_MS).toString(36)}-0badcafe`;
    const newCollection = `p_code_chunks_${"a".repeat(16)}_${(now - 2 * DAY_MS).toString(36)}-feedbeef`;
    writeCollectionReference(repositoryDirectory, "manifest.json", oldCollection);
    const deleteCollection = vi.fn(async () => {});

    const result = await collectObsoleteQdrantCollections({
      dataDirectory: temporaryDirectory,
      collectionPrefix: "p_code_chunks",
      now: () => now,
      collectionAdmin: {
        listCollections: async () => {
          writeCollectionReference(repositoryDirectory, "manifest.json", newCollection);
          return [oldCollection, newCollection];
        },
        deleteCollection,
      },
    });

    expect(deleteCollection).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: 0, failed: 0, retained: 2 });
  });

  it("retains managed-looking collections that do not use the exact generation grammar", async () => {
    const now = Date.UTC(2026, 7, 28, 0, 0, 0);
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-qdrant-collection-gc-grammar-"));
    const lookalike = `p_code_chunks_${"a".repeat(16)}_${(now - 2 * DAY_MS).toString(36)}-nothex00`;
    const deleteCollection = vi.fn(async () => {});

    const result = await collectObsoleteQdrantCollections({
      dataDirectory: temporaryDirectory,
      collectionPrefix: "p_code_chunks",
      now: () => now,
      collectionAdmin: {
        listCollections: async () => [lookalike],
        deleteCollection,
      },
    });

    expect(deleteCollection).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: 0, failed: 0, retained: 1 });
  });

  it("runs immediately, repeats every 24 hours, and stops cleanly", async () => {
    vi.useFakeTimers();
    const collect = vi.fn().mockResolvedValue({ deleted: 0, failed: 0, retained: 0 });
    const garbageCollector = new QdrantCollectionGarbageCollector(collect);

    await garbageCollector.start();
    expect(collect).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(QDRANT_COLLECTION_GC_INTERVAL_MS - 1);
    expect(collect).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(collect).toHaveBeenCalledTimes(2);

    await garbageCollector.stop();
    await vi.advanceTimersByTimeAsync(QDRANT_COLLECTION_GC_INTERVAL_MS);
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it("revalidates ownership before every daily collection pass", async () => {
    vi.useFakeTimers();
    const collect = vi.fn().mockResolvedValue({ deleted: 0, failed: 0, retained: 0 });
    const isOwnedStorage = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const garbageCollector = new QdrantCollectionGarbageCollector(collect, undefined, isOwnedStorage);

    await garbageCollector.start();
    expect(collect).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(QDRANT_COLLECTION_GC_INTERVAL_MS);
    expect(isOwnedStorage).toHaveBeenCalledTimes(2);
    expect(collect).toHaveBeenCalledOnce();
    await garbageCollector.stop();
  });

  it("waits for an in-flight run before stopping and never reschedules it", async () => {
    vi.useFakeTimers();
    let finishCollection: (() => void) | undefined;
    const collect = vi.fn(
      () =>
        new Promise<QdrantCollectionGcResult>((resolve) => {
          finishCollection = () => resolve({ deleted: 0, failed: 0, retained: 0 });
        }),
    );
    const garbageCollector = new QdrantCollectionGarbageCollector(collect);

    const running = garbageCollector.start();
    let stopped = false;
    const stopping = garbageCollector.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    finishCollection?.();
    await Promise.all([running, stopping]);
    await vi.advanceTimersByTimeAsync(QDRANT_COLLECTION_GC_INTERVAL_MS);
    expect(stopped).toBe(true);
    expect(collect).toHaveBeenCalledOnce();
  });

  it("does not collect after stop while ownership proof is pending", async () => {
    let finishOwnership: (() => void) | undefined;
    const isOwnedStorage = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishOwnership = () => resolve(true);
        }),
    );
    const collect = vi.fn().mockResolvedValue({ deleted: 0, failed: 0, retained: 0 });
    const garbageCollector = new QdrantCollectionGarbageCollector(collect, undefined, isOwnedStorage);

    const running = garbageCollector.start();
    const stopping = garbageCollector.stop();
    finishOwnership?.();
    await Promise.all([running, stopping]);

    expect(isOwnedStorage).toHaveBeenCalledOnce();
    expect(collect).not.toHaveBeenCalled();
  });
});
