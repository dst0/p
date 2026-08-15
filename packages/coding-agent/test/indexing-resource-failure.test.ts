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
import { describe, expect, it } from "vitest";
import {
  acknowledgeIndexingBackendWakeForRepo,
  acknowledgeIndexingPriorityForRepo,
  enableIndexingForRepo,
  loadIndexedRepos,
  prioritizeIndexingForRepo,
  recordIndexingResourceFailureForRepo,
  requestIndexingBackendForRepo,
} from "../src/core/indexed-repos.ts";
import { IndexingDaemon, type IndexingDaemonOptions } from "../src/core/indexing-daemon.ts";
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
      repoId: "oom-repo",
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

function createTestDaemon(
  agentDir: string,
  service: CodeRagService,
  overrides: Partial<IndexingDaemonOptions> = {},
): IndexingDaemon {
  return new IndexingDaemon({
    agentDir,
    qdrantBinary: "unused",
    qdrantDataDirectory: path.join(agentDir, "qdrant"),
    pythonExecutable: "unused",
    embeddingModel: "unused",
    debounceMs: 10,
    retryMs: 50,
    reconcileMs: 20,
    serviceFactory: () => service,
    ensureBackends: async () => {},
    releaseEmbeddingDevice: async () => {},
    disposeBackends: async () => {},
    ...overrides,
  });
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
    const notifications: Array<{ title: string; message: string }> = [];
    const createDaemon = () =>
      createTestDaemon(agentDir, service, {
        releaseEmbeddingDevice: async () => {
          deviceReleases += 1;
        },
        sendSystemNotification: (notification) => {
          notifications.push(notification);
        },
      });

    let daemon = createDaemon();
    const serviceClient = new IndexingService(agentDir);

    try {
      await daemon.start();
      const canonical = fs.realpathSync(repository);
      await waitFor(() => service.refreshAttempts >= 1);
      const runtime = daemon.runtimes.get(canonical);
      await waitFor(() => runtime?.state === "error");

      expect(runtime?.resourceBlocked).toBe(true);
      expect(runtime?.consecutiveResourceFailureCount).toBe(1);
      expect(runtime?.retryTimer).toBeUndefined();
      expect(deviceReleases).toBeGreaterThanOrEqual(1);
      expect(notifications).toEqual([
        {
          title: "p Indexing Resource Failure",
          message: "Indexing paused for repository: MPS backend out of memory at batch size 1. Run /index up to retry.",
        },
      ]);

      const initialAttempts = service.refreshAttempts;
      fs.writeFileSync(path.join(repository, "index.ts"), "export const changed = true;\n");
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(service.refreshAttempts).toBe(initialAttempts);

      await daemon.stop();
      daemon = createDaemon();
      await daemon.start();
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(service.refreshAttempts).toBe(initialAttempts);

      service.recover();
      serviceClient.prioritizeIndexing(repository);
      await waitFor(() => daemon.runtimes.get(canonical)?.state === "ready");

      const refreshedRuntime = daemon.runtimes.get(canonical);
      expect(refreshedRuntime?.resourceBlocked).toBe(false);
      expect(refreshedRuntime?.consecutiveResourceFailureCount).toBe(0);
      expect(refreshedRuntime?.lastError).toBeUndefined();
    } finally {
      await daemon.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("handles multiple consecutive resource failures with quadratic backoff", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-index-consecutive-"));
    const agentDir = path.join(root, "agent");
    const repository = path.join(root, "repository");
    fs.mkdirSync(path.join(repository, ".git"), { recursive: true });
    enableIndexingForRepo(repository, agentDir);
    const service = new OutOfMemoryRagService(repository);
    const serviceClient = new IndexingService(agentDir);
    const daemon = createTestDaemon(agentDir, service);

    try {
      await daemon.start();
      const canonical = fs.realpathSync(repository);
      await waitFor(() => service.refreshAttempts >= 1);
      const runtime = daemon.runtimes.get(canonical);
      await waitFor(() => runtime?.state === "error" && runtime.consecutiveResourceFailureCount === 1);

      expect(runtime?.resourceBlocked).toBe(true);

      serviceClient.prioritizeIndexing(repository);
      await waitFor(() => service.refreshAttempts >= 2);
      await waitFor(() => runtime?.state === "error" && runtime.consecutiveResourceFailureCount === 1);

      expect(runtime?.resourceBlocked).toBe(true);
    } finally {
      await daemon.stop();
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
    const statusResult: RagStatus = {
      state: "ready",
      workspaceRoot: repository,
      repoId: "r1",
      indexedFiles: 1,
      indexedChunks: 1,
      sparse: { exact: true, driftFileCount: 0 },
    };
    const mockService: CodeRagService = {
      initialize: async () => statusResult,
      status: async () => statusResult,
      search: async (i) => ({
        query: i.query,
        workspaceRoot: repository,
        status: statusResult,
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

    const daemon = createTestDaemon(agentDir, mockService);

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

  it("transitions registry state across resource failure, backend wake, and manual priority requests", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-reg-transitions-"));
    const agentDir = path.join(root, "agent");
    const repo = path.join(root, "repo");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    try {
      enableIndexingForRepo(repo, agentDir);
      const failed = recordIndexingResourceFailureForRepo(repo, "GPU memory exhausted", agentDir);
      expect(failed?.resourceFailure?.message).toBe("GPU memory exhausted");

      const wake = requestIndexingBackendForRepo(repo, agentDir);
      expect(wake?.backendWakeRequest?.id).toBeDefined();
      expect(acknowledgeIndexingBackendWakeForRepo(repo, wake!.backendWakeRequest!.id, agentDir)).toBe(true);

      const prio = prioritizeIndexingForRepo(repo, agentDir);
      expect(prio?.resourceFailure).toBeUndefined();
      expect(prio?.priorityRequest?.id).toBeDefined();
      expect(acknowledgeIndexingPriorityForRepo(repo, prio!.priorityRequest!.id, agentDir)).toBe(true);
      expect(loadIndexedRepos(agentDir)[0]?.priorityRequest).toBeUndefined();
    } finally {
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
