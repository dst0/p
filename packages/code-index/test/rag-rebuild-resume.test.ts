import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BM25Vocabulary } from "../src/bm25.ts";
import type { EmbeddingProvider } from "../src/embed/provider.ts";
import { WorkspaceCodeRagService } from "../src/index.ts";
import {
  loadRebuildPlan,
  REBUILD_CHECKPOINT_SCHEMA_VERSION,
  rebuildCheckpointPath,
  writeRebuildCheckpoint,
} from "../src/rag/service/rebuild-checkpoint.ts";
import { loadActiveRebuild, prepareActiveRebuild } from "../src/rag/service/rebuild-resume.ts";
import { do_encodeSpoolAndUpsert } from "../src/rag/service/workspacecoderagservice-methods/incremental-refresh.ts";
import { FakeVectorStore } from "./fake-vector-store.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

class MockEmbeddingProvider implements EmbeddingProvider {
  dim = 3;
  async encode(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => new Float32Array([1, 2, 3]));
  }
  async encodeQuery(): Promise<Float32Array> {
    return new Float32Array([1, 2, 3]);
  }
}

function createFixture(): { root: string; data: string } {
  const directory = mkdtempSync(join(tmpdir(), "p-rebuild-cov-"));
  temporaryDirectories.push(directory);
  const root = join(directory, "repo");
  const data = join(directory, "data");
  mkdirSync(root);
  mkdirSync(data);
  return { root, data };
}

function createService(root: string, data: string, vectorStore: FakeVectorStore): WorkspaceCodeRagService {
  return new WorkspaceCodeRagService({
    workspaceRoot: root,
    dataDirectory: data,
    embeddingProvider: new MockEmbeddingProvider(),
    vectorStore,
    settings: {
      enabled: true,
      autoRefresh: false,
      embeddingDevice: "apple-mps",
      embeddingDimensions: 3,
      embeddingModel: "test-model",
      embeddingPooling: "last-non-padding-token",
      embeddingNormalization: "l2",
      encodeBatchSize: 1,
      upsertBatchSize: 1,
      preparationMaxWorkers: 1,
      preparationWorkerMemoryBytes: 1024 * 1024,
      preparationMemoryReserveBytes: 1024 * 1024,
    },
  });
}

describe("active rebuild resumption and vector store point verification", () => {
  it("loadRebuildPlan returns undefined for corrupted json and invalid files schema", () => {
    const { data } = createFixture();
    const planPath = join(data, "plan.json");

    writeFileSync(planPath, "{ invalid json");
    expect(loadRebuildPlan(planPath, "gen-1")).toBeUndefined();

    writeFileSync(
      planPath,
      JSON.stringify({ schemaVersion: REBUILD_CHECKPOINT_SCHEMA_VERSION, generation: "gen-1", files: "not-an-object" }),
    );
    expect(loadRebuildPlan(planPath, "gen-1")).toBeUndefined();

    writeFileSync(
      planPath,
      JSON.stringify({ schemaVersion: REBUILD_CHECKPOINT_SCHEMA_VERSION, generation: "gen-1", files: [] }),
    );
    expect(loadRebuildPlan(planPath, "gen-1")).toBeUndefined();
  });

  it("loadActiveRebuild handles corrupted vocabulary, zero completed chunks collection creation, and vector store dimension/point mismatches", async () => {
    const { root, data } = createFixture();
    const vectorStore = new FakeVectorStore();
    const service = createService(root, data, vectorStore);
    mkdirSync(service.repositoryDirectory, { recursive: true });
    const signal = new AbortController().signal;

    // Create an active rebuild with prepareActiveRebuild
    const active = await prepareActiveRebuild(service, [], signal, () => {});
    expect(active.resumed).toBe(false);

    // 1. Zero completed chunks collection recreation when collection is missing
    await vectorStore.deleteCollection(active.checkpoint.collection);
    expect(await vectorStore.collectionExists(active.checkpoint.collection)).toBe(false);
    const resumedRecreated = await loadActiveRebuild(service, []);
    expect(resumedRecreated?.resumed).toBe(true);
    expect(await vectorStore.collectionExists(active.checkpoint.collection)).toBe(true);

    // 2. Collection status dimensions mismatch
    const badDimensionService = new WorkspaceCodeRagService({
      workspaceRoot: root,
      dataDirectory: data,
      embeddingProvider: new MockEmbeddingProvider(),
      vectorStore,
      settings: {
        ...service.settings,
        embeddingDimensions: 999, // mismatch with collection's 3
      },
    });
    const resumedDimMismatch = await loadActiveRebuild(badDimensionService, []);
    expect(resumedDimMismatch).toBeUndefined();

    // 3. Corrupted vocabulary file
    const active2 = await prepareActiveRebuild(service, [], signal, () => {});
    writeFileSync(active2.artifacts.vocabulary, "{ invalid vocab json");
    const resumedCorruptVocab = await loadActiveRebuild(service, []);
    expect(resumedCorruptVocab).toBeUndefined();

    // 4. Vocabulary totalDocs mismatch
    writeFileSync(join(root, "f1.ts"), "export const a = 1;\n");
    const scanned = await service.scanWorkspace(signal, () => {});
    const active3 = await prepareActiveRebuild(service, scanned, signal, () => {});
    const vocabMismatch = new BM25Vocabulary();
    vocabMismatch.totalDocs = 999; // mismatch with chunkCount
    vocabMismatch.save(active3.artifacts.vocabulary);
    const resumedVocabMismatch = await loadActiveRebuild(service, scanned);
    expect(resumedVocabMismatch).toBeUndefined();

    // 5. Directory at checkpoint path tests unlinkBestEffort non-ENOENT branch
    const dirCheckpointPath = rebuildCheckpointPath(service.repositoryDirectory);
    rmSync(dirCheckpointPath, { force: true, recursive: true });
    mkdirSync(dirCheckpointPath);
    expect(await loadActiveRebuild(service, [])).toBeUndefined();
  });

  it("loadActiveRebuild handles collection points mismatch and dimension mismatch when collection exists", async () => {
    const { root, data } = createFixture();
    const vectorStore = new FakeVectorStore();
    const service = createService(root, data, vectorStore);
    mkdirSync(service.repositoryDirectory, { recursive: true });
    const signal = new AbortController().signal;

    writeFileSync(join(root, "f1.ts"), "export const a = 1;\n");
    const scanned = await service.scanWorkspace(signal, () => {});
    const active = await prepareActiveRebuild(service, scanned, signal, () => {});
    active.checkpoint.completedChunks = 1; // valid per schema (<= chunkCount: 1), but collection has 0 points
    writeRebuildCheckpoint(rebuildCheckpointPath(service.repositoryDirectory), active.checkpoint);
    const resumedPointsMismatch = await loadActiveRebuild(service, scanned);
    expect(resumedPointsMismatch).toBeUndefined();
  });

  it("do_encodeSpoolAndUpsert validates startOffset and detects spool count changes", async () => {
    const { root, data } = createFixture();
    const vectorStore = new FakeVectorStore();
    const service = createService(root, data, vectorStore);
    await vectorStore.createCollection("coll", service.settings.embeddingDimensions);
    const spoolPath = join(data, "test.spool");
    const chunk = {
      id: "c1",
      retrievalText: "const a = 1;",
      payload: {
        text: "const a = 1;",
        path: "test.ts",
        chunkIndex: 0,
        totalChunks: 1,
        startLine: 1,
        endLine: 1,
        language: "typescript",
        isTest: false,
        isGenerated: false,
        hash: "h",
      },
    };
    writeFileSync(spoolPath, `${JSON.stringify(chunk)}\n`);
    const vocab = new BM25Vocabulary();
    vocab.register("const a = 1;");

    // Invalid startOffset
    await expect(
      do_encodeSpoolAndUpsert(service, "coll", spoolPath, 1, vocab, new AbortController().signal, () => {}, -1),
    ).rejects.toThrow("Rebuild checkpoint chunk offset is invalid");

    await expect(
      do_encodeSpoolAndUpsert(service, "coll", spoolPath, 1, vocab, new AbortController().signal, () => {}, 10),
    ).rejects.toThrow("Rebuild checkpoint chunk offset is invalid");

    // Spool count mismatch (expected 2 chunks, found 1)
    await expect(
      do_encodeSpoolAndUpsert(service, "coll", spoolPath, 2, vocab, new AbortController().signal, () => {}, 0),
    ).rejects.toThrow("Rebuild spool chunk count changed: expected 2, found 1");
  });

  it("throws when compatibility settings change during rebuild indexing progress", async () => {
    const { root, data } = createFixture();
    writeFileSync(join(root, "file.ts"), "export const x = 1;\n");
    const vectorStore = new FakeVectorStore();
    let mutated = false;
    const provider: EmbeddingProvider = {
      dim: 3,
      async encode(texts: string[]): Promise<Float32Array[]> {
        if (!mutated) {
          mutated = true;
          // Change settings while encoding
          service.settings = { ...service.settings, embeddingDimensions: 7 };
        }
        return texts.map(() => new Float32Array([1, 2, 3]));
      },
      async encodeQuery(): Promise<Float32Array> {
        return new Float32Array([1, 2, 3]);
      },
    };
    const service = new WorkspaceCodeRagService({
      workspaceRoot: root,
      dataDirectory: data,
      embeddingProvider: provider,
      vectorStore,
      settings: {
        enabled: true,
        autoRefresh: false,
        embeddingDevice: "apple-mps",
        embeddingDimensions: 3,
        embeddingModel: "test-model",
        embeddingPooling: "last-non-padding-token",
        embeddingNormalization: "l2",
        encodeBatchSize: 1,
        upsertBatchSize: 1,
        preparationMaxWorkers: 1,
        preparationWorkerMemoryBytes: 1024 * 1024,
        preparationMemoryReserveBytes: 1024 * 1024,
      },
    });

    await expect(service.rebuild()).rejects.toThrow("Rebuild compatibility settings changed while indexing");
  });
});
