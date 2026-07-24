#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getAgentDir } from "./config.ts";
import { IndexingDaemon } from "./core/indexing-daemon.ts";
import { INDEXING_SERVICE_REINSTALL_FILE } from "./core/indexing-service.ts";

const REINSTALL_CONTROL_FILE = "reinstall-control.json";
const REINSTALL_READY_FILE = "reinstall-ready.json";
const REINSTALL_STOP_LEASE_MS = 60_000;
const REINSTALL_MARKER_MAX_AGE_MS = 5 * 60_000;
const REINSTALL_MARKER_POLL_MS = 200;

export function getIndexingReinstallControlPath(agentDir: string): string {
	return path.join(agentDir, "indexing-service", REINSTALL_CONTROL_FILE);
}

export function getIndexingReinstallReadyPath(agentDir: string): string {
	return path.join(agentDir, "indexing-service", REINSTALL_READY_FILE);
}

export function isIndexingReinstallMarkerActive(agentDir: string, now: number = Date.now()): boolean {
	const markerPath = path.join(agentDir, INDEXING_SERVICE_REINSTALL_FILE);
	try {
		const marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as unknown;
		if (typeof marker !== "object" || marker === null || Array.isArray(marker)) return false;
		const candidate = marker as { pid?: unknown; startedAt?: unknown };
		if (typeof candidate.pid !== "number" || !Number.isSafeInteger(candidate.pid) || candidate.pid <= 0) return false;
		if (typeof candidate.startedAt !== "string") return false;
		const startedAt = Date.parse(candidate.startedAt);
		if (!Number.isFinite(startedAt)) return false;
		const ageMs = now - startedAt;
		return ageMs >= 0 && ageMs <= REINSTALL_MARKER_MAX_AGE_MS;
	} catch {
		return false;
	}
}

export async function runIndexingService(): Promise<void> {
	const agentDir = getAgentDir();
	await waitForIndexingReinstallMarkerClear(agentDir);
	const reinstallControlPath = getIndexingReinstallControlPath(agentDir);
	const reinstallReadyPath = getIndexingReinstallReadyPath(agentDir);
	fs.mkdirSync(path.dirname(reinstallControlPath), { recursive: true, mode: 0o700 });
	fs.rmSync(reinstallReadyPath, { force: true });
	fs.writeFileSync(
		reinstallControlPath,
		`${JSON.stringify({ pid: process.pid, protocolVersion: 1, startedAt: new Date().toISOString() })}\n`,
		{ mode: 0o600 },
	);
	const daemon = new IndexingDaemon({
		agentDir,
		qdrantBinary: process.env.P_CODE_RAG_QDRANT_BINARY ?? "qdrant",
		qdrantDataDirectory: process.env.P_CODE_RAG_QDRANT_DATA_DIR ?? path.join(agentDir, "code-rag", "qdrant"),
		pythonExecutable: process.env.P_CODE_RAG_PYTHON ?? "python3",
		embeddingModel: process.env.P_CODE_RAG_EMBEDDING_MODEL ?? "Qwen/Qwen3-Embedding-0.6B",
	});
	try {
		await daemon.start();

		await new Promise<void>((resolve) => {
			let stopping = false;
			let preparedForRestart = false;
			let preparePromise: Promise<void> | undefined;
			let restartLeaseTimer: ReturnType<typeof setTimeout> | undefined;
			const stop = (waitForPreparation: boolean) => {
				if (stopping) return;
				stopping = true;
				if (restartLeaseTimer) clearTimeout(restartLeaseTimer);
				process.off("SIGUSR1", prepareForRestart);
				void stopIndexingDaemonAfterSignal(
					daemon,
					preparePromise,
					preparedForRestart,
					waitForPreparation,
				).finally(resolve);
			};
			const prepareForRestart = () => {
				if (stopping || preparePromise) return;
				preparePromise = daemon
					.prepareForRestart()
					.then(() => {
						if (stopping) return;
						fs.writeFileSync(
							reinstallReadyPath,
							`${JSON.stringify({ pid: process.pid, readyAt: new Date().toISOString() })}\n`,
							{ mode: 0o600 },
						);
						preparedForRestart = true;
						restartLeaseTimer = setTimeout(() => {
							console.error("Indexing reinstall did not stop the prepared daemon; restarting it safely");
							stop(true);
						}, REINSTALL_STOP_LEASE_MS);
					})
					.catch((error: unknown) => {
						if (stopping) return;
						console.error(
							`Failed to prepare code indexing service for reinstall: ${error instanceof Error ? error.message : String(error)}`,
						);
					});
			};
			process.on("SIGUSR1", prepareForRestart);
			process.once("SIGINT", () => stop(false));
			process.once("SIGTERM", () => stop(false));
		});
	} finally {
		fs.rmSync(reinstallControlPath, { force: true });
		fs.rmSync(reinstallReadyPath, { force: true });
	}
}

export async function stopIndexingDaemonAfterSignal(
	daemon: Pick<IndexingDaemon, "stop">,
	preparePromise: Promise<void> | undefined,
	preparedForRestart: boolean,
	waitForPreparation: boolean,
): Promise<void> {
	if (waitForPreparation) await (preparePromise ?? Promise.resolve());
	await daemon.stop({ graceful: waitForPreparation && preparedForRestart });
}

export async function waitForIndexingReinstallMarkerClear(agentDir: string): Promise<void> {
	let announced = false;
	while (isIndexingReinstallMarkerActive(agentDir)) {
		if (!announced) {
			console.log("Code indexing service start deferred until the active reinstall completes.");
			announced = true;
		}
		await new Promise((resolve) => setTimeout(resolve, REINSTALL_MARKER_POLL_MS));
	}
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
	void runIndexingService().catch((error: unknown) => {
		console.error(`Code indexing service failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
