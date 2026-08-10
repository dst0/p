import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enableIndexingForRepo, getIndexedReposPath, loadIndexedRepos } from "../src/core/indexed-repos.ts";
import { waitForIndexingEmbeddingBackend } from "../src/core/indexing-backend-readiness.ts";

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
  it("wakes the daemon and lets the first request continue after idle shutdown", async () => {
    const fixture = createFixture();
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:18742"))
      .mockResolvedValue(readyResponse());

    await waitForIndexingEmbeddingBackend(fixture.repository, undefined, {
      agentDir: fixture.agentDir,
      fetchImplementation,
      pollMs: 1,
      timeoutMs: 100,
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(loadIndexedRepos(fixture.agentDir)[0]?.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
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
