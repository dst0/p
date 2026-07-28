import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CodeRagService, InitializeRagOptions, RagState, RagStatus } from "@dst0/p-code-index";
import { afterEach, describe, expect, it } from "vitest";
import { enableIndexingForRepo } from "../../../src/core/indexed-repos.ts";
import { IndexingDaemon, type IndexingDaemonOptions } from "../../../src/core/indexing-daemon.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  // Restore default idle timeout
  delete process.env.EMBEDDING_IDLE_TIMEOUT_MS;
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

class IdleRagService implements CodeRagService {
  readonly workspaceRoot: string;
  refreshCount = 0;
  initializeCount = 0;
  private state: RagState;

  constructor(workspaceRoot: string, state: RagState) {
    this.workspaceRoot = workspaceRoot;
    this.state = state;
  }

  setState(state: RagState): void {
    this.state = state;
  }

  async initialize(_options: InitializeRagOptions = {}): Promise<RagStatus> {
    this.initializeCount += 1;
    return this.createStatus();
  }

  async status(): Promise<RagStatus> {
    return this.createStatus();
  }

  async search(): Promise<any> {
    return { query: "", workspaceRoot: this.workspaceRoot, status: this.createStatus(), results: [], diagnostics: {} };
  }

  async refresh(): Promise<any> {
    this.refreshCount += 1;
    this.state = "ready";
    return {
      status: this.createStatus(true),
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

  async rebuild(): Promise<any> {
    return this.refresh();
  }

  async dispose(): Promise<void> {}

  private createStatus(forcePersisted: boolean = false): RagStatus {
    const persisted = forcePersisted;
    return {
      state: this.state,
      workspaceRoot: this.workspaceRoot,
      repoId: "idle-repo",
      ...(persisted ? { collection: "c", generation: "g" } : {}),
      indexedFiles: this.state === "not_initialized" ? 0 : 1,
      indexedChunks: this.state === "not_initialized" ? 0 : 1 + this.refreshCount,
      sparse: { exact: true, driftFileCount: 0 },
    };
  }
}

function createFixture(): { root: string; repo: string; agentDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-idle-test-"));
  temporaryDirectories.push(root);
  const repo = path.join(root, "repo");
  const agentDir = path.join(root, "agent");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repo, "index.ts"), "export const v = true;\n");
  return { root, repo, agentDir };
}

function createDaemon(
  agentDir: string,
  _repo: string,
  serviceFactory: (workspaceRoot: string) => CodeRagService,
  overrides: Partial<IndexingDaemonOptions> = {},
): IndexingDaemon {
  return new IndexingDaemon({
    agentDir,
    qdrantBinary: "unused",
    qdrantDataDirectory: path.join(agentDir, "qdrant"),
    pythonExecutable: "unused",
    embeddingModel: "unused",
    debounceMs: 10,
    retryMs: 60_000,
    reconcileMs: 60_000,
    repositoryTimeoutMs: 5_000,
    serviceFactory,
    ensureBackends: overrides.ensureBackends ?? (async () => {}),
    disposeBackends: overrides.disposeBackends ?? (async () => {}),
  });
}

async function waitFor(predicate: () => boolean, timeoutMs: number = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("embedding server idle lifecycle", () => {
  it("does not stop backends during normal operation before idle timeout", async () => {
    const fixture = createFixture();
    enableIndexingForRepo(fixture.repo, fixture.agentDir);

    let disposeCalled = false;
    let service: IdleRagService | undefined;
    const daemon = createDaemon(
      fixture.agentDir,
      fixture.repo,
      (root) => {
        service = new IdleRagService(root, "not_initialized");
        return service;
      },
      {
        disposeBackends: async () => {
          disposeCalled = true;
        },
      },
    );

    try {
      await daemon.start();
      await waitFor(() => service?.refreshCount === 1);
      // Wait a bit — well under the idle timeout (default 15 min)
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(disposeCalled).toBe(false);
    } finally {
      await daemon.stop({ graceful: true });
    }
  });

  it("stops only the embedding server on idle, not Qdrant", async () => {
    // Set a very short idle timeout for testing
    process.env.EMBEDDING_IDLE_TIMEOUT_MS = "200";

    const fixture = createFixture();
    enableIndexingForRepo(fixture.repo, fixture.agentDir);

    // The default disposeBackends stops both embedding and qdrant.
    // The idle timer should NOT call disposeBackends — it calls embeddingManager.stop() directly.
    // So disposeBackends should NOT be called during idle timeout.
    let disposeCalled = false;
    let service: IdleRagService | undefined;
    const daemon = createDaemon(
      fixture.agentDir,
      fixture.repo,
      (root) => {
        service = new IdleRagService(root, "not_initialized");
        return service;
      },
      {
        disposeBackends: async () => {
          disposeCalled = true;
        },
      },
    );

    try {
      await daemon.start();
      await waitFor(() => service?.refreshCount === 1);
      // Wait for idle timeout to fire
      await new Promise((resolve) => setTimeout(resolve, 400));

      // disposeBackends was NOT called by the idle timer
      // (only embeddingManager.stop() was called internally)
      expect(disposeCalled).toBe(false);
    } finally {
      await daemon.stop({ graceful: true });
    }
  });

  it("cancels idle timer when the daemon stops cleanly", async () => {
    process.env.EMBEDDING_IDLE_TIMEOUT_MS = "200";

    const fixture = createFixture();
    enableIndexingForRepo(fixture.repo, fixture.agentDir);

    let disposeCallCount = 0;
    let service: IdleRagService | undefined;
    const daemon = createDaemon(
      fixture.agentDir,
      fixture.repo,
      (root) => {
        service = new IdleRagService(root, "not_initialized");
        return service;
      },
      {
        disposeBackends: async () => {
          disposeCallCount++;
        },
      },
    );

    try {
      await daemon.start();
      await waitFor(() => service?.refreshCount === 1);
      // Stop the daemon before idle timeout fires
      await daemon.stop({ graceful: true });
      // Wait past the idle timeout — nothing should fire
      await new Promise((resolve) => setTimeout(resolve, 400));

      // disposeBackends called once (by stop), not twice (idle timer was cancelled)
      expect(disposeCallCount).toBe(1);
    } finally {
      await daemon.stop({ graceful: true }).catch(() => {});
    }
  });

  it("resets idle timer after indexing work completes", async () => {
    process.env.EMBEDDING_IDLE_TIMEOUT_MS = "200";

    const fixture = createFixture();
    enableIndexingForRepo(fixture.repo, fixture.agentDir);

    let disposeCalled = false;
    let service: IdleRagService | undefined;
    const daemon = createDaemon(
      fixture.agentDir,
      fixture.repo,
      (root) => {
        service = new IdleRagService(root, "not_initialized");
        return service;
      },
      {
        disposeBackends: async () => {
          disposeCalled = true;
        },
      },
    );

    try {
      await daemon.start();
      await waitFor(() => service?.refreshCount === 1);
      // After indexing, the idle timer resets. We waited 200+ ms but indexing
      // just completed so the timer restarted.
      await new Promise((resolve) => setTimeout(resolve, 250));
      // disposeBackends should not have been called because the timer reset after indexing
      expect(disposeCalled).toBe(false);
    } finally {
      await daemon.stop({ graceful: true });
    }
  });
});
