import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceCodeRagService } from "../src/rag/service.ts";
import type { RagVectorStore } from "../src/rag/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("RAG concurrent first-use rebuild", () => {
  it("shares one refresh operation after initialization", async () => {
    const directory = mkdtempSync(join(tmpdir(), "p-rag-concurrent-rebuild-"));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, "source.ts"), "export const value = 1;\n");
    let collectionExists = false;
    const store = {
      collectionExists: async () => collectionExists,
      createCollection: async () => {
        collectionExists = true;
      },
      deleteCollection: async () => {
        collectionExists = false;
      },
      collectionStatus: async () => ({ points: 0, dimensions: 1024 }),
      upsert: async () => {},
      deleteFileVersions: async () => {},
      search: async () => [],
    } satisfies RagVectorStore;
    const service = new WorkspaceCodeRagService({
      workspaceRoot: directory,
      dataDirectory: join(directory, "data"),
      vectorStore: store,
      embeddingProvider: {
        dim: 1024,
        encode: async () => [new Float32Array(1024)],
        encodeQuery: async () => new Float32Array(1024),
      },
      manageLocalBackends: false,
    });
    const runRefresh = vi.spyOn(service, "runRefresh");

    const [first, second] = await Promise.all([service.rebuild(), service.rebuild()]);

    expect(runRefresh).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });
});
