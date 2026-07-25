import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeIndexer } from "../src/indexer.ts";
import type { ChunkPayload, SearchResult } from "../src/types.ts";

const temporaryDirectories: string[] = [];

function createTempDir(prefix = "p-indexer-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("CodeIndexer", () => {
  let workspaceDir: string;
  let repoDir: string;
  let vocabPath: string;

  beforeEach(() => {
    workspaceDir = createTempDir("p-indexer-ws-");
    repoDir = path.join(workspaceDir, "my-repo");
    fs.mkdirSync(repoDir, { recursive: true });
    vocabPath = path.join(workspaceDir, "vocab.json");
  });

  it("constructs with default and partial config", () => {
    const indexerDefault = new CodeIndexer();
    expect(indexerDefault.vocab).toBeDefined();

    const indexerCustom = new CodeIndexer({ workspace: workspaceDir, denseDim: 512 });
    expect(indexerCustom.qdrant).toBeDefined();
  });

  it("executes load without error", async () => {
    const indexer = new CodeIndexer({ workspace: workspaceDir });
    await expect(indexer.load()).resolves.toBeUndefined();
  });

  it("handles loadVocab when file exists vs missing", async () => {
    const indexer = new CodeIndexer({ workspace: workspaceDir, vocabPath });
    const loadedMissing = await indexer.loadVocab();
    expect(loadedMissing).toBe(false);

    indexer.vocab.register("export function hello() {}");
    indexer.vocab.save(vocabPath);

    const loadedExisting = await indexer.loadVocab();
    expect(loadedExisting).toBe(true);
    expect(indexer.vocab.tokenToIdx.has("hello")).toBe(true);
  });

  it("indexes repository with Pass 1, 2, 3 and handles skipped/error files", async () => {
    // Create git info files
    const gitDir = path.join(repoDir, ".git");
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");

    // Valid code file
    fs.writeFileSync(path.join(repoDir, "main.ts"), 'export function main() {\n  console.log("hello world");\n}\n');

    // Empty file (skipped)
    fs.writeFileSync(path.join(repoDir, "empty.ts"), "");

    const indexer = new CodeIndexer({
      workspace: workspaceDir,
      vocabPath,
      batchSize: 1,
      encodeBatchSize: 1,
    });

    // Mock encoder
    indexer.encoder.encode = vi.fn().mockImplementation(async (texts: string[]) => {
      return texts.map(() => new Float32Array(1024).fill(0.1));
    });

    // Mock qdrant
    const upsertBatchSpy = vi.spyOn(indexer.qdrant, "upsertBatch").mockResolvedValue(undefined);

    // File that returns 0 chunks (skipped)
    const skippedFile = path.join(repoDir, "skipped.ts");
    fs.writeFileSync(skippedFile, "export const skipMe = true;");

    // Mock fs.readFileSync to throw on errorFile and return empty chunk for skippedFile
    const origReadFileSync = fs.readFileSync;
    const errorFile = path.join(repoDir, "error.ts");
    fs.writeFileSync(errorFile, "invalid content");
    vi.spyOn(fs, "readFileSync").mockImplementation((p, options) => {
      if (p === errorFile) throw new Error("Permission denied simulated");
      if (p === skippedFile) return ""; // empty content triggers 0 chunks -> skipped++
      return origReadFileSync(p, options);
    });

    const stats = await indexer.indexRepo(repoDir);

    expect(stats.files).toBeGreaterThanOrEqual(1);
    expect(stats.chunks).toBeGreaterThanOrEqual(1);
    expect(stats.skipped).toBe(1);
    expect(stats.errors).toBe(1);

    expect(upsertBatchSpy).toHaveBeenCalled();
    expect(fs.existsSync(vocabPath)).toBe(true);
  });

  it("performs hybrid search and prints formatted results", async () => {
    const indexer = new CodeIndexer({ workspace: workspaceDir, vocabPath });
    indexer.vocab.register("search target function");

    indexer.encoder.encodeQuery = vi.fn().mockResolvedValue(new Float32Array(1024).fill(0.2));

    const mockPayload: ChunkPayload = {
      workspace: "local-dev",
      repo: "my-repo",
      repoPath: "my-repo",
      path: "src/index.ts",
      absPath: "/abs/src/index.ts",
      language: "typescript",
      symbol: "searchTarget",
      chunkType: "function",
      startLine: 1,
      endLine: 10,
      fileHash: "hash1",
      chunkHash: "hash2",
      branch: "main",
      commit: "abcdef",
      lastIndexed: new Date().toISOString(),
    };

    const mockSearchResults: SearchResult[] = [
      { id: 1, score: 0.95, payload: mockPayload },
      { id: 2, score: 0.85, payload: { ...mockPayload, symbol: "" } },
    ];

    vi.spyOn(indexer.qdrant, "search").mockResolvedValue(mockSearchResults);

    const results = await indexer.search("search target", 5);
    expect(results).toHaveLength(2);
    expect(results[0].score).toBe(0.95);
  });

  it("performs searchDense and prints formatted results", async () => {
    const indexer = new CodeIndexer({ workspace: workspaceDir });
    indexer.encoder.encodeQuery = vi.fn().mockResolvedValue(new Float32Array(1024).fill(0.2));

    const mockPayload: ChunkPayload = {
      workspace: "local-dev",
      repo: "my-repo",
      repoPath: "my-repo",
      path: "src/index.ts",
      absPath: "/abs/src/index.ts",
      language: "typescript",
      symbol: "denseFunc",
      chunkType: "function",
      startLine: 5,
      endLine: 15,
      fileHash: "hash1",
      chunkHash: "hash2",
      branch: "main",
      commit: "abcdef",
      lastIndexed: new Date().toISOString(),
    };

    const mockSearchResults: SearchResult[] = [{ id: 1, score: 0.88, payload: mockPayload }];

    vi.spyOn(indexer.qdrant, "searchDense").mockResolvedValue(mockSearchResults);

    const results = await indexer.searchDense("dense query", 10);
    expect(results).toHaveLength(1);
  });

  it("delegates getStatus to QdrantClient", async () => {
    const indexer = new CodeIndexer({ workspace: workspaceDir });
    const spy = vi.spyOn(indexer.qdrant, "getStatus").mockResolvedValue({
      points: 100,
      indexedVectors: 100,
      segments: 2,
      vectorDim: 1024,
      sparseVectors: true,
    });

    await indexer.getStatus();
    expect(spy).toHaveBeenCalled();
  });

  it("delegates deleteRepo to QdrantClient", async () => {
    const indexer = new CodeIndexer({ workspace: workspaceDir });
    const spy = vi.spyOn(indexer.qdrant, "deleteRepo").mockResolvedValue(undefined);

    await indexer.deleteRepo("my-repo");
    expect(spy).toHaveBeenCalledWith("my-repo");
  });
});
