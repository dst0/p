import os from "node:os";
import path from "node:path";
import { EmbeddingServerManager, QdrantServerManager } from "@dst0/p-code-index";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IndexingDaemon } from "../src/core/indexing-daemon.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("indexing daemon backends", () => {
  it("starts Qdrant without the embedding server in fast BM25 mode", async () => {
    const ensureQdrant = vi.spyOn(QdrantServerManager.prototype, "ensureStarted").mockResolvedValue(true);
    const ensureEmbedding = vi.spyOn(EmbeddingServerManager.prototype, "ensureStarted").mockResolvedValue(true);
    const agentDir = path.join(os.tmpdir(), "p-indexing-daemon-bm25");
    const daemon = new IndexingDaemon({
      agentDir,
      qdrantBinary: "unused",
      qdrantDataDirectory: path.join(agentDir, "qdrant"),
      pythonExecutable: "unused",
      embeddingModel: "unused",
      useDenseEmbeddings: false,
    });

    await daemon._ensureBackendsRaw();

    expect(ensureQdrant).toHaveBeenCalledOnce();
    expect(ensureEmbedding).not.toHaveBeenCalled();
  });
});
