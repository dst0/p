import path from "node:path";
import type { IndexingServiceStatusData, RepositoryServiceStatus } from "./indexing-service.ts";

const RUNNING_STATES = new Set(["initializing", "updating"]);
const LEGACY_WAITING_STATES = new Set(["queued", "initializing", "updating"]);

export interface IndexingReinstallProgressOptions {
	pid: number;
	mode: "quiesce" | "legacy";
	elapsedMs: number;
	remainingMs: number;
	unchangedMs: number;
	nowMs?: number;
}

export function formatIndexingReinstallProgress(
	status: IndexingServiceStatusData | undefined,
	options: IndexingReinstallProgressOptions,
): string {
	const waitingStates = options.mode === "quiesce" ? RUNNING_STATES : LEGACY_WAITING_STATES;
	const waiting = status?.repos.filter((repository) => waitingStates.has(repository.state)) ?? [];
	const queued = options.mode === "quiesce" ? (status?.repos.filter((repository) => repository.state === "queued") ?? []) : [];
	const lines = [
		`Still waiting for code indexing service ${options.pid} (${formatDuration(options.elapsedMs)} elapsed, ${formatDuration(options.remainingMs)} until timeout).`,
	];

	if (waiting.length === 0) {
		lines.push("  No active repository operation is currently reported; waiting for the daemon readiness marker.");
	} else {
		for (const repository of waiting) lines.push(`  - ${formatRepositoryProgress(repository)}`);
	}

	if (queued.length > 0) {
		lines.push(`  ${queued.length} queued ${queued.length === 1 ? "repository is" : "repositories are"} paused and will not start before reinstall.`);
	}

	if (options.unchangedMs >= 10_000) {
		lines.push(`  Reported progress has not changed for ${formatDuration(options.unchangedMs)}.`);
	}

	const maximumEtaMs = getMaximumEtaMs(waiting);
	if (maximumEtaMs !== undefined && maximumEtaMs > options.remainingMs) {
		lines.push(
			`  Warning: the longest reported ETA (${formatDuration(maximumEtaMs)}) exceeds the remaining reinstall wait (${formatDuration(options.remainingMs)}); this run may time out.`,
		);
	}

	if (status?.updatedAt) {
		const updatedAt = Date.parse(status.updatedAt);
		const nowMs = options.nowMs ?? Date.now();
		if (Number.isFinite(updatedAt) && nowMs > updatedAt) {
			lines.push(`  Status file updated ${formatDuration(nowMs - updatedAt)} ago.`);
		}
	}

	return lines.join("\n");
}

function formatRepositoryProgress(repository: RepositoryServiceStatus): string {
	const repositoryName = path.basename(repository.path) || repository.path;
	const progress = repository.progress;
	if (!progress) {
		return `${repositoryName}: ${repository.state}, ${repository.indexedFiles} files / ${repository.indexedChunks} chunks`;
	}

	const details = [`${progress.phase} ${formatPercent(progress.percent)}`];
	if (progress.etaSeconds !== undefined) details.push(`ETA ${formatDuration(progress.etaSeconds * 1_000)}`);
	return `${repositoryName}: ${details.join(", ")}, ${repository.indexedFiles} files / ${repository.indexedChunks} chunks`;
}

function getMaximumEtaMs(repositories: RepositoryServiceStatus[]): number | undefined {
	let maximumEtaMs: number | undefined;
	for (const repository of repositories) {
		const etaSeconds = repository.progress?.etaSeconds;
		if (etaSeconds === undefined || !Number.isFinite(etaSeconds) || etaSeconds < 0) continue;
		maximumEtaMs = Math.max(maximumEtaMs ?? 0, etaSeconds * 1_000);
	}
	return maximumEtaMs;
}

function formatPercent(percent: number): string {
	return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function formatDuration(milliseconds: number): string {
	const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
	const hours = Math.floor(totalSeconds / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}
