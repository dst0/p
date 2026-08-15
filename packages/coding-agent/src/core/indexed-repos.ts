import { execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "../config.ts";
import { canonicalizePath, findWorkspaceRoot } from "./workspace-root.ts";

export const INDEXED_REPOS_FILE = "indexed-repos.json";
export const INDEXED_REPOS_SCHEMA_VERSION = 3;

export type RepoIndexingDecision = "enabled" | "disabled" | "unknown";

export interface IndexedRepoEntry {
  path: string;
  repoId: string;
  decision: Exclude<RepoIndexingDecision, "unknown">;
  updatedAt: string;
  priorityRequest?: {
    id: string;
    requestedAt: string;
  };
  backendWakeRequest?: {
    id: string;
    requestedAt: string;
  };
  resourceFailure?: {
    id: string;
    requestedAt: string;
    message: string;
  };
}

interface IndexedReposData {
  schemaVersion: number;
  repos: IndexedRepoEntry[];
}

export function getIndexedReposPath(agentDir: string = getAgentDir()): string {
  return path.join(agentDir, INDEXED_REPOS_FILE);
}

export function findIndexWorkspaceRoot(cwd: string): string {
  return findWorkspaceRoot(cwd);
}

export function loadIndexedRepos(agentDir: string = getAgentDir()): IndexedRepoEntry[] {
  const filePath = getIndexedReposPath(agentDir);
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (isIndexedReposData(parsed)) return parsed.repos;
    if (isV1IndexedReposData(parsed)) {
      // Migrate v1 -> v3: recompute repoId with git remote.
      const migrated = parsed.repos.map((entry) => ({
        ...entry,
        repoId: computeRepoId(entry.path),
      }));
      saveIndexedRepos(migrated, agentDir);
      return migrated;
    }
    if (isV2IndexedReposData(parsed)) {
      saveIndexedRepos(parsed.repos, agentDir);
      return parsed.repos;
    }
    return [];
  } catch {
    return [];
  }
}

function findEntry(
  cwd: string,
  agentDir: string,
): { repos: IndexedRepoEntry[]; index: number; entry?: IndexedRepoEntry } {
  const canonical = findIndexWorkspaceRoot(cwd);
  const repoId = computeRepoId(canonical);
  const repos = loadIndexedRepos(agentDir);
  const index = repos.findIndex((entry) => canonicalizePath(entry.path) === canonical || entry.repoId === repoId);
  return { repos, index, entry: repos[index] };
}

export function getRepoIndexingDecision(cwd: string, agentDir: string = getAgentDir()): RepoIndexingDecision {
  return findEntry(cwd, agentDir).entry?.decision ?? "unknown";
}

export function setRepoIndexingDecision(
  cwd: string,
  decision: Exclude<RepoIndexingDecision, "unknown">,
  agentDir: string = getAgentDir(),
): IndexedRepoEntry {
  const canonical = findIndexWorkspaceRoot(cwd);
  const repoId = computeRepoId(canonical);
  const repos = loadIndexedRepos(agentDir).filter(
    (entry) => canonicalizePath(entry.path) !== canonical && entry.repoId !== repoId,
  );
  const entry: IndexedRepoEntry = {
    path: canonical,
    repoId,
    decision,
    updatedAt: new Date().toISOString(),
  };
  repos.push(entry);
  saveIndexedRepos(repos, agentDir);
  return entry;
}

export function isRepoIndexed(cwd: string, agentDir: string = getAgentDir()): boolean {
  return getRepoIndexingDecision(cwd, agentDir) === "enabled";
}

export function enableIndexingForRepo(cwd: string, agentDir: string = getAgentDir()): IndexedRepoEntry {
  return setRepoIndexingDecision(cwd, "enabled", agentDir);
}

function mutateRepoEntry(
  cwd: string,
  agentDir: string,
  mutate: (entry: IndexedRepoEntry) => IndexedRepoEntry,
): IndexedRepoEntry | undefined {
  const { repos, index, entry } = findEntry(cwd, agentDir);
  if (index < 0 || !entry || entry.decision !== "enabled") return undefined;
  const updated = mutate(entry);
  repos[index] = updated;
  saveIndexedRepos(repos, agentDir);
  return updated;
}

function clearField(
  cwd: string,
  agentDir: string,
  predicate: (entry: IndexedRepoEntry) => boolean,
  clear: (entry: IndexedRepoEntry) => IndexedRepoEntry,
): boolean {
  const { repos, index, entry } = findEntry(cwd, agentDir);
  if (index < 0 || !entry || !predicate(entry)) return false;
  repos[index] = clear(entry);
  saveIndexedRepos(repos, agentDir);
  return true;
}

export function requestIndexingForRepo(cwd: string, agentDir: string = getAgentDir()): IndexedRepoEntry | undefined {
  return mutateRepoEntry(cwd, agentDir, (entry) => ({ ...entry, updatedAt: new Date().toISOString() }));
}

export function prioritizeIndexingForRepo(cwd: string, agentDir: string = getAgentDir()): IndexedRepoEntry | undefined {
  return mutateRepoEntry(cwd, agentDir, (entry) => ({
    ...entry,
    resourceFailure: undefined,
    priorityRequest: { id: randomUUID(), requestedAt: new Date().toISOString() },
  }));
}

export function acknowledgeIndexingPriorityForRepo(
  cwd: string,
  requestId: string,
  agentDir: string = getAgentDir(),
): boolean {
  return clearField(
    cwd,
    agentDir,
    (entry) => entry.priorityRequest?.id === requestId,
    (entry) => ({ ...entry, priorityRequest: undefined }),
  );
}

export function disableIndexingForRepo(cwd: string, agentDir: string = getAgentDir()): IndexedRepoEntry {
  return setRepoIndexingDecision(cwd, "disabled", agentDir);
}

export function requestIndexingBackendForRepo(
  cwd: string,
  agentDir: string = getAgentDir(),
): IndexedRepoEntry | undefined {
  return mutateRepoEntry(cwd, agentDir, (entry) => ({
    ...entry,
    backendWakeRequest: { id: randomUUID(), requestedAt: new Date().toISOString() },
  }));
}

export function acknowledgeIndexingBackendWakeForRepo(
  cwd: string,
  requestId: string,
  agentDir: string = getAgentDir(),
): boolean {
  return clearField(
    cwd,
    agentDir,
    (entry) => entry.backendWakeRequest?.id === requestId,
    (entry) => ({ ...entry, backendWakeRequest: undefined }),
  );
}

export function recordIndexingResourceFailureForRepo(
  cwd: string,
  message: string,
  agentDir: string = getAgentDir(),
): IndexedRepoEntry | undefined {
  return mutateRepoEntry(cwd, agentDir, (entry) => ({
    ...entry,
    priorityRequest: undefined,
    resourceFailure: { id: randomUUID(), requestedAt: new Date().toISOString(), message },
  }));
}

function computeRepoId(repoPath: string): string {
  const remote = getGitRemote(repoPath);
  return createHash("sha256").update(`${repoPath}\0${remote}`).digest("hex");
}

function getGitRemote(repoPath: string): string {
  try {
    return execSync("git remote get-url origin", {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function saveIndexedRepos(repos: IndexedRepoEntry[], agentDir: string): void {
  fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const filePath = getIndexedReposPath(agentDir);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify({ schemaVersion: INDEXED_REPOS_SCHEMA_VERSION, repos }, undefined, 2)}\n`,
    { mode: 0o600 },
  );
  fs.renameSync(temporaryPath, filePath);
}

function isIndexedReposData(value: unknown): value is IndexedReposData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<IndexedReposData>;
  return (
    candidate.schemaVersion === INDEXED_REPOS_SCHEMA_VERSION &&
    Array.isArray(candidate.repos) &&
    candidate.repos.every(
      (entry) =>
        isIndexedRepoEntry(entry) &&
        isRegistryRequest(entry.priorityRequest) &&
        isRegistryRequest(entry.backendWakeRequest) &&
        isResourceFailure(entry.resourceFailure),
    )
  );
}

function isRegistryRequest(value: unknown): boolean {
  if (value === undefined) return true;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "requestedAt") === "string"
  );
}

function isResourceFailure(value: unknown): boolean {
  if (value === undefined) return true;
  return isRegistryRequest(value) && typeof Reflect.get(value as object, "message") === "string";
}

function isV2IndexedReposData(value: unknown): value is IndexedReposData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<IndexedReposData>;
  return candidate.schemaVersion === 2 && Array.isArray(candidate.repos) && candidate.repos.every(isIndexedRepoEntry);
}

function isV1IndexedReposData(value: unknown): value is IndexedReposData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<IndexedReposData>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.repos) && candidate.repos.every(isIndexedRepoEntry);
}

function isIndexedRepoEntry(entry: unknown): entry is IndexedRepoEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const candidate = entry as Partial<IndexedRepoEntry>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.repoId === "string" &&
    (candidate.decision === "enabled" || candidate.decision === "disabled") &&
    typeof candidate.updatedAt === "string"
  );
}
