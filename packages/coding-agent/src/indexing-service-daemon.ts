#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getAgentDir } from "./config.ts";
import { IndexingDaemon } from "./core/indexing-daemon.ts";

const REINSTALL_CONTROL_FILE = "reinstall-control.json";
const REINSTALL_READY_FILE = "reinstall-ready.json";

export function getIndexingReinstallControlPath(agentDir: string): string {
	return path.join(agentDir, "indexing-service", REINSTALL_CONTROL_FILE);
}

export function getIndexingReinstallReadyPath(agentDir: string): string {
	return path.join(agentDir, "indexing-service", REINSTALL_READY_FILE);
}

export async function runIndexingService(): Promise<void> {
	const agentDir = getAgentDir();
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
			let preparePromise: Promise<void> | undefined;
			const prepareForRestart = () => {
				if (stopping || preparePromise) return;
				preparePromise = daemon
					.prepareForRestart()
					.then(() => {
						fs.writeFileSync(
							reinstallReadyPath,
							`${JSON.stringify({ pid: process.pid, readyAt: new Date().toISOString() })}\n`,
							{ mode: 0o600 },
						);
					})
					.catch((error: unknown) => {
						console.error(
							`Failed to prepare code indexing service for reinstall: ${error instanceof Error ? error.message : String(error)}`,
						);
					});
			};
			const stop = () => {
				if (stopping) return;
				stopping = true;
				process.off("SIGUSR1", prepareForRestart);
				const prepared = preparePromise ?? Promise.resolve();
				void prepared.then(() => daemon.stop({ graceful: true })).finally(resolve);
			};
			process.on("SIGUSR1", prepareForRestart);
			process.once("SIGINT", stop);
			process.once("SIGTERM", stop);
		});
	} finally {
		fs.rmSync(reinstallControlPath, { force: true });
		fs.rmSync(reinstallReadyPath, { force: true });
	}
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
	void runIndexingService().catch((error: unknown) => {
		console.error(`Code indexing service failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
