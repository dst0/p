#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWorkspaceCodeRagSettings, WorkspaceCodeRagService } from "../packages/code-index/dist/index.js";
import { createSemanticSearchToolDefinition } from "../packages/coding-agent/dist/core/tools/semantic-search.js";

const agentDir = process.env.P_CODING_AGENT_DIR ?? path.join(os.homedir(), ".p", "agent");
const configPath = path.join(agentDir, "code-rag.json");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-code-index-smoke-"));
const workspaceRoot = path.join(temporaryDirectory, "repository");
const dataDirectory = path.join(temporaryDirectory, "data");
let collection;
const explicitSettings = { enabled: true, autoRefresh: false };
const resolvedSettings = loadWorkspaceCodeRagSettings({
	workspaceRoot,
	dataDirectory,
	userConfigPath: configPath,
	settings: explicitSettings,
});

fs.mkdirSync(path.join(workspaceRoot, ".git"), { recursive: true });
fs.writeFileSync(
	path.join(workspaceRoot, "telemetry.ts"),
	[
		"export function normalizeSatelliteTelemetry(reading) {",
		"\t// Normalize orbital sensor readings before archival.",
		"\treturn { ...reading, normalizedForArchive: true };",
		"}",
		"",
	].join("\n"),
);

const service = new WorkspaceCodeRagService({
	workspaceRoot,
	dataDirectory,
	userConfigPath: configPath,
	settings: explicitSettings,
});

try {
	const rebuilt = await service.rebuild();
	collection = rebuilt.status.collection;
	if (rebuilt.status.state !== "ready" || !collection) {
		throw new Error(`real index rebuild ended in state ${rebuilt.status.state}`);
	}
	const tool = createSemanticSearchToolDefinition(workspaceRoot, service);
	const result = await tool.execute("installed-code-index-smoke", {
		query: "where are satellite readings normalized before archival",
		freshness: "allow_stale",
	});
	if (result.details?.error) {
		throw new Error(`${result.details.error.code}: ${result.details.error.message}`);
	}
	const matches = result.details?.response?.results ?? [];
	if (!matches.some((match) => match.path === "telemetry.ts")) {
		throw new Error("semantic search did not retrieve telemetry.ts from the real index");
	}
	console.log(`Real semantic-search smoke passed (${matches.length} result${matches.length === 1 ? "" : "s"})`);
} finally {
	try {
		if (collection) await deleteSmokeCollection(collection);
	} finally {
		try {
			await service.dispose();
		} finally {
			fs.rmSync(temporaryDirectory, { recursive: true, force: true });
		}
	}
}

async function deleteSmokeCollection(collectionName) {
	try {
		const response = await fetch(
			`${resolvedSettings.qdrantUrl.replace(/\/$/, "")}/collections/${encodeURIComponent(collectionName)}`,
			{ method: "DELETE", signal: AbortSignal.timeout(10_000) },
		);
		if (!response.ok && response.status !== 404) {
			console.warn(`Could not remove semantic-search smoke collection: HTTP ${response.status}`);
		}
	} catch (error) {
		console.warn(`Could not remove semantic-search smoke collection: ${error instanceof Error ? error.message : error}`);
	}
}
