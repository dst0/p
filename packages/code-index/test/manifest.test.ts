import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireRepositoryLock,
  CHUNKER_NAME,
  CHUNKER_VERSION,
  INDEX_MANIFEST_SCHEMA_VERSION,
  loadManifest,
  writeManifestAtomic,
} from "../src/rag/manifest.ts";
import type { IndexManifest } from "../src/rag/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("repository index lock", () => {
  it("does not steal an old lock from a live indexing process", () => {
    const directory = createDirectory();
    const lock = acquireRepositoryLock(directory);
    const lockPath = path.join(directory, "refresh.lock");
    fs.utimesSync(lockPath, new Date(0), new Date(0));

    expect(() => acquireRepositoryLock(directory, 0)).toThrow("already running");
    lock.release();
  });

  it("recovers a lock owned by a dead process immediately", () => {
    const directory = createDirectory();
    fs.writeFileSync(
      path.join(directory, "refresh.lock"),
      JSON.stringify({ pid: 2_147_483_647, startedAt: new Date().toISOString() }),
    );

    const lock = acquireRepositoryLock(directory, Number.MAX_SAFE_INTEGER);
    expect(fs.existsSync(path.join(directory, "refresh.lock"))).toBe(true);
    lock.release();
    // Test double release safety
    expect(() => lock.release()).not.toThrow();
  });

  it("handles corrupted lock file gracefully during lock acquisition", () => {
    const directory = createDirectory();
    fs.writeFileSync(path.join(directory, "refresh.lock"), "not valid json {{{");
    const lockPath = path.join(directory, "refresh.lock");
    fs.utimesSync(lockPath, new Date(0), new Date(0));

    const lock = acquireRepositoryLock(directory, 0);
    lock.release();
  });

  it("handles lock file with missing or invalid pid", () => {
    const directory = createDirectory();

    fs.writeFileSync(path.join(directory, "refresh.lock"), JSON.stringify([1, 2, 3]));
    const lockPath = path.join(directory, "refresh.lock");
    fs.utimesSync(lockPath, new Date(0), new Date(0));
    const lock1 = acquireRepositoryLock(directory, 0);
    lock1.release();

    fs.writeFileSync(path.join(directory, "refresh.lock"), JSON.stringify({ pid: "string" }));
    fs.utimesSync(lockPath, new Date(0), new Date(0));
    const lock2 = acquireRepositoryLock(directory, 0);
    lock2.release();

    fs.writeFileSync(path.join(directory, "refresh.lock"), JSON.stringify({ pid: -1 }));
    fs.utimesSync(lockPath, new Date(0), new Date(0));
    const lock3 = acquireRepositoryLock(directory, 0);
    lock3.release();
  });

  it("throws if lock.release fails with non-ENOENT error", () => {
    const directory = createDirectory();
    const lock = acquireRepositoryLock(directory, 0);

    // mock unlinkSync to throw EACCES
    const originalUnlink = fs.unlinkSync;
    fs.unlinkSync = () => {
      const error: any = new Error("EACCES");
      error.code = "EACCES";
      throw error;
    };

    expect(() => lock.release()).toThrow("EACCES");

    // restore and release
    fs.unlinkSync = originalUnlink;
    lock.release();
  });

  it("throws if lock acquisition fails with non-EEXIST error", () => {
    const directory = createDirectory();

    // mock openSync to throw EACCES
    const originalOpen = fs.openSync;
    fs.openSync = () => {
      const error: any = new Error("EACCES");
      error.code = "EACCES";
      throw error;
    };

    try {
      expect(() => acquireRepositoryLock(directory, 0)).toThrow("EACCES");
    } finally {
      fs.openSync = originalOpen;
    }
  });
});

describe("loadManifest and writeManifestAtomic", () => {
  it("returns undefined for missing manifest file", () => {
    expect(loadManifest("/non-existent-manifest-12345.json")).toBeUndefined();
  });

  it("throws on corrupted JSON in manifest file", () => {
    const dir = createDirectory();
    const manifestPath = path.join(dir, "manifest.json");
    fs.writeFileSync(manifestPath, "corrupted { json");

    expect(() => loadManifest(manifestPath)).toThrow("Unable to read code RAG manifest");
  });

  it("throws on non-Error thrown during read", () => {
    const dir = createDirectory();
    const manifestPath = path.join(dir, "manifest.json");
    fs.writeFileSync(manifestPath, "{}");
    const originalRead = fs.readFileSync;
    (fs as any).readFileSync = () => {
      throw "string error";
    };
    try {
      expect(() => loadManifest(manifestPath)).toThrow("Unable to read code RAG manifest: string error");
    } finally {
      (fs as any).readFileSync = originalRead;
    }
  });

  it("throws on malformed or incompatible manifest object", () => {
    const dir = createDirectory();
    const manifestPath = path.join(dir, "manifest.json");

    fs.writeFileSync(manifestPath, JSON.stringify([1, 2, 3]));
    expect(() => loadManifest(manifestPath)).toThrow("incompatible or malformed");

    fs.writeFileSync(manifestPath, JSON.stringify(null));
    expect(() => loadManifest(manifestPath)).toThrow("incompatible or malformed");

    fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 999 }));
    expect(() => loadManifest(manifestPath)).toThrow("incompatible or malformed");
  });

  it("writes and reads a valid IndexManifest atomically", () => {
    const dir = createDirectory();
    const manifestPath = path.join(dir, "manifest.json");

    const manifest: IndexManifest = {
      schemaVersion: INDEX_MANIFEST_SCHEMA_VERSION,
      repoId: "repo-1",
      root: "/abs/repo1",
      collection: "coll-1",
      generation: "gen-1",
      state: "ready",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      files: {},
      chunkCount: 0,
      chunker: { name: CHUNKER_NAME, version: CHUNKER_VERSION, defaultChunkLines: 80, maxChunkLines: 300 },
      embedding: {
        provider: "http",
        model: "Qwen/Qwen3-Embedding-0.6B",
        dimensions: 1024,
        compatibilityGroup: "qwen_qwen3_embedding_0.6b-1024-last-non-padding-token-l2",
        pooling: "last-non-padding-token",
        normalization: "l2",
      },
      sparse: {
        strategy: "frozen-bm25",
        generation: "gen-1",
        vocabularyFile: "bm25_vocab.json",
        corpusDocCount: 1,
        frozenStatsAt: new Date().toISOString(),
        driftFileCount: 0,
      },
    };

    writeManifestAtomic(manifestPath, manifest);
    const loaded = loadManifest(manifestPath);

    expect(loaded).toEqual(manifest);
  });
});

function createDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "p-rag-lock-"));
  temporaryDirectories.push(directory);
  return directory;
}
