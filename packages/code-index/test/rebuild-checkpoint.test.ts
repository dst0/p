import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BM25Vocabulary } from "../src/bm25.ts";
import type { EmbeddingProvider } from "../src/embed/provider.ts";
import { WorkspaceCodeRagService } from "../src/index.ts";
import {
  loadRebuildCheckpoint,
  loadRebuildPlan,
  rebuildArtifacts,
  rebuildCheckpointPath,
} from "../src/rag/service/rebuild-checkpoint.ts";
import { FakeVectorStore } from "./fake-vector-store.ts";

const temporaryDirectories: string[] = [];
const services: WorkspaceCodeRagService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
}, 30_000);

class RecordingEmbeddingProvider implements EmbeddingProvider {
  dim = 3;
  encodedTexts: string[] = [];

  async encode(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    if (signal?.aborted) throw signal.reason;
    this.encodedTexts.push(...texts);
    return texts.map((text) => new Float32Array([text.length % 7, text.length % 11, text.length % 13]));
  }

  async encodeQuery(text: string, signal?: AbortSignal): Promise<Float32Array> {
    if (signal?.aborted) throw signal.reason;
    return new Float32Array([text.length % 7, text.length % 11, text.length % 13]);
  }
}

function createFixture(): { root: string; data: string } {
  const directory = mkdtempSync(join(tmpdir(), "p-rebuild-checkpoint-"));
  temporaryDirectories.push(directory);
  const root = join(directory, "repo");
  const data = join(directory, "data");
  mkdirSync(root);
  for (let index = 0; index < 4; index += 1) {
    writeFileSync(join(root, `file-${index}.ts`), `export function value${index}() { return "token-${index}"; }\n`);
  }
  return { root, data };
}

function createService(
  root: string,
  data: string,
  embeddingProvider: RecordingEmbeddingProvider,
  vectorStore: FakeVectorStore,
  options: {
    embeddingDevice?: "apple-mps" | "apple-ane";
    embeddingModel?: string;
  } = {},
): WorkspaceCodeRagService {
  const service = new WorkspaceCodeRagService({
    workspaceRoot: root,
    dataDirectory: data,
    embeddingProvider,
    vectorStore,
    settings: {
      enabled: true,
      autoRefresh: false,
      embeddingDevice: options.embeddingDevice ?? "apple-mps",
      embeddingDimensions: 3,
      embeddingModel: options.embeddingModel ?? "test-embedding-v1",
      embeddingPooling: "last-non-padding-token",
      embeddingNormalization: "l2",
      encodeBatchSize: 1,
      upsertBatchSize: 1,
      preparationMaxWorkers: 1,
      preparationWorkerMemoryBytes: 1024 * 1024,
      preparationMemoryReserveBytes: 1024 * 1024,
    },
  });
  services.push(service);
  return service;
}

async function interruptAfterTwoChunks(service: WorkspaceCodeRagService, signal: AbortSignal): Promise<void> {
  const cancellation = new AbortController();
  await expect(
    service.rebuild(
      {
        onProgress(progress) {
          if (progress.phase === "indexing" && progress.processedChunks === 2) {
            cancellation.abort(new Error("switch indexing backend"));
          }
        },
      },
      AbortSignal.any([cancellation.signal, signal]),
    ),
  ).rejects.toMatchObject({ code: "RAG_CANCELLED" });
  signal.throwIfAborted();
  expect(cancellation.signal.aborted).toBe(true);
}

// These integration cases start real scan/preparation workers twice; allow full-suite load margin.
describe("resumable full rebuild", { timeout: 90_000 }, () => {
  it("continues from the last committed chunk after service restart", async ({ signal }) => {
    const { root, data } = createFixture();
    const vectorStore = new FakeVectorStore();
    const initialEmbedding = new RecordingEmbeddingProvider();
    const initialService = createService(root, data, initialEmbedding, vectorStore, {
      embeddingDevice: "apple-mps",
    });
    await interruptAfterTwoChunks(initialService, signal);

    const checkpointPath = join(data, initialService.repoId, "rebuild-checkpoint.json");
    const partialCollection = vectorStore.createdCollections[0];
    expect(existsSync(checkpointPath)).toBe(true);
    await expect(vectorStore.collectionStatus(partialCollection)).resolves.toMatchObject({ points: 2 });

    const resumedEmbedding = new RecordingEmbeddingProvider();
    const resumedService = createService(root, data, resumedEmbedding, vectorStore, {
      embeddingDevice: "apple-ane",
    });
    const summary = await resumedService.rebuild({}, signal);

    expect(vectorStore.createdCollections).toEqual([partialCollection]);
    expect(resumedEmbedding.encodedTexts).toHaveLength(2);
    expect(summary.status.collection).toBe(partialCollection);
    await expect(vectorStore.collectionStatus(partialCollection)).resolves.toMatchObject({ points: 4 });
    expect(existsSync(checkpointPath)).toBe(false);
  });

  it("continues after metadata-only timestamp changes", async ({ signal }) => {
    const { root, data } = createFixture();
    const vectorStore = new FakeVectorStore();
    const initialService = createService(root, data, new RecordingEmbeddingProvider(), vectorStore);
    await interruptAfterTwoChunks(initialService, signal);
    const partialCollection = vectorStore.createdCollections[0];

    const touchedFile = join(root, "file-0.ts");
    const touchedAt = new Date(Date.now() + 60_000);
    utimesSync(touchedFile, touchedAt, touchedAt);

    const resumedEmbedding = new RecordingEmbeddingProvider();
    const resumedService = createService(root, data, resumedEmbedding, vectorStore);
    const summary = await resumedService.rebuild({}, signal);

    expect(summary.status.collection).toBe(partialCollection);
    expect(vectorStore.createdCollections).toEqual([partialCollection]);
    expect(resumedEmbedding.encodedTexts).toHaveLength(2);
  });

  it("invalidates a checkpoint when repository contents change", async ({ signal }) => {
    const { root, data } = createFixture();
    const vectorStore = new FakeVectorStore();
    const initialService = createService(root, data, new RecordingEmbeddingProvider(), vectorStore);
    await interruptAfterTwoChunks(initialService, signal);
    const partialCollection = vectorStore.createdCollections[0];

    writeFileSync(join(root, "file-0.ts"), 'export function value0() { return "changed-token"; }\n');
    const resumedEmbedding = new RecordingEmbeddingProvider();
    const resumedService = createService(root, data, resumedEmbedding, vectorStore);
    const summary = await resumedService.rebuild({}, signal);

    expect(summary.status.collection).not.toBe(partialCollection);
    expect(vectorStore.deletedCollections).toContain(partialCollection);
    expect(resumedEmbedding.encodedTexts).toHaveLength(4);
  });

  it("invalidates a checkpoint when embedding compatibility changes", async ({ signal }) => {
    const { root, data } = createFixture();
    const vectorStore = new FakeVectorStore();
    const initialService = createService(root, data, new RecordingEmbeddingProvider(), vectorStore, {
      embeddingModel: "test-embedding-v1",
    });
    await interruptAfterTwoChunks(initialService, signal);
    const partialCollection = vectorStore.createdCollections[0];

    const resumedEmbedding = new RecordingEmbeddingProvider();
    const resumedService = createService(root, data, resumedEmbedding, vectorStore, {
      embeddingModel: "test-embedding-v2",
    });
    const summary = await resumedService.rebuild({}, signal);

    expect(summary.status.collection).not.toBe(partialCollection);
    expect(vectorStore.deletedCollections).toContain(partialCollection);
    expect(resumedEmbedding.encodedTexts).toHaveLength(4);
  });

  it.for(["checkpoint JSON", "plan JSON", "plan generation", "vocabulary JSON", "vocabulary count"] as const)(
    "restarts all chunks after corrupt %s",
    async (corruption, { signal }) => {
      const { root, data } = createFixture();
      const vectorStore = new FakeVectorStore();
      const initialService = createService(root, data, new RecordingEmbeddingProvider(), vectorStore);
      await interruptAfterTwoChunks(initialService, signal);
      const partialCollection = vectorStore.createdCollections[0]!;
      const checkpoint = loadRebuildCheckpoint(rebuildCheckpointPath(initialService.repositoryDirectory));
      expect(checkpoint).toMatchObject({ collection: partialCollection, completedChunks: 2, chunkCount: 4 });
      if (!checkpoint) throw new Error("Interrupted rebuild did not persist a valid checkpoint");
      const artifacts = rebuildArtifacts(initialService.repositoryDirectory, checkpoint.generation);
      for (const artifact of Object.values(artifacts)) expect(existsSync(artifact)).toBe(true);

      if (corruption === "checkpoint JSON") writeFileSync(artifacts.checkpoint, "{ invalid json");
      else if (corruption === "plan JSON") writeFileSync(artifacts.plan, "{ invalid json");
      else if (corruption === "plan generation") {
        const plan = loadRebuildPlan(artifacts.plan, checkpoint.generation);
        expect(plan).toBeDefined();
        writeFileSync(artifacts.plan, JSON.stringify({ ...plan, generation: "wrong-generation" }));
      } else if (corruption === "vocabulary JSON") writeFileSync(artifacts.vocabulary, "{ invalid json");
      else {
        const vocabulary = BM25Vocabulary.load(artifacts.vocabulary);
        expect(vocabulary.totalDocs).toBe(checkpoint.chunkCount);
        vocabulary.totalDocs = checkpoint.chunkCount + 1;
        vocabulary.save(artifacts.vocabulary);
      }

      const resumedEmbedding = new RecordingEmbeddingProvider();
      const resumedService = createService(root, data, resumedEmbedding, vectorStore);
      const summary = await resumedService.rebuild({}, signal);
      expect(summary.status.collection).not.toBe(partialCollection);
      expect(resumedEmbedding.encodedTexts).toHaveLength(4);
      await expect(vectorStore.collectionStatus(summary.status.collection!)).resolves.toMatchObject({ points: 4 });
      expect(existsSync(artifacts.checkpoint)).toBe(false);
      if (corruption !== "checkpoint JSON") {
        expect(vectorStore.deletedCollections).toContain(partialCollection);
        for (const artifact of [artifacts.plan, artifacts.spool, artifacts.vocabulary]) {
          expect(existsSync(artifact)).toBe(false);
        }
      }
    },
  );

  it.for(["missing", "too few points", "too many points", "wrong dimensions"] as const)(
    "restarts all chunks when the partial collection has %s",
    async (corruption, { signal }) => {
      const { root, data } = createFixture();
      const vectorStore = new FakeVectorStore();
      const initialService = createService(root, data, new RecordingEmbeddingProvider(), vectorStore);
      await interruptAfterTwoChunks(initialService, signal);
      const partialCollection = vectorStore.createdCollections[0]!;
      if (corruption === "missing") await vectorStore.deleteCollection(partialCollection);
      else if (corruption === "wrong dimensions") vectorStore.dimensions.set(partialCollection, 9);
      else {
        const points = vectorStore.collections.get(partialCollection)!;
        expect(points.size).toBe(2);
        if (corruption === "too few points") points.clear();
        else {
          const point = [...points.values()][0]!;
          for (let index = 0; index < 3; index += 1) points.set(`extra-${index}`, { ...point, id: `extra-${index}` });
        }
      }

      const resumedEmbedding = new RecordingEmbeddingProvider();
      const resumedService = createService(root, data, resumedEmbedding, vectorStore);
      const summary = await resumedService.rebuild({}, signal);
      expect(summary.status.collection).not.toBe(partialCollection);
      expect(vectorStore.deletedCollections).toContain(partialCollection);
      expect(resumedEmbedding.encodedTexts).toHaveLength(4);
      await expect(vectorStore.collectionStatus(summary.status.collection!)).resolves.toMatchObject({
        points: 4,
        dimensions: 3,
      });
    },
  );
});
