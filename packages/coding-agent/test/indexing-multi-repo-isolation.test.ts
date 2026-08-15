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
import { afterEach, describe, expect, it } from "vitest";
import { enableIndexingForRepo, loadIndexedRepos } from "../src/core/indexed-repos.ts";
import { IndexingDaemon } from "../src/core/indexing-daemon.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

class MockRepoService implements CodeRagService {
  refreshCount = 0;
  readonly workspaceRoot: string;
  readonly failWithOom: boolean;

  constructor(workspaceRoot: string, failWithOom: boolean = false) {
    this.workspaceRoot = workspaceRoot;
    this.failWithOom = failWithOom;
  }

  async initialize(): Promise<RagStatus> {
    return {
      state: "not_initialized",
      workspaceRoot: this.workspaceRoot,
      repoId: path.basename(this.workspaceRoot),
      indexedFiles: 0,
      indexedChunks: 0,
      sparse: { exact: false, driftFileCount: 1 },
    };
  }

  async status(): Promise<RagStatus> {
    return {
      state: "ready",
      workspaceRoot: this.workspaceRoot,
      repoId: path.basename(this.workspaceRoot),
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
    this.refreshCount += 1;
    if (this.failWithOom) {
      throw new Error("backend process terminated with exit code 137 (SIGKILL / OOM)");
    }
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

describe("multi-repo isolation and hard crash recovery", () => {
  it("does not wake or retry a resource-failed repo when an adjacent repo triggers daemon activity", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-index-multi-"));
    temporaryDirectories.push(root);
    const agentDir = path.join(root, "agent");
    const repoA = path.join(root, "repoA");
    const repoB = path.join(root, "repoB");
    fs.mkdirSync(path.join(repoA, ".git"), { recursive: true });
    fs.mkdirSync(path.join(repoB, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repoA, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(repoB, "b.ts"), "export const b = 1;\n");

    enableIndexingForRepo(repoA, agentDir);
    enableIndexingForRepo(repoB, agentDir);

    const serviceA = new MockRepoService(repoA, true); // Fails with OOM (exit code 137)
    const serviceB = new MockRepoService(repoB, false); // Normal repo
    const notifications: Array<{ title: string; message: string }> = [];

    const daemon = new IndexingDaemon({
      agentDir,
      qdrantBinary: "unused",
      qdrantDataDirectory: path.join(agentDir, "qdrant"),
      pythonExecutable: "unused",
      embeddingModel: "unused",
      debounceMs: 10,
      retryMs: 50,
      serviceFactory: (wsRoot) => (fs.realpathSync(wsRoot) === fs.realpathSync(repoA) ? serviceA : serviceB),
      ensureBackends: async () => {},
      sendSystemNotification: (opts) => notifications.push(opts),
      releaseEmbeddingDevice: async () => {},
      disposeBackends: async () => {},
    });

    try {
      await daemon.start();
      await waitFor(() => serviceA.refreshCount === 1);
      await waitFor(() => serviceB.refreshCount === 1);

      const canonicalA = fs.realpathSync(repoA);
      const canonicalB = fs.realpathSync(repoB);
      await waitFor(() => daemon.runtimes.get(canonicalA)?.state === "error");
      await waitFor(() => daemon.runtimes.get(canonicalB)?.state === "ready");

      expect(daemon.runtimes.get(canonicalA)?.resourceBlocked).toBe(true);
      expect(notifications.length).toBeGreaterThanOrEqual(1);
      expect(notifications[0]?.title).toBe("p Indexing Resource Failure");

      // Now trigger file change events in Repo B multiple times
      for (let i = 0; i < 3; i++) {
        fs.writeFileSync(path.join(repoB, "b.ts"), `export const b = ${i + 2};\n`);
        daemon.requestRefresh(daemon.runtimes.get(canonicalB)!, false);
      }

      await waitFor(() => serviceB.refreshCount >= 4);

      // Invariant: Repo A must remain strictly blocked, refreshCount must NOT increase
      expect(serviceA.refreshCount).toBe(1);
      expect(daemon.runtimes.get(canonicalA)?.state).toBe("error");
      expect(daemon.runtimes.get(canonicalA)?.resourceBlocked).toBe(true);
      expect(loadIndexedRepos(agentDir).find((r) => r.path === canonicalA)?.resourceFailure).toBeDefined();
    } finally {
      await daemon.stop();
    }
  });
});

async function waitFor(predicate: () => boolean, timeoutMs: number = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for state condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
