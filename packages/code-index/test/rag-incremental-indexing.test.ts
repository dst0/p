import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceCodeRagService } from "../src/rag/service.ts";
import type { RagVectorStore } from "../src/rag/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("incremental indexing vector dimension checks and file diffs", () => {
  it("rejects incremental refresh when vector store dimensions are incompatible", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-inc-dim-"));
    temporaryDirectories.push(dir);
    writeFileSync(join(dir, "f1.ts"), "const a = 1;");

    const mockStore: RagVectorStore = {
      collectionExists: async () => true,
      createCollection: async () => {},
      deleteCollection: async () => {},
      collectionStatus: async () => ({ points: 1, dimensions: 512 }),
      upsert: async () => {},
      deleteFileVersions: async () => {},
      search: async () => [],
    };

    const service = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      vectorStore: mockStore,
      embeddingProvider: {
        dim: 1024,
        encode: async () => [new Float32Array(1024)],
        encodeQuery: async () => new Float32Array(1024),
      },
      manageLocalBackends: false,
      settings: {
        preparationWorkerMemoryBytes: 1 * 1024 * 1024,
        preparationMemoryReserveBytes: 1 * 1024 * 1024,
      },
    });

    await service.refresh();
    expect((service as unknown as { state: string }).state).toBe("ready");

    (
      service as unknown as { settings: { sparseRebuildDriftRatio: number; fullSparseRebuildChangeRatio: number } }
    ).settings.sparseRebuildDriftRatio = 1.0;
    (
      service as unknown as { settings: { sparseRebuildDriftRatio: number; fullSparseRebuildChangeRatio: number } }
    ).settings.fullSparseRebuildChangeRatio = 1.0;

    writeFileSync(join(dir, "f1.ts"), "const a = 2;");

    await expect(service.refresh()).rejects.toThrow("Stored vector dimensions are incompatible");
  });
});
