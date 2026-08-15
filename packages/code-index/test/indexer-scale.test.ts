import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeIndexer } from "../src/indexer.ts";
import type { IndexConfig } from "../src/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("code indexer progress reporting and large scale batching", () => {
  it("indexes a repository producing >2000 chunks and uploads points in batches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-indexer-2000-"));
    temporaryDirectories.push(dir);
    mkdirSync(join(dir, ".git"));

    // 10 files with 250 functions each = 2500 chunks total
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
