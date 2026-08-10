import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CodeRagService, IndexUpdateSummary, RagStatus } from "@dst0/p-code-index";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IndexingDaemon } from "../src/core/indexing-daemon.ts";
import { IndexingService } from "../src/core/indexing-service.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function createBlockedService(workspaceRoot: string, starts: string[], aborts: string[]): CodeRagService {
  const status: RagStatus = {
    state: "ready",
    workspaceRoot,
    repoId: workspaceRoot,
    indexedFiles: 1,
    indexedChunks: 1,
    sparse: { exact: true, driftFileCount: 0 },
  };
  const summary: IndexUpdateSummary = {
    status,
    durationMs: 0,
    filesScanned: 1,
    filesAdded: 0,
    filesChanged: 1,
    filesDeleted: 0,
    filesUnchanged: 0,
    chunksEmbedded: 1,
    fullRebuild: false,
  };
  return {
    initialize: async () => status,
    status: async () => status,
    search: async (input) => ({
      query: input.query,
      workspaceRoot,
      status,
      results: [],
      diagnostics: { durationMs: 0, truncated: false },
    }),
    refresh: async (options, signal) => {
      if (options?.transactional !== true) throw new Error("daemon refresh must be transactional");
      starts.push(workspaceRoot);
      options?.onProgress?.({ phase: "indexing", percent: 0, processedChunks: 0, totalChunks: 1 });
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => {
          aborts.push(workspaceRoot);
          reject(signal?.reason ?? new Error("aborted"));
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
      return summary;
    },
    rebuild: async () => summary,
    dispose: async () => {},
  };
}

describe("new repository priority", { timeout: 30_000 }, () => {
  it.each([true, false])("stops the managed embedding server after waiting for idle (%s)", async (idleConfirmed) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-index-up-device-release-"));
    temporaryDirectories.push(root);
    const daemon = new IndexingDaemon({
      agentDir: path.join(root, "agent"),
      qdrantBinary: "unused",
      qdrantDataDirectory: path.join(root, "qdrant"),
      pythonExecutable: "unused",
      embeddingModel: "unused",
      ensureBackends: async () => {},
      disposeBackends: async () => {},
    });
    vi.spyOn(daemon.embeddingManager, "waitUntilIdle").mockResolvedValue(idleConfirmed);
    const stop = vi.spyOn(daemon.embeddingManager, "stop").mockResolvedValue();

    await daemon.releaseEmbeddingDevice();

    expect(stop).toHaveBeenCalledOnce();
  });

  it("preempts active indexing when a new repository first appears with an up request", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-index-up-new-repo-"));
    temporaryDirectories.push(root);
    const agentDir = path.join(root, "agent");
    const backgroundRepo = path.join(root, "background");
    const requestedRepo = path.join(root, "requested");
    for (const repository of [backgroundRepo, requestedRepo]) {
      fs.mkdirSync(path.join(repository, ".git"), { recursive: true });
    }
    const client = new IndexingService(agentDir);
    client.enableIndexing(backgroundRepo);
    const starts: string[] = [];
    const aborts: string[] = [];
    let deviceReleases = 0;
    const daemon = new IndexingDaemon({
      agentDir,
      qdrantBinary: "unused",
      qdrantDataDirectory: path.join(agentDir, "qdrant"),
      pythonExecutable: "unused",
      embeddingModel: "unused",
      serviceFactory: (workspaceRoot) => createBlockedService(workspaceRoot, starts, aborts),
      ensureBackends: async () => {},
      releaseEmbeddingDevice: async () => {
        deviceReleases += 1;
      },
      disposeBackends: async () => {},
    });

    try {
      await daemon.start();
      await waitFor(() => starts.length === 1);
      daemon.pauseIntake();
      client.enableIndexing(requestedRepo);
      expect(client.prioritizeIndexing(requestedRepo)).toBe(true);
      await daemon.runRegistrySync();
      await waitFor(() => starts.includes(fs.realpathSync(requestedRepo)));

      expect(aborts).toEqual([fs.realpathSync(backgroundRepo)]);
      expect(deviceReleases).toBe(1);
    } finally {
      await daemon.stop();
    }
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for indexing state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
