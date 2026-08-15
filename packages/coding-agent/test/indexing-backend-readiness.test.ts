import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CodeRagService, RagStatus } from "@dst0/p-code-index";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  disableIndexingForRepo,
  enableIndexingForRepo,
  getIndexedReposPath,
  loadIndexedRepos,
  requestIndexingBackendForRepo,
} from "../src/core/indexed-repos.ts";
import { waitForIndexingEmbeddingBackend } from "../src/core/indexing-backend-readiness.ts";
import { IndexingDaemon } from "../src/core/indexing-daemon.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function createFixture(searchMode: "hybrid" | "bm25-only" = "hybrid") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-index-backend-ready-"));
  temporaryDirectories.push(root);
  const agentDir = path.join(root, "agent");
  const repository = path.join(root, "repository");
  fs.mkdirSync(path.join(repository, ".git"), { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "code-rag.json"),
    `${JSON.stringify({ embeddingDevice: "mps", searchMode, embeddingStartupTimeoutMs: 100 })}\n`,
  );
  enableIndexingForRepo(repository, agentDir);
  const registryPath = getIndexedReposPath(agentDir);
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")) as { repos: Array<{ updatedAt: string }> };
  registry.repos[0]!.updatedAt = "2000-01-01T00:00:00.000Z";
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, undefined, 2)}\n`);
  return { agentDir, repository };
}

function readyResponse(): Response {
  return new Response(
    JSON.stringify({
      status: "ready",
      requestedBackend: "mps",
      selectedBackend: "mps",
      fallbackOccurred: false,
    }),
    { status: 200 },
  );
}

describe("indexing embedding backend readiness", () => {
  it("wakes the daemon without scheduling a repository refresh", async () => {
    const fixture = createFixture();
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:18742"))
      .mockRejectedValueOnce(new Error("embedding backend is still starting"))
      .mockResolvedValue(readyResponse());

    await waitForIndexingEmbeddingBackend(fixture.repository, undefined, {
      agentDir: fixture.agentDir,
      fetchImplementation,
      pollMs: 1,
      timeoutMs: 100,
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(loadIndexedRepos(fixture.agentDir)[0]?.updatedAt).toBe("2000-01-01T00:00:00.000Z");
  });

  it("starts an idle backend without refreshing an already-ready repository", async () => {
    const fixture = createFixture();
    const status: RagStatus = {
      state: "ready",
      workspaceRoot: fixture.repository,
      repoId: "ready-repository",
      collection: "ready-collection",
      generation: "ready-generation",
      indexedFiles: 1,
      indexedChunks: 1,
      sparse: { exact: true, driftFileCount: 0 },
    };
    let backendStarts = 0;
    let refreshCount = 0;
    const service: CodeRagService = {
      initialize: async () => status,
      status: async () => status,
      search: async (input) => ({
        query: input.query,
        workspaceRoot: fixture.repository,
        status,
        results: [],
        diagnostics: { durationMs: 0, truncated: false },
      }),
      refresh: async () => {
        refreshCount += 1;
        throw new Error("Unexpected repository refresh");
      },
      rebuild: async () => {
        throw new Error("Unexpected repository rebuild");
      },
      dispose: async () => {},
    };
    const daemon = new IndexingDaemon({
      agentDir: fixture.agentDir,
      qdrantBinary: "unused",
      qdrantDataDirectory: path.join(fixture.agentDir, "qdrant"),
      pythonExecutable: "unused",
      embeddingModel: "unused",
      serviceFactory: () => service,
      ensureBackends: async () => {
        backendStarts += 1;
      },
      disposeBackends: async () => {},
    });
    expect(requestIndexingBackendForRepo(fixture.repository, fixture.agentDir)).toBeDefined();

    try {
      await daemon.start();
      await waitFor(() => backendStarts === 1);
      expect(loadIndexedRepos(fixture.agentDir)[0]?.backendWakeRequest).toBeUndefined();
      backendStarts = 0;
      expect(requestIndexingBackendForRepo(fixture.repository, fixture.agentDir)).toBeDefined();
      await daemon.syncRegistry();
      await waitFor(() => backendStarts === 1);

      expect(refreshCount).toBe(0);
      expect(loadIndexedRepos(fixture.agentDir)[0]?.backendWakeRequest).toBeUndefined();
      expect(loadIndexedRepos(fixture.agentDir)[0]?.updatedAt).toBe("2000-01-01T00:00:00.000Z");
    } finally {
      await daemon.stop();
    }
  });

  it("fails when the daemon does not resume before the configured deadline", async () => {
    const fixture = createFixture();
    const fetchImplementation = vi.fn<typeof fetch>().mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(
      waitForIndexingEmbeddingBackend(fixture.repository, undefined, {
        agentDir: fixture.agentDir,
        fetchImplementation,
        timeoutMs: 0,
      }),
    ).rejects.toThrow("Timed out waiting for the indexing daemon to resume its embedding backend");
  });

  it("does not wake the daemon for a disabled repository", async () => {
    const fixture = createFixture();
    disableIndexingForRepo(fixture.repository, fixture.agentDir);
    const fetchImplementation = vi.fn<typeof fetch>().mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(
      waitForIndexingEmbeddingBackend(fixture.repository, undefined, {
        agentDir: fixture.agentDir,
        fetchImplementation,
      }),
    ).rejects.toThrow("Code indexing is not enabled for this repository");
  });

  it("rejects a ready backend running on a different device", async () => {
    const fixture = createFixture();
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ready",
          requestedBackend: "mps",
          selectedBackend: "cpu",
          fallbackOccurred: false,
        }),
        { status: 200 },
      ),
    );

    await expect(
      waitForIndexingEmbeddingBackend(fixture.repository, undefined, {
        agentDir: fixture.agentDir,
        fetchImplementation,
      }),
    ).rejects.toThrow("Configured embedding backend mps did not resume on the requested device");
  });

  it("does not wake the daemon when the configured backend is already ready", async () => {
    const fixture = createFixture();
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(readyResponse());

    await waitForIndexingEmbeddingBackend(fixture.repository, undefined, {
      agentDir: fixture.agentDir,
      fetchImplementation,
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(loadIndexedRepos(fixture.agentDir)[0]?.updatedAt).toBe("2000-01-01T00:00:00.000Z");
  });

  it("does not require an embedding process in BM25-only mode", async () => {
    const fixture = createFixture("bm25-only");
    const fetchImplementation = vi.fn<typeof fetch>();

    await waitForIndexingEmbeddingBackend(fixture.repository, undefined, {
      agentDir: fixture.agentDir,
      fetchImplementation,
    });

    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for indexing state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
