import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EmbeddingProvider } from "../src/embed/provider.ts";
import { WorkspaceCodeRagService } from "../src/index.ts";
import { FakeVectorStore } from "./fake-vector-store.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

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
  return new WorkspaceCodeRagService({
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
}

async function interruptAfterTwoChunks(service: WorkspaceCodeRagService): Promise<void> {
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
      cancellation.signal,
    ),
  ).rejects.toMatchObject({ code: "RAG_CANCELLED" });
}

describe("resumable full rebuild", () => {
  it("continues from the last committed chunk after service restart", async () => {
    const { root, data } = createFixture();
    const vectorStore = new FakeVectorStore();
    const initialEmbedding = new RecordingEmbeddingProvider();
    const initialService = createService(root, data, initialEmbedding, vectorStore, {
      embeddingDevice: "apple-mps",
    });
    await interruptAfterTwoChunks(initialService);

    const checkpointPath = join(data, initialService.repoId, "rebuild-checkpoint.json");
    const partialCollection = vectorStore.createdCollections[0];
    expect(existsSync(checkpointPath)).toBe(true);
    await expect(vectorStore.collectionStatus(partialCollection)).resolves.toMatchObject({ points: 2 });

    const resumedEmbedding = new RecordingEmbeddingProvider();
    const resumedService = createService(root, data, resumedEmbedding, vectorStore, {
      embeddingDevice: "apple-ane",
    });
    const summary = await resumedService.rebuild();

    expect(vectorStore.createdCollections).toEqual([partialCollection]);
    expect(resumedEmbedding.encodedTexts).toHaveLength(2);
    expect(summary.status.collection).toBe(partialCollection);
    await expect(vectorStore.collectionStatus(partialCollection)).resolves.toMatchObject({ points: 4 });
    expect(existsSync(checkpointPath)).toBe(false);
  });

  it("invalidates a checkpoint when repository contents change", async () => {
    const { root, data } = createFixture();
    const vectorStore = new FakeVectorStore();
    const initialService = createService(root, data, new RecordingEmbeddingProvider(), vectorStore);
    await interruptAfterTwoChunks(initialService);
    const partialCollection = vectorStore.createdCollections[0];

    writeFileSync(join(root, "file-0.ts"), 'export function value0() { return "changed-token"; }\n');
    const resumedEmbedding = new RecordingEmbeddingProvider();
    const resumedService = createService(root, data, resumedEmbedding, vectorStore);
    const summary = await resumedService.rebuild();

    expect(summary.status.collection).not.toBe(partialCollection);
    expect(vectorStore.deletedCollections).toContain(partialCollection);
    expect(resumedEmbedding.encodedTexts).toHaveLength(4);
  });

  it("invalidates a checkpoint when embedding compatibility changes", async () => {
    const { root, data } = createFixture();
    const vectorStore = new FakeVectorStore();
    const initialService = createService(root, data, new RecordingEmbeddingProvider(), vectorStore, {
      embeddingModel: "test-embedding-v1",
    });
    await interruptAfterTwoChunks(initialService);
    const partialCollection = vectorStore.createdCollections[0];

    const resumedEmbedding = new RecordingEmbeddingProvider();
    const resumedService = createService(root, data, resumedEmbedding, vectorStore, {
      embeddingModel: "test-embedding-v2",
    });
    const summary = await resumedService.rebuild();

    expect(summary.status.collection).not.toBe(partialCollection);
    expect(vectorStore.deletedCollections).toContain(partialCollection);
    expect(resumedEmbedding.encodedTexts).toHaveLength(4);
  });
});
