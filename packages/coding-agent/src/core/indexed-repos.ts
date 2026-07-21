import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "../config.ts";

export const INDEXED_REPOS_FILE = "indexed-repos.json";
export const INDEXED_REPOS_SCHEMA_VERSION = 2;

export type RepoIndexingDecision = "enabled" | "disabled" | "unknown";

export interface IndexedRepoEntry {
	path: string;
	repoId: string;
	decision: Exclude<RepoIndexingDecision, "unknown">;
	updatedAt: string;
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
			// Migrate v1 -> v2: recompute repoId with git remote
			const migrated = parsed.repos.map((entry) => ({
				...entry,
				repoId: computeRepoId(entry.path),
			}));
			saveIndexedRepos(migrated, agentDir);
			return migrated;
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
				typeof entry === "object" &&
				entry !== null &&
				typeof entry.path === "string" &&
				typeof entry.repoId === "string" &&
				(entry.decision === "enabled" || entry.decision === "disabled") &&
				typeof entry.updatedAt === "string",
		)
	);
}

function isV1IndexedReposData(value: unknown): value is IndexedReposData {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as Partial<IndexedReposData>;
	return (
		candidate.schemaVersion === 1 &&
		Array.isArray(candidate.repos) &&
		candidate.repos.every(
			(entry) =>
				typeof entry === "object" &&
				entry !== null &&
				typeof entry.path === "string" &&
				typeof entry.repoId === "string" &&
				(entry.decision === "enabled" || entry.decision === "disabled") &&
				typeof entry.updatedAt === "string",
		)
	);
}
