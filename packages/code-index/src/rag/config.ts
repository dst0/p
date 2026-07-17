import fs from "node:fs";
import path from "node:path";
import type { WorkspaceCodeRagServiceOptions, WorkspaceCodeRagSettings } from "./types.ts";

export const DEFAULT_WORKSPACE_CODE_RAG_SETTINGS: WorkspaceCodeRagSettings = {
	enabled: true,
	autoRefresh: true,
	allowStaleSearch: true,
	remoteBackendsAllowed: false,
	qdrantUrl: "http://127.0.0.1:6333",
	embeddingServerUrl: "http://127.0.0.1:8081",
	embeddingModel: "Qwen/Qwen3-Embedding-0.6B",
	embeddingDimensions: 1024,
	pythonExecutable: "python3",
	defaultLimit: 8,
	maxLimit: 20,
	maxContextCharacters: 16_000,
	maxResultCharacters: 4_000,
	searchTimeoutMs: 5_000,
	embeddingTimeoutMs: 30_000,
	embeddingStartupTimeoutMs: 120_000,
	maxFileBytes: 1024 * 1024,
	defaultChunkLines: 80,
	maxChunkLines: 300,
	encodeBatchSize: 32,
	upsertBatchSize: 64,
	maxEncodeCharacters: 2048,
	fullSparseRebuildChangeRatio: 0.05,
	collectionPrefix: "p_code_chunks",
};

const BOOLEAN_KEYS = new Set<keyof WorkspaceCodeRagSettings>([
	"enabled",
	"autoRefresh",
	"allowStaleSearch",
	"remoteBackendsAllowed",
]);
const NUMBER_KEYS = new Set<keyof WorkspaceCodeRagSettings>([
	"embeddingDimensions",
	"defaultLimit",
	"maxLimit",
	"maxContextCharacters",
	"maxResultCharacters",
	"searchTimeoutMs",
	"embeddingTimeoutMs",
	"embeddingStartupTimeoutMs",
	"maxFileBytes",
	"defaultChunkLines",
	"maxChunkLines",
	"encodeBatchSize",
	"upsertBatchSize",
	"maxEncodeCharacters",
	"fullSparseRebuildChangeRatio",
]);
const STRING_KEYS = new Set<keyof WorkspaceCodeRagSettings>([
	"qdrantUrl",
	"embeddingServerUrl",
	"embeddingModel",
	"pythonExecutable",
	"collectionPrefix",
]);

function parseConfigFile(configPath: string | undefined): Partial<WorkspaceCodeRagSettings> {
	if (!configPath || !fs.existsSync(configPath)) return {};
	let value: unknown;
	try {
		value = JSON.parse(fs.readFileSync(configPath, "utf-8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid code RAG config at ${configPath}: ${message}`);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Invalid code RAG config at ${configPath}: expected a JSON object`);
	}

	const parsed: Partial<WorkspaceCodeRagSettings> = {};
	for (const [rawKey, rawValue] of Object.entries(value)) {
		const key = rawKey as keyof WorkspaceCodeRagSettings;
		if (BOOLEAN_KEYS.has(key)) {
			if (typeof rawValue !== "boolean")
				throw new Error(`Invalid code RAG config field ${rawKey}: expected boolean`);
			(parsed as Record<string, unknown>)[key] = rawValue;
		} else if (NUMBER_KEYS.has(key)) {
			if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
				throw new Error(`Invalid code RAG config field ${rawKey}: expected finite number`);
			}
			(parsed as Record<string, unknown>)[key] = rawValue;
		} else if (STRING_KEYS.has(key)) {
			if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
				throw new Error(`Invalid code RAG config field ${rawKey}: expected non-empty string`);
			}
			(parsed as Record<string, unknown>)[key] = rawValue;
		} else {
			throw new Error(`Unknown code RAG config field: ${rawKey}`);
		}
	}
	return parsed;
}

function parseBooleanEnvironment(name: string): boolean | undefined {
	const value = process.env[name];
	if (value === undefined) return undefined;
	if (value === "1" || value.toLowerCase() === "true") return true;
	if (value === "0" || value.toLowerCase() === "false") return false;
	throw new Error(`${name} must be true, false, 1, or 0`);
}

function environmentSettings(): Partial<WorkspaceCodeRagSettings> {
	const settings: Partial<WorkspaceCodeRagSettings> = {};
	const enabled = parseBooleanEnvironment("P_CODE_RAG_ENABLED");
	if (enabled !== undefined) settings.enabled = enabled;
	const autoRefresh = parseBooleanEnvironment("P_CODE_RAG_AUTO_REFRESH");
	if (autoRefresh !== undefined) settings.autoRefresh = autoRefresh;
	if (process.env.P_CODE_RAG_QDRANT_URL) settings.qdrantUrl = process.env.P_CODE_RAG_QDRANT_URL;
	if (process.env.P_CODE_RAG_EMBEDDING_URL) settings.embeddingServerUrl = process.env.P_CODE_RAG_EMBEDDING_URL;
	if (process.env.P_CODE_RAG_EMBEDDING_MODEL) settings.embeddingModel = process.env.P_CODE_RAG_EMBEDDING_MODEL;
	if (process.env.P_CODE_RAG_PYTHON) settings.pythonExecutable = process.env.P_CODE_RAG_PYTHON;
	return settings;
}

function validateSettings(settings: WorkspaceCodeRagSettings): WorkspaceCodeRagSettings {
	if (settings.defaultLimit < 1 || settings.maxLimit < settings.defaultLimit || settings.maxLimit > 100) {
		throw new Error("Code RAG result limits are invalid");
	}
	if (settings.embeddingDimensions < 1 || !Number.isInteger(settings.embeddingDimensions)) {
		throw new Error("Code RAG embeddingDimensions must be a positive integer");
	}
	if (settings.fullSparseRebuildChangeRatio < 0 || settings.fullSparseRebuildChangeRatio > 1) {
		throw new Error("Code RAG fullSparseRebuildChangeRatio must be between 0 and 1");
	}
	for (const value of [
		settings.maxContextCharacters,
		settings.maxResultCharacters,
		settings.searchTimeoutMs,
		settings.embeddingTimeoutMs,
		settings.embeddingStartupTimeoutMs,
		settings.maxFileBytes,
		settings.defaultChunkLines,
		settings.maxChunkLines,
		settings.encodeBatchSize,
		settings.upsertBatchSize,
		settings.maxEncodeCharacters,
	]) {
		if (!Number.isFinite(value) || value <= 0) throw new Error("Code RAG numeric settings must be positive");
	}
	if (!settings.remoteBackendsAllowed) {
		for (const [name, value] of [
			["qdrantUrl", settings.qdrantUrl],
			["embeddingServerUrl", settings.embeddingServerUrl],
		] as const) {
			let url: URL;
			try {
				url = new URL(value);
			} catch {
				throw new Error(`Code RAG ${name} must be a valid URL`);
			}
			if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
				throw new Error(`Code RAG ${name} must be local unless remoteBackendsAllowed is explicitly enabled`);
			}
		}
	}
	return settings;
}

export function loadWorkspaceCodeRagSettings(options: WorkspaceCodeRagServiceOptions): WorkspaceCodeRagSettings {
	const userConfigPath = options.userConfigPath ?? path.join(options.dataDirectory, "..", "code-rag.json");
	const repositoryConfigPath = options.repositoryConfigPath ?? path.join(options.workspaceRoot, ".p", "code-rag.json");
	return validateSettings({
		...DEFAULT_WORKSPACE_CODE_RAG_SETTINGS,
		...parseConfigFile(userConfigPath),
		...parseConfigFile(repositoryConfigPath),
		...environmentSettings(),
		...(options.settings ?? {}),
	});
}
