import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BM25Vocabulary } from "../src/bm25.ts";
import type { WorkspaceCodeRagService } from "../src/rag/service/workspacecoderagservice.ts";
import {
  do_encodeAndUpsert,
  do_encodeSpoolAndUpsert,
  do_performIncrementalRefresh,
} from "../src/rag/service/workspacecoderagservice-methods/incremental-refresh.ts";

describe("rag-incremental-methods", () => {
  it("throws RAG_INCOMPATIBLE_INDEX when collection dimensions mismatch settings", async () => {
    const service = {
      manifest: { collection: "test-coll", generation: "g1", files: {} },
      settings: { embeddingDimensions: 1024 },
      vectorStore: {
        collectionStatus: async () => ({ dimensions: 512, pointCount: 10 }),
      },
    } as unknown as WorkspaceCodeRagService;

    const plan = { added: [], changed: [], deleted: [], unchanged: [] };
    const signal = new AbortController().signal;
    await expect(do_performIncrementalRefresh(service, plan, Date.now(), signal, () => {})).rejects.toThrow(
      "Stored vector dimensions are incompatible",
    );
  });

  it("handles deleted and unchanged files in incremental refresh", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-inc-del-"));
    try {
      const manifestPath = path.join(tmpDir, "manifest.json");
      const service = {
        repoId: "test-repo",
        workspaceRoot: tmpDir,
        manifestPath,
        manifest: {
          schemaVersion: 1,
          repoId: "test-repo",
          root: tmpDir,
          generation: "g1",
          collection: "test-coll",
          state: "ready",
          files: {
            "deleted.ts": {
              hash: "h1",
              size: 10,
              mtimeMs: 10,
              chunkCount: 1,
              indexedAt: "t",
              language: "ts",
              isTest: false,
              isGenerated: false,
            },
            "unchanged.ts": {
              hash: "h2",
              size: 20,
              mtimeMs: 20,
              chunkCount: 2,
              indexedAt: "t",
              language: "ts",
              isTest: false,
              isGenerated: false,
            },
          },
          sparse: { driftFileCount: 0, vocabularyFile: "v.json" },
        },
        settings: { embeddingDimensions: 1024 },
        vectorStore: {
          collectionStatus: async () => ({ dimensions: 1024, pointCount: 3 }),
          deleteFileVersions: vi.fn().mockResolvedValue(undefined),
        },
        loadVocabulary: () => new BM25Vocabulary(),
        processPreparedFiles: async () => {},
        now: () => new Date(),
        reportProgress: () => {},
        summaryForPlan: () => ({ fullRebuild: false, chunksEmbedded: 0, durationMs: 10 }),
      } as unknown as WorkspaceCodeRagService;

      const plan = {
        added: [],
        changed: [],
        deleted: [{ path: "deleted.ts" }],
        unchanged: [
          {
            absPath: path.join(tmpDir, "unchanged.ts"),
            path: "unchanged.ts",
            size: 25,
            mtimeMs: 25,
            hash: "h2",
            language: "ts",
            isTest: false,
            isGenerated: false,
          },
        ],
      };

      const res = await do_performIncrementalRefresh(
        service,
        plan as never,
        Date.now(),
        new AbortController().signal,
        () => {},
      );
      expect(res.fullRebuild).toBe(false);
      expect(service.manifest?.files["deleted.ts"]).toBeUndefined();
      expect(service.manifest?.files["unchanged.ts"]?.size).toBe(25);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("do_encodeSpoolAndUpsert handles blank lines and throws on mismatched line counts", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-spool-test-"));
    try {
      const spoolFile = path.join(tmpDir, "rebuild.jsonl");
      fs.writeFileSync(spoolFile, '{"id":1,"retrievalText":"txt"}\n\n{"id":2,"retrievalText":"txt2"}\n');

      const service = {
        settings: { encodeBatchSize: 10 },
        refreshSettingsSilently: () => {},
        encodeAndUpsert: vi.fn().mockResolvedValue(undefined),
      } as unknown as WorkspaceCodeRagService;

      const vocab = new BM25Vocabulary();
      const signal = new AbortController().signal;

      // When expected totalChunks is 2, it should succeed ignoring blank line
      await expect(
        do_encodeSpoolAndUpsert(service, "test-coll", spoolFile, 2, vocab, signal, () => {}, 0),
      ).resolves.toBeUndefined();

      // When expected totalChunks is 5 (mismatch), it should throw
      await expect(
        do_encodeSpoolAndUpsert(service, "test-coll", spoolFile, 5, vocab, signal, () => {}, 0),
      ).rejects.toThrow("Rebuild spool chunk count changed");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("do_encodeAndUpsert handles empty chunks and incomplete batch error", async () => {
    const service = {
      settings: { searchMode: "dense-and-sparse", encodeBatchSize: 10, upsertBatchSize: 10 },
      refreshSettingsSilently: () => {},
      embeddingProvider: {
        encode: vi.fn().mockResolvedValue([]), // Return 0 vectors for 1 chunk -> incomplete batch!
      },
    } as unknown as WorkspaceCodeRagService;

    const vocab = new BM25Vocabulary();
    const signal = new AbortController().signal;

    // Empty chunks returns immediately
    let progressReported = false;
    await do_encodeAndUpsert(service, "coll", [], vocab, signal, () => {
      progressReported = true;
    });
    expect(progressReported).toBe(true);

    // Incomplete batch throws
    const chunk = { id: 1, retrievalText: "hello", payload: {} };
    await expect(do_encodeAndUpsert(service, "coll", [chunk as never], vocab, signal)).rejects.toThrow(
      "Embedding provider returned an incomplete batch",
    );
  });
});
