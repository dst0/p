import fs from "node:fs";
import path from "node:path";
import type { IndexingProgress, RagState } from "@dst0/p-code-index";
import { getAgentDir } from "../config.ts";
import {
	disableIndexingForRepo,
	enableIndexingForRepo,
	getRepoIndexingDecision,
	prioritizeIndexingForRepo,
	type RepoIndexingDecision,
} from "./indexed-repos.ts";

export const INDEXING_SERVICE_STATUS_FILE = "indexing-service-status.json";

export interface IndexStatus {
	decision: RepoIndexingDecision;
	indexed: boolean;
	serviceRunning: boolean;
	ragState?: RagState | "queued" | "error";
	ragFiles?: number;
	ragChunks?: number;
	totalFiles?: number;
	totalChunks?: number;
	progress?: IndexingProgress;
	lastError?: string;
}

export interface RepositoryServiceStatus {
	path: string;
	state: RagState | "queued" | "error";
	indexedFiles: number;
	indexedChunks: number;
	updatedAt: string;
	progress?: IndexingProgress;
	lastError?: string;
}

export interface IndexingServiceStatusData {
	pid: number;
	running: boolean;
	startedAt: string;
	updatedAt: string;
	repos: RepositoryServiceStatus[];
}

export class IndexingService {
	private readonly agentDir: string;

	constructor(agentDir: string = getAgentDir()) {
		this.agentDir = agentDir;
	}

	getDecision(workspaceRoot: string): RepoIndexingDecision {
		return getRepoIndexingDecision(workspaceRoot, this.agentDir);
	}

	getStatus(workspaceRoot: string): IndexStatus {
		const resolved = canonicalizePath(workspaceRoot);
		const decision = this.getDecision(resolved);
		const daemonStatus = readServiceStatus(this.agentDir);
		const repoStatus = daemonStatus?.repos.find((entry) => canonicalizePath(entry.path) === resolved);
		return {
			decision,
			indexed: decision === "enabled",
			serviceRunning: daemonStatus?.running === true,
			ragState: repoStatus?.state,
			ragFiles: repoStatus?.indexedFiles,
			ragChunks: repoStatus?.indexedChunks,
			totalFiles: repoStatus?.progress?.totalFiles ?? repoStatus?.indexedFiles,
			totalChunks: repoStatus?.progress?.totalChunks ?? repoStatus?.indexedChunks,
			progress: repoStatus?.progress,
			lastError: repoStatus?.lastError,
		};
	}

	enableIndexing(workspaceRoot: string): void {
		enableIndexingForRepo(workspaceRoot, this.agentDir);
	}

	disableIndexing(workspaceRoot: string): void {
		disableIndexingForRepo(workspaceRoot, this.agentDir);
	}

	prioritizeIndexing(workspaceRoot: string): boolean {
		return prioritizeIndexingForRepo(workspaceRoot, this.agentDir) !== undefined;
	}

	isEnabled(workspaceRoot: string): boolean {
		return this.getDecision(workspaceRoot) === "enabled";
	}
}

export function writeIndexingServiceStatus(agentDir: string, value: IndexingServiceStatusData): void {
	const filePath = path.join(agentDir, INDEXING_SERVICE_STATUS_FILE);
	fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
	const temporaryPath = `${filePath}.${process.pid}.tmp`;
	fs.writeFileSync(temporaryPath, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 });
	fs.renameSync(temporaryPath, filePath);
}

let indexingServiceInstance: IndexingService | undefined;

export function getIndexingService(): IndexingService {
	indexingServiceInstance ??= new IndexingService();
	return indexingServiceInstance;
}

function readServiceStatus(agentDir: string): IndexingServiceStatusData | undefined {
	const filePath = path.join(agentDir, INDEXING_SERVICE_STATUS_FILE);
	try {
		const value = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
		if (!isServiceStatus(value)) return undefined;
		if (value.running && !isProcessAlive(value.pid)) return { ...value, running: false };
		return value;
	} catch {
		return undefined;
	}
}

function isServiceStatus(value: unknown): value is IndexingServiceStatusData {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as Partial<IndexingServiceStatusData>;
	return (
		typeof candidate.pid === "number" &&
		typeof candidate.running === "boolean" &&
		typeof candidate.startedAt === "string" &&
		typeof candidate.updatedAt === "string" &&
		Array.isArray(candidate.repos) &&
		candidate.repos.every(
			(entry) =>
				typeof entry === "object" &&
				entry !== null &&
				typeof entry.path === "string" &&
				typeof entry.state === "string" &&
				typeof entry.indexedFiles === "number" &&
				typeof entry.indexedChunks === "number" &&
				typeof entry.updatedAt === "string" &&
				(entry.lastError === undefined || typeof entry.lastError === "string") &&
				(entry.progress === undefined || isIndexingProgress(entry.progress)),
		)
	);
}

function isIndexingProgress(value: unknown): value is IndexingProgress {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as Partial<IndexingProgress>;
	return (
		(candidate.phase === "scanning" || candidate.phase === "indexing" || candidate.phase === "finalizing") &&
		typeof candidate.percent === "number" &&
		Number.isFinite(candidate.percent) &&
		candidate.percent >= 0 &&
		candidate.percent <= 100 &&
		(candidate.startedAt === undefined || typeof candidate.startedAt === "string") &&
		(candidate.etaSeconds === undefined ||
			(typeof candidate.etaSeconds === "number" && Number.isFinite(candidate.etaSeconds)))
	);
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function canonicalizePath(value: string): string {
	const resolved = path.resolve(value);
	try {
		return fs.realpathSync(resolved);
	} catch {
		return resolved;
	}
}
