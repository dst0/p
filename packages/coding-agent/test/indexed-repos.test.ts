import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acknowledgeIndexingBackendWakeForRepo,
  acknowledgeIndexingPriorityForRepo,
  disableIndexingForRepo,
  enableIndexingForRepo,
  findIndexWorkspaceRoot,
  getIndexedReposPath,
  getRepoIndexingDecision,
  INDEXED_REPOS_SCHEMA_VERSION,
  loadIndexedRepos,
  prioritizeIndexingForRepo,
  recordIndexingResourceFailureForRepo,
  requestIndexingBackendForRepo,
  requestIndexingForRepo,
} from "../src/core/indexed-repos.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function createFixture(): { agentDir: string; repo: string; nested: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexed-repos-"));
  temporaryDirectories.push(root);
  const agentDir = path.join(root, "agent");
  const repo = path.join(root, "repo");
  const nested = path.join(repo, "src", "nested");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  fs.mkdirSync(nested, { recursive: true });
  return { agentDir, repo, nested };
}

describe("indexed repository decisions", () => {
  it("uses the git root and persists an explicit disabled decision", () => {
    const { agentDir, repo, nested } = createFixture();
    expect(findIndexWorkspaceRoot(nested)).toBe(fs.realpathSync(repo));
    expect(getRepoIndexingDecision(repo, agentDir)).toBe("unknown");

    disableIndexingForRepo(repo, agentDir);

    expect(getRepoIndexingDecision(nested, agentDir)).toBe("disabled");
    expect(loadIndexedRepos(agentDir)).toHaveLength(1);
    const stored = JSON.parse(fs.readFileSync(getIndexedReposPath(agentDir), "utf-8")) as {
      schemaVersion: number;
    };
    expect(stored.schemaVersion).toBe(INDEXED_REPOS_SCHEMA_VERSION);
  });

  it("replaces a disabled decision when indexing is enabled later", () => {
    const { agentDir, repo } = createFixture();
    disableIndexingForRepo(repo, agentDir);
    enableIndexingForRepo(repo, agentDir);

    expect(getRepoIndexingDecision(repo, agentDir)).toBe("enabled");
    expect(loadIndexedRepos(agentDir)).toHaveLength(1);
  });

  it("refreshes the request timestamp only for an enabled repository", () => {
    const { agentDir, repo } = createFixture();
    expect(requestIndexingForRepo(repo, agentDir)).toBeUndefined();

    const enabled = enableIndexingForRepo(repo, agentDir);
    const registryPath = getIndexedReposPath(agentDir);
    const stored = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as {
      schemaVersion: number;
      repos: Array<{ path: string; repoId: string; decision: "enabled"; updatedAt: string }>;
    };
    stored.repos[0].updatedAt = "2026-01-01T00:00:00.000Z";
    fs.writeFileSync(registryPath, `${JSON.stringify(stored, undefined, 2)}\n`);

    const requested = requestIndexingForRepo(repo, agentDir);
    expect(requested?.repoId).toBe(enabled.repoId);
    expect(requested?.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("persists and acknowledges a one-shot indexing priority request", () => {
    const { agentDir, repo } = createFixture();
    expect(prioritizeIndexingForRepo(repo, agentDir)).toBeUndefined();

    const enabled = enableIndexingForRepo(repo, agentDir);
    const prioritized = prioritizeIndexingForRepo(repo, agentDir);

    expect(prioritized?.updatedAt).toBe(enabled.updatedAt);
    expect(prioritized?.priorityRequest?.id).toBeTruthy();
    expect(prioritized?.priorityRequest?.requestedAt).toBeTruthy();
    expect(acknowledgeIndexingPriorityForRepo(repo, prioritized?.priorityRequest?.id ?? "", agentDir)).toBe(true);
    expect(loadIndexedRepos(agentDir)[0]?.priorityRequest).toBeUndefined();
    expect(acknowledgeIndexingPriorityForRepo(repo, prioritized?.priorityRequest?.id ?? "", agentDir)).toBe(false);
  });

  it("persists and acknowledges a backend wake without changing the refresh timestamp", () => {
    const { agentDir, repo } = createFixture();
    expect(requestIndexingBackendForRepo(repo, agentDir)).toBeUndefined();
    const enabled = enableIndexingForRepo(repo, agentDir);

    const requested = requestIndexingBackendForRepo(repo, agentDir);

    expect(requested?.updatedAt).toBe(enabled.updatedAt);
    expect(requested?.backendWakeRequest?.id).toBeTruthy();
    expect(acknowledgeIndexingBackendWakeForRepo(repo, "wrong-request", agentDir)).toBe(false);
    expect(acknowledgeIndexingBackendWakeForRepo(repo, requested?.backendWakeRequest?.id ?? "", agentDir)).toBe(true);
    expect(loadIndexedRepos(agentDir)[0]?.backendWakeRequest).toBeUndefined();
  });

  it("persists resource failures until a new explicit priority request", () => {
    const { agentDir, repo } = createFixture();
    expect(recordIndexingResourceFailureForRepo(repo, "out of memory", agentDir)).toBeUndefined();
    enableIndexingForRepo(repo, agentDir);
    expect(prioritizeIndexingForRepo(repo, agentDir)?.priorityRequest).toBeDefined();

    const failed = recordIndexingResourceFailureForRepo(repo, "out of memory", agentDir);

    expect(failed?.resourceFailure?.message).toBe("out of memory");
    expect(failed?.priorityRequest).toBeUndefined();
    expect(prioritizeIndexingForRepo(repo, agentDir)?.resourceFailure).toBeUndefined();
  });

  it("migrates a valid v2 registry to the current schema", () => {
    const { agentDir, repo } = createFixture();
    enableIndexingForRepo(repo, agentDir);
    const registryPath = getIndexedReposPath(agentDir);
    const stored = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as { schemaVersion: number };
    stored.schemaVersion = 2;
    fs.writeFileSync(registryPath, `${JSON.stringify(stored, undefined, 2)}\n`);

    expect(loadIndexedRepos(agentDir)).toHaveLength(1);

    const migrated = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as { schemaVersion: number };
    expect(migrated.schemaVersion).toBe(INDEXED_REPOS_SCHEMA_VERSION);
  });

  it("rejects malformed v3 data with missing resourceFailure string message", () => {
    const { agentDir, repo } = createFixture();
    enableIndexingForRepo(repo, agentDir);
    const registryPath = getIndexedReposPath(agentDir);
    const stored = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as {
      schemaVersion: number;
      repos: Array<{ resourceFailure?: { id: string; requestedAt: string; message?: string } }>;
    };
    stored.repos[0]!.resourceFailure = { id: "req-1", requestedAt: "2026-01-01T00:00:00.000Z" };
    fs.writeFileSync(registryPath, `${JSON.stringify(stored, undefined, 2)}\n`);

    expect(loadIndexedRepos(agentDir)).toEqual([]);
  });

  it("loads valid v3 data with a complete resourceFailure record", () => {
    const { agentDir, repo } = createFixture();
    enableIndexingForRepo(repo, agentDir);
    recordIndexingResourceFailureForRepo(repo, "OOM error", agentDir);

    const loaded = loadIndexedRepos(agentDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.resourceFailure?.message).toBe("OOM error");
  });

  it("uses a non-repository folder as its own indexing root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-index-folder-"));
    temporaryDirectories.push(root);
    expect(findIndexWorkspaceRoot(root)).toBe(fs.realpathSync(root));
  });

  it("ignores an empty .git marker in an ancestor directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-index-empty-marker-"));
    temporaryDirectories.push(root);
    const nested = path.join(root, "nested");
    fs.mkdirSync(path.join(root, ".git"));
    fs.mkdirSync(nested);

    expect(findIndexWorkspaceRoot(nested)).toBe(fs.realpathSync(nested));
  });

  it("rejects non-object or array JSON data structures in registry file", () => {
    const { agentDir } = createFixture();
    const registryPath = getIndexedReposPath(agentDir);
    fs.mkdirSync(agentDir, { recursive: true });

    fs.writeFileSync(registryPath, JSON.stringify([1, 2, 3]));
    expect(loadIndexedRepos(agentDir)).toEqual([]);

    fs.writeFileSync(registryPath, JSON.stringify("not an object"));
    expect(loadIndexedRepos(agentDir)).toEqual([]);
  });

  it("handles unindexed or disabled repos gracefully across all request helpers", () => {
    const { agentDir, repo } = createFixture();
    expect(requestIndexingBackendForRepo(repo, agentDir)).toBeUndefined();
    expect(prioritizeIndexingForRepo(repo, agentDir)).toBeUndefined();
    expect(recordIndexingResourceFailureForRepo(repo, "OOM", agentDir)).toBeUndefined();

    disableIndexingForRepo(repo, agentDir);
    expect(requestIndexingBackendForRepo(repo, agentDir)).toBeUndefined();
    expect(prioritizeIndexingForRepo(repo, agentDir)).toBeUndefined();
    expect(recordIndexingResourceFailureForRepo(repo, "OOM", agentDir)).toBeUndefined();
    expect(acknowledgeIndexingPriorityForRepo(repo, "any-id", agentDir)).toBe(false);
    expect(acknowledgeIndexingBackendWakeForRepo(repo, "any-id", agentDir)).toBe(false);
  });

  it("rejects malformed priorityRequest or backendWakeRequest in registry json", () => {
    const { agentDir, repo } = createFixture();
    enableIndexingForRepo(repo, agentDir);
    const registryPath = getIndexedReposPath(agentDir);

    const stored1 = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as {
      repos: Array<{ priorityRequest?: unknown }>;
    };
    stored1.repos[0]!.priorityRequest = { id: 123 }; // id not string
    fs.writeFileSync(registryPath, `${JSON.stringify(stored1, undefined, 2)}\n`);
    expect(loadIndexedRepos(agentDir)).toEqual([]);

    const stored2 = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as {
      repos: Array<{ backendWakeRequest?: unknown }>;
    };
    stored2.repos[0]!.backendWakeRequest = { id: "req-1", requestedAt: 123 }; // requestedAt not string
    fs.writeFileSync(registryPath, `${JSON.stringify(stored2, undefined, 2)}\n`);
    expect(loadIndexedRepos(agentDir)).toEqual([]);
  });
});
