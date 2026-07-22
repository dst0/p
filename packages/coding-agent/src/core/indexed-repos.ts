import { execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "../config.ts";

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
}

interface IndexedReposData {
	schemaVersion: number;
	repos: IndexedRepoEntry[];
}

export function getIndexedReposPath(agentDir: string = getAgentDir()): string {
	return path.join(agentDir, INDEXED_REPOS_FILE);
}

export function findIndexWorkspaceRoot(cwd: string): string {
	const canonicalCwd = canonicalizePath(cwd);
	let current = canonicalCwd;
	while (true) {
		if (fs.existsSync(path.join(current, ".git"))) return current;
		const parent = path.dirname(current);
		if (parent === current) return canonicalCwd;
		current = parent;
	}
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

export function getRepoIndexingDecision(cwd: string, agentDir: string = getAgentDir()): RepoIndexingDecision {
	const canonical = findIndexWorkspaceRoot(cwd);
	const repoId = computeRepoId(canonical);
	const entry = loadIndexedRepos(agentDir).find(
		(candidate) => canonicalizePath(candidate.path) === canonical || candidate.repoId === repoId,
	);
	return entry?.decision ?? "unknown";
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

export function requestIndexingForRepo(cwd: string, agentDir: string = getAgentDir()): IndexedRepoEntry | undefined {
	const canonical = findIndexWorkspaceRoot(cwd);
	const repoId = computeRepoId(canonical);
	const repos = loadIndexedRepos(agentDir);
	const index = repos.findIndex((entry) => canonicalizePath(entry.path) === canonical || entry.repoId === repoId);
	if (index < 0 || repos[index]?.decision !== "enabled") return undefined;
	const entry: IndexedRepoEntry = {
		...repos[index],
		path: canonical,
		repoId,
		updatedAt: new Date().toISOString(),
	};
	repos[index] = entry;
	saveIndexedRepos(repos, agentDir);
	return entry;
}

export function prioritizeIndexingForRepo(cwd: string, agentDir: string = getAgentDir()): IndexedRepoEntry | undefined {
	const canonical = findIndexWorkspaceRoot(cwd);
	const repoId = computeRepoId(canonical);
	const repos = loadIndexedRepos(agentDir);
	const index = repos.findIndex((entry) => canonicalizePath(entry.path) === canonical || entry.repoId === repoId);
	if (index < 0 || repos[index]?.decision !== "enabled") return undefined;
	const requestedAt = new Date().toISOString();
	const entry: IndexedRepoEntry = {
		...repos[index],
		path: canonical,
		repoId,
		priorityRequest: { id: randomUUID(), requestedAt },
	};
	repos[index] = entry;
	saveIndexedRepos(repos, agentDir);
	return entry;
}

export function acknowledgeIndexingPriorityForRepo(
	cwd: string,
	requestId: string,
	agentDir: string = getAgentDir(),
): boolean {
	const canonical = findIndexWorkspaceRoot(cwd);
	const repoId = computeRepoId(canonical);
	const repos = loadIndexedRepos(agentDir);
	const index = repos.findIndex((entry) => canonicalizePath(entry.path) === canonical || entry.repoId === repoId);
	const existing = repos[index];
	if (!existing || existing.priorityRequest?.id !== requestId) return false;
	const entry: IndexedRepoEntry = {
		path: existing.path,
		repoId: existing.repoId,
		decision: existing.decision,
		updatedAt: existing.updatedAt,
	};
	repos[index] = entry;
	saveIndexedRepos(repos, agentDir);
	return true;
}

export function disableIndexingForRepo(cwd: string, agentDir: string = getAgentDir()): IndexedRepoEntry {
	return setRepoIndexingDecision(cwd, "disabled", agentDir);
}

function canonicalizePath(value: string): string {
	const resolved = path.resolve(value);
	try {
		return fs.realpathSync(resolved);
	} catch {
		return resolved;
	}
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
				(entry.priorityRequest === undefined ||
					(typeof entry.priorityRequest === "object" &&
						entry.priorityRequest !== null &&
						typeof entry.priorityRequest.id === "string" &&
						typeof entry.priorityRequest.requestedAt === "string")),
		)
	);
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
