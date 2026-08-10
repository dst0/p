import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  CodeRagService,
  IndexUpdateSummary,
  RagStatus,
  SemanticSearchInput,
  SemanticSearchResponse,
} from "@dst0/p-code-index";
import { describe, expect, it, vi } from "vitest";
import { enableIndexingForRepo, loadIndexedRepos } from "../src/core/indexed-repos.ts";
import { IndexingDaemon } from "../src/core/indexing-daemon.ts";
import { IndexingService } from "../src/core/indexing-service.ts";

class OutOfMemoryRagService implements CodeRagService {
  refreshAttempts = 0;
  private readonly workspaceRoot: string;
  private shouldFail = true;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  recover(): void {
    this.shouldFail = false;
  }

  async initialize(): Promise<RagStatus> {
    return this.status();
  }

  async status(): Promise<RagStatus> {
    return {
      state: "ready",
      workspaceRoot: this.workspaceRoot,
      repoId: "oom-repository",
      indexedFiles: 1,
      indexedChunks: 1,
      sparse: { exact: true, driftFileCount: 0 },
    };
  }

  async search(input: SemanticSearchInput): Promise<SemanticSearchResponse> {
    return {
      query: input.query,
      workspaceRoot: this.workspaceRoot,
      status: await this.status(),
      results: [],
      diagnostics: { durationMs: 0, truncated: false },
    };
  }

  async refresh(): Promise<IndexUpdateSummary> {
    this.refreshAttempts += 1;
    if (this.shouldFail) throw new Error("MPS backend out of memory at batch size 1");
    return {
      status: await this.status(),
      durationMs: 1,
      filesScanned: 1,
      filesAdded: 0,
      filesChanged: 1,
      filesDeleted: 0,
      filesUnchanged: 0,
      chunksEmbedded: 1,
      fullRebuild: false,
    };
  }

  async rebuild(): Promise<IndexUpdateSummary> {
    return this.refresh();
  }

  async dispose(): Promise<void> {}
}

describe("indexing resource failure lifecycle", () => {
  it("releases the embedding device and blocks automatic retries after OOM", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-index-oom-"));
    const agentDir = path.join(root, "agent");
    const repository = path.join(root, "repository");
    fs.mkdirSync(path.join(repository, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repository, "index.ts"), "export const initial = true;\n");
    enableIndexingForRepo(repository, agentDir);
    const service = new OutOfMemoryRagService(repository);
    let deviceReleases = 0;
    const createDaemon = () =>
      new IndexingDaemon({
        agentDir,
        qdrantBinary: "unused",
        qdrantDataDirectory: path.join(agentDir, "qdrant"),
        pythonExecutable: "unused",
        embeddingModel: "unused",
        debounceMs: 10,
        retryMs: 60_000,
        reconcileMs: 60_000,
        serviceFactory: () => service,
        ensureBackends: async () => {},
        releaseEmbeddingDevice: async () => {
          deviceReleases += 1;
        },
        disposeBackends: async () => {},
      });
    let daemon = createDaemon();
    let daemonRunning = false;

    try {
      await daemon.start();
      daemonRunning = true;
      await waitFor(() => service.refreshAttempts === 1);
      await waitFor(() => daemon.runtimes.get(fs.realpathSync(repository))?.state === "error");
      const initialRuntime = daemon.runtimes.get(fs.realpathSync(repository));
      expect(deviceReleases).toBe(1);
      expect(initialRuntime?.retryTimer).toBeUndefined();
      expect(initialRuntime?.resourceBlocked).toBe(true);
      expect(loadIndexedRepos(agentDir)[0]?.resourceFailure?.message).toContain("out of memory");

      fs.writeFileSync(path.join(repository, "index.ts"), "export const changed = true;\n");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(service.refreshAttempts).toBe(1);

      await daemon.stop();
      daemonRunning = false;
      daemon = createDaemon();
      await daemon.start();
      daemonRunning = true;
      const restartedRuntime = daemon.runtimes.get(fs.realpathSync(repository));
      expect(restartedRuntime?.resourceBlocked).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(service.refreshAttempts).toBe(1);

      service.recover();
      expect(new IndexingService(agentDir).prioritizeIndexing(repository)).toBe(true);
      await waitFor(() => service.refreshAttempts === 2);
      await waitFor(() => restartedRuntime?.state === "ready");
      expect(restartedRuntime?.resourceBlocked).toBe(false);
    } finally {
      if (daemonRunning) await daemon.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the resource block when persistence and device release fail", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-index-oom-cleanup-"));
    const agentDir = path.join(root, "agent");
    const repository = path.join(root, "repository");
    fs.mkdirSync(path.join(repository, ".git"), { recursive: true });
    enableIndexingForRepo(repository, agentDir);
    const service = new OutOfMemoryRagService(repository);
    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((message) => errors.push(String(message)));
    const daemon = new IndexingDaemon({
      agentDir,
      qdrantBinary: "unused",
      qdrantDataDirectory: path.join(agentDir, "qdrant"),
      pythonExecutable: "unused",
      embeddingModel: "unused",
      serviceFactory: () => service,
      ensureBackends: async () => {},
      persistResourceFailure: () => {
        throw new Error("registry is read-only");
      },
      releaseEmbeddingDevice: async () => {
        throw new Error("backend would not stop");
      },
      disposeBackends: async () => {},
    });

    try {
      await daemon.start();
      await waitFor(() => daemon.runtimes.get(fs.realpathSync(repository))?.state === "error");

      expect(daemon.runtimes.get(fs.realpathSync(repository))?.resourceBlocked).toBe(true);
      expect(errors.some((message) => message.includes("Failed to persist the indexing resource block"))).toBe(true);
      expect(errors.some((message) => message.includes("Failed to release the embedding device"))).toBe(true);
    } finally {
      await daemon.stop();
      errorSpy.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("schedules retries for non-resource errors without blocking automatic updates", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-index-network-err-"));
    const agentDir = path.join(root, "agent");
    const repository = path.join(root, "repository");
    fs.mkdirSync(path.join(repository, ".git"), { recursive: true });
    enableIndexingForRepo(repository, agentDir);

    let refreshAttempts = 0;
    const mockService: CodeRagService = {
      initialize: async () => ({
        state: "ready",
        workspaceRoot: repository,
        repoId: "r1",
        indexedFiles: 1,
        indexedChunks: 1,
        sparse: { exact: true, driftFileCount: 0 },
      }),
      status: async () => ({
        state: "ready",
        workspaceRoot: repository,
        repoId: "r1",
        indexedFiles: 1,
        indexedChunks: 1,
        sparse: { exact: true, driftFileCount: 0 },
      }),
      search: async (i) => ({
        query: i.query,
        workspaceRoot: repository,
        status: {
          state: "ready",
          workspaceRoot: repository,
          repoId: "r1",
          indexedFiles: 1,
          indexedChunks: 1,
          sparse: { exact: true, driftFileCount: 0 },
        },
        results: [],
        diagnostics: { durationMs: 0, truncated: false },
      }),
      refresh: async () => {
        refreshAttempts += 1;
        throw new Error("Temporary network timeout");
      },
      rebuild: async () => {
        throw new Error("Temporary network timeout");
      },
      dispose: async () => {},
    };

    const daemon = new IndexingDaemon({
      agentDir,
      qdrantBinary: "unused",
      qdrantDataDirectory: path.join(agentDir, "qdrant"),
      pythonExecutable: "unused",
      embeddingModel: "unused",
      debounceMs: 10,
      retryMs: 50,
      reconcileMs: 60_000,
      serviceFactory: () => mockService,
      ensureBackends: async () => {},
      releaseEmbeddingDevice: async () => {},
      disposeBackends: async () => {},
    });

    try {
      await daemon.start();
      await waitFor(() => refreshAttempts >= 1);
      const runtime = daemon.runtimes.get(fs.realpathSync(repository));
      await waitFor(() => runtime?.state === "error");

      expect(runtime?.resourceBlocked).toBe(false);
      expect(runtime?.consecutiveResourceFailureCount).toBe(0);
      expect(runtime?.retryTimer).toBeDefined();
    } finally {
      await daemon.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

async function waitFor(predicate: () => boolean, timeoutMs: number = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for indexing state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
