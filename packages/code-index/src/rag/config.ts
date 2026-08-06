import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WorkspaceCodeRagServiceOptions, WorkspaceCodeRagSettings } from "./types.ts";

export const DEFAULT_WORKSPACE_CODE_RAG_SETTINGS: WorkspaceCodeRagSettings = {
  enabled: true,
  autoRefresh: true,
  allowStaleSearch: true,
  remoteBackendsAllowed: false,
  qdrantUrl: "http://127.0.0.1:6333",
  qdrantBinary: "qdrant",
  qdrantDataDirectory: path.join(os.homedir(), ".p", "agent", "code-rag", "qdrant"),
  qdrantStartupTimeoutMs: 30_000,
  embeddingServerUrl: "http://127.0.0.1:18742",
  embeddingModel: "Qwen/Qwen3-Embedding-0.6B",
  embeddingDimensions: 1024,
  pythonExecutable: "python3",
  defaultLimit: 15,
  maxLimit: 20,
  maxContextCharacters: 16_000,
  maxResultCharacters: 4_000,
  searchTimeoutMs: 30_000,
  embeddingTimeoutMs: 5 * 60_000,
  embeddingStartupTimeoutMs: 120_000,
  maxFileBytes: 1024 * 1024,
  defaultChunkLines: 80,
  maxChunkLines: 300,
  maxSparseVocabularyTokens: 1_000_000,
  preparationMaxWorkers: 32,
  preparationWorkerMemoryBytes: 128 * 1024 * 1024,
  preparationMemoryReserveBytes: 512 * 1024 * 1024,
  encodeBatchSize: 64,
  upsertBatchSize: 128,
  maxEncodeCharacters: 4096,
  fullSparseRebuildChangeRatio: 0.05,
  sparseRebuildDriftRatio: 0.2,
  collectionPrefix: "p_code_chunks",
};

const BOOLEAN_KEYS = new Set<keyof WorkspaceCodeRagSettings>([
  "enabled",
  "autoRefresh",
  "allowStaleSearch",
  "remoteBackendsAllowed",
]);
const NUMBER_KEYS = new Set<keyof WorkspaceCodeRagSettings>([
  "qdrantStartupTimeoutMs",
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
  "maxSparseVocabularyTokens",
  "preparationMaxWorkers",
  "preparationWorkerMemoryBytes",
  "preparationMemoryReserveBytes",
  "encodeBatchSize",
  "upsertBatchSize",
  "maxEncodeCharacters",
  "fullSparseRebuildChangeRatio",
  "sparseRebuildDriftRatio",
]);
const STRING_KEYS = new Set<keyof WorkspaceCodeRagSettings>([
  "qdrantUrl",
  "qdrantBinary",
  "qdrantDataDirectory",
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
      if (typeof rawValue !== "boolean") throw new Error(`Invalid code RAG config field ${rawKey}: expected boolean`);
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

function parsePositiveIntegerEnvironment(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== value.trim()) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function environmentSettings(): Partial<WorkspaceCodeRagSettings> {
  const settings: Partial<WorkspaceCodeRagSettings> = {};
  const enabled = parseBooleanEnvironment("P_CODE_RAG_ENABLED");
  if (enabled !== undefined) settings.enabled = enabled;
  const autoRefresh = parseBooleanEnvironment("P_CODE_RAG_AUTO_REFRESH");
  if (autoRefresh !== undefined) settings.autoRefresh = autoRefresh;
  if (process.env.P_CODE_RAG_QDRANT_URL) settings.qdrantUrl = process.env.P_CODE_RAG_QDRANT_URL;
  if (process.env.P_CODE_RAG_QDRANT_BINARY) settings.qdrantBinary = process.env.P_CODE_RAG_QDRANT_BINARY;
  if (process.env.P_CODE_RAG_QDRANT_DATA_DIR) settings.qdrantDataDirectory = process.env.P_CODE_RAG_QDRANT_DATA_DIR;
  if (process.env.P_CODE_RAG_EMBEDDING_URL) settings.embeddingServerUrl = process.env.P_CODE_RAG_EMBEDDING_URL;
  if (process.env.P_CODE_RAG_EMBEDDING_MODEL) settings.embeddingModel = process.env.P_CODE_RAG_EMBEDDING_MODEL;
  if (process.env.P_CODE_RAG_PYTHON) settings.pythonExecutable = process.env.P_CODE_RAG_PYTHON;
  const preparationMaxWorkers = parsePositiveIntegerEnvironment("P_CODE_RAG_PREPARATION_MAX_WORKERS");
  if (preparationMaxWorkers !== undefined) settings.preparationMaxWorkers = preparationMaxWorkers;
  const preparationWorkerMemoryMb = parsePositiveIntegerEnvironment("P_CODE_RAG_PREPARATION_WORKER_MEMORY_MB");
  if (preparationWorkerMemoryMb !== undefined) {
    settings.preparationWorkerMemoryBytes = preparationWorkerMemoryMb * 1024 * 1024;
  }
  const preparationMemoryReserveMb = parsePositiveIntegerEnvironment("P_CODE_RAG_PREPARATION_MEMORY_RESERVE_MB");
  if (preparationMemoryReserveMb !== undefined) {
    settings.preparationMemoryReserveBytes = preparationMemoryReserveMb * 1024 * 1024;
  }
  const remoteBackendsAllowed = parseBooleanEnvironment("P_CODE_RAG_REMOTE_BACKENDS_ALLOWED");
  if (remoteBackendsAllowed !== undefined) settings.remoteBackendsAllowed = remoteBackendsAllowed;
  const encodeBatchSize = parsePositiveIntegerEnvironment("P_CODE_RAG_ENCODE_BATCH_SIZE");
  if (encodeBatchSize !== undefined) settings.encodeBatchSize = encodeBatchSize;
  const upsertBatchSize = parsePositiveIntegerEnvironment("P_CODE_RAG_UPSERT_BATCH_SIZE");
  if (upsertBatchSize !== undefined) settings.upsertBatchSize = upsertBatchSize;
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
  if (settings.sparseRebuildDriftRatio < 0 || settings.sparseRebuildDriftRatio > 1) {
    throw new Error("Code RAG sparseRebuildDriftRatio must be between 0 and 1");
  }
  if (!Number.isInteger(settings.preparationMaxWorkers)) {
    throw new Error("Code RAG preparationMaxWorkers must be a positive integer");
  }
  if (
    !Number.isSafeInteger(settings.preparationWorkerMemoryBytes) ||
    settings.preparationWorkerMemoryBytes < 1024 * 1024
  ) {
    throw new Error("Code RAG preparationWorkerMemoryBytes must be an integer of at least 1 MiB");
  }
  if (!Number.isSafeInteger(settings.preparationMemoryReserveBytes)) {
    throw new Error("Code RAG preparationMemoryReserveBytes must be a positive integer");
  }
  if (!Number.isSafeInteger(settings.maxFileBytes)) {
    throw new Error("Code RAG maxFileBytes must be a positive integer");
  }
  if (!Number.isSafeInteger(settings.maxSparseVocabularyTokens)) {
    throw new Error("Code RAG maxSparseVocabularyTokens must be a positive integer");
  }
  for (const value of [
    settings.qdrantStartupTimeoutMs,
    settings.maxContextCharacters,
    settings.maxResultCharacters,
    settings.searchTimeoutMs,
    settings.embeddingTimeoutMs,
    settings.embeddingStartupTimeoutMs,
    settings.maxFileBytes,
    settings.defaultChunkLines,
    settings.maxChunkLines,
    settings.maxSparseVocabularyTokens,
    settings.preparationMaxWorkers,
    settings.preparationWorkerMemoryBytes,
    settings.preparationMemoryReserveBytes,
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
        if (!url.protocol.startsWith("http")) {
          throw new Error("Invalid protocol");
        }
      } catch {
        throw new Error(`Code RAG ${name} must be a valid absolute URL (starting with http:// or https://)`);
      }
      if (!["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(url.hostname)) {
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
