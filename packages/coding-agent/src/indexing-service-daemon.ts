#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { getAgentDir } from "./config.ts";
import { IndexingDaemon } from "./core/indexing-daemon.ts";

export async function runIndexingService(): Promise<void> {
	const agentDir = getAgentDir();
	const daemon = new IndexingDaemon({
		agentDir,
		qdrantBinary: process.env.P_CODE_RAG_QDRANT_BINARY ?? "qdrant",
		qdrantDataDirectory: process.env.P_CODE_RAG_QDRANT_DATA_DIR ?? path.join(agentDir, "code-rag", "qdrant"),
		pythonExecutable: process.env.P_CODE_RAG_PYTHON ?? "python3",
		embeddingModel: process.env.P_CODE_RAG_EMBEDDING_MODEL ?? "Qwen/Qwen3-Embedding-0.6B",
	});
	await daemon.start();

	await new Promise<void>((resolve) => {
		let stopping = false;
		const stop = () => {
			if (stopping) return;
			stopping = true;
			void daemon.stop().finally(resolve);
		};
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
	});
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
	void runIndexingService().catch((error: unknown) => {
		console.error(`Code indexing service failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
