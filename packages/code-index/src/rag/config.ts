import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_QDRANT_STARTUP_TIMEOUT_MS } from "../embed/qdrant-server.ts";
import { DEFAULT_MAX_SEQUENCE_LENGTH, defaultMaxSequenceLength } from "./embedding-settings.ts";
import { resolveQdrantEndpoint } from "./qdrant-endpoint.ts";
import type { WorkspaceCodeRagServiceOptions, WorkspaceCodeRagSettings } from "./types.ts";

export const DEFAULT_EMBEDDING_POOLING = "last-non-padding-token";
export const DEFAULT_EMBEDDING_NORMALIZATION = "l2";

export const DEFAULT_WORKSPACE_CODE_RAG_SETTINGS: WorkspaceCodeRagSettings = {
  enabled: true,
  enableTray: true,
  autoRefresh: true,
  allowStaleSearch: true,
  remoteBackendsAllowed: false,
  searchMode: "hybrid",
  qdrantUrl: "http://127.0.0.1:6333",
  qdrantBinary: "qdrant",
  qdrantDataDirectory: path.join(os.homedir(), ".p", "agent", "code-rag", "qdrant"),
  qdrantStartupTimeoutMs: DEFAULT_QDRANT_STARTUP_TIMEOUT_MS,
  embeddingServerUrl: "http://127.0.0.1:18742",
  embeddingModel: "Qwen/Qwen3-Embedding-0.6B",
  embeddingDimensions: 1024,
  embeddingPooling: DEFAULT_EMBEDDING_POOLING,
  embeddingNormalization: DEFAULT_EMBEDDING_NORMALIZATION,
  embeddingDevice: "auto",
  pythonExecutable: "python3",
  torchBackend: "auto",
  maxEmbeddingBatchSize: 64,
  maxCpuThreads: os.cpus().length,
  maxSequenceLength: DEFAULT_MAX_SEQUENCE_LENGTH,
  mpsPrecision: "bfloat16",
  minSystemMemoryReserveBytes: 1024 * 1024 * 1024,
  minAcceleratorMemoryReserveBytes: 512 * 1024 * 1024,
  openvinoCacheDirectory: path.join(os.homedir(), ".p", "agent", "indexing-service", "openvino-cache"),
  vitisaiCacheDirectory: path.join(os.homedir(), ".p", "agent", "indexing-service", "vitisai-cache"),
  vitisaiCacheKey: "Qwen_Qwen3-Embedding-0.6B",
  vitisaiLogLevel: "error",
  defaultLimit: 15,
  maxLimit: 20,
  maxContextCharacters: 16_000,
  maxResultCharacters: 4_000,
  searchTimeoutMs: 30_000,
  embeddingTimeoutMs: 5 * 60_000,
  embeddingStartupTimeoutMs: 5 * 60_000,
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

const BOOLEAN_KEYS = new Set<keyof WorkspaceCodeRagSettings>(
  "enabled enableTray autoRefresh allowStaleSearch remoteBackendsAllowed".split(
    " ",
  ) as (keyof WorkspaceCodeRagSettings)[],
);
const NUMBER_KEYS = new Set<keyof WorkspaceCodeRagSettings>(
  "qdrantStartupTimeoutMs embeddingDimensions defaultLimit maxLimit maxContextCharacters maxResultCharacters searchTimeoutMs embeddingTimeoutMs embeddingStartupTimeoutMs maxEmbeddingBatchSize maxCpuThreads maxSequenceLength minSystemMemoryReserveBytes minAcceleratorMemoryReserveBytes embeddingModelParameterCount maxFileBytes defaultChunkLines maxChunkLines maxSparseVocabularyTokens preparationMaxWorkers preparationWorkerMemoryBytes preparationMemoryReserveBytes encodeBatchSize upsertBatchSize maxEncodeCharacters fullSparseRebuildChangeRatio sparseRebuildDriftRatio".split(
    " ",
  ) as (keyof WorkspaceCodeRagSettings)[],
);
const STRING_KEYS = new Set<keyof WorkspaceCodeRagSettings>(
  "searchMode qdrantUrl qdrantApiKey qdrantBinary qdrantDataDirectory embeddingServerUrl embeddingModel embeddingPooling embeddingNormalization embeddingDevice pythonExecutable torchBackend mpsPrecision openvinoCacheDirectory vitisaiCacheDirectory vitisaiCacheKey vitisaiConfigFile vitisaiLogLevel amdIronArtifactDirectory amdIronCacheDirectory amdIronSourceDirectory amdNpuGeneration amdNpuRuntimeVersion ryzenAiArchivePath collectionPrefix".split(
    " ",
  ) as (keyof WorkspaceCodeRagSettings)[],
);
const EMBEDDING_DEVICES = new Set<WorkspaceCodeRagSettings["embeddingDevice"]>(
  "auto cpu cuda rocm mps npu apple-ane apple-mps amd-rocm nvidia-cuda ryzenai vitisai amd-phoenix-npu amd-ryzenai-npu openvino openvino-npu intel-openvino-cpu intel-openvino-npu".split(
    " ",
  ) as WorkspaceCodeRagSettings["embeddingDevice"][],
);

const TORCH_BACKENDS = new Set<WorkspaceCodeRagSettings["torchBackend"]>(["auto", "cpu", "cuda", "rocm"]);
const MPS_PRECISIONS = new Set<WorkspaceCodeRagSettings["mpsPrecision"]>(["bfloat16", "float32"]);
const SEARCH_MODES = new Set<WorkspaceCodeRagSettings["searchMode"]>(["hybrid", "bm25-only"]);

export function computeEmbeddingCompatibilityGroup(
  model: string,
  dimensions: number,
  pooling: string,
  normalization: string,
  searchMode: WorkspaceCodeRagSettings["searchMode"] = "hybrid",
): string {
  const slug = model.toLowerCase().replaceAll("/", "_").replaceAll("-", "_");
  const base = `${slug}-${dimensions}-${pooling}-${normalization}`;
  return searchMode === "hybrid" ? base : `${base}-${searchMode}`;
}

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

function validateSettings(settings: WorkspaceCodeRagSettings): WorkspaceCodeRagSettings {
  if (settings.defaultLimit < 1 || settings.maxLimit < settings.defaultLimit || settings.maxLimit > 100) {
    throw new Error("Code RAG result limits are invalid");
  }
  if (settings.embeddingDimensions < 1 || !Number.isInteger(settings.embeddingDimensions)) {
    throw new Error("Code RAG embeddingDimensions must be a positive integer");
  }
  if (!EMBEDDING_DEVICES.has(settings.embeddingDevice)) {
    throw new Error(`Code RAG embeddingDevice is unsupported: ${settings.embeddingDevice}`);
  }
  const deviceDefaultSequenceLength = defaultMaxSequenceLength(settings.embeddingDevice, os.platform());
  if (deviceDefaultSequenceLength < DEFAULT_MAX_SEQUENCE_LENGTH) {
    settings.maxSequenceLength = Math.min(settings.maxSequenceLength, deviceDefaultSequenceLength);
  }
  if (!TORCH_BACKENDS.has(settings.torchBackend)) {
    throw new Error(`Code RAG torchBackend is unsupported: ${settings.torchBackend}`);
  }
  if (!MPS_PRECISIONS.has(settings.mpsPrecision)) {
    throw new Error(`Code RAG mpsPrecision is unsupported: ${settings.mpsPrecision}`);
  }
  if (!SEARCH_MODES.has(settings.searchMode))
    throw new Error(`Code RAG searchMode is unsupported: ${settings.searchMode}`);
  if (
    settings.embeddingModelParameterCount !== undefined &&
    (!Number.isSafeInteger(settings.embeddingModelParameterCount) || settings.embeddingModelParameterCount <= 0)
  ) {
    throw new Error("Code RAG embeddingModelParameterCount must be a positive integer");
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
    settings.maxEmbeddingBatchSize,
    settings.maxCpuThreads,
    settings.maxSequenceLength,
    settings.minSystemMemoryReserveBytes,
    settings.minAcceleratorMemoryReserveBytes,
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
  settings.qdrantUrl = resolveQdrantEndpoint(settings.qdrantUrl, settings.remoteBackendsAllowed).url;
  validateEmbeddingServerUrl(settings.embeddingServerUrl, settings.remoteBackendsAllowed);
  return settings;
}

function validateEmbeddingServerUrl(value: string, remoteBackendsAllowed: boolean): void {
  let url: URL;
  try {
    url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Invalid protocol");
  } catch {
    throw new Error("Code RAG embeddingServerUrl must be a valid absolute URL (starting with http:// or https://)");
  }
  if (!remoteBackendsAllowed && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("Code RAG embeddingServerUrl must be local unless remoteBackendsAllowed is explicitly enabled");
  }
}

function resolveQdrantApiKey(apiKey?: string, qdrantDataDirectory?: string): string | undefined {
  if (apiKey && apiKey.trim().length > 0) return apiKey.trim();
  const envKey = process.env.P_QDRANT_API_KEY ?? process.env.QDRANT_API_KEY;
  if (envKey && envKey.trim().length > 0) return envKey.trim();
  if (qdrantDataDirectory) {
    const keyFile = path.join(qdrantDataDirectory, "qdrant.key");
    try {
      if (fs.existsSync(keyFile)) {
        const fileKey = fs.readFileSync(keyFile, "utf-8").trim();
        if (fileKey.length > 0) return fileKey;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

export function loadWorkspaceCodeRagSettings(options: WorkspaceCodeRagServiceOptions): WorkspaceCodeRagSettings {
  const userConfigPath = options.userConfigPath ?? path.join(options.dataDirectory, "..", "code-rag.json");
  const repositoryConfigPath = options.repositoryConfigPath ?? path.join(options.workspaceRoot, ".p", "code-rag.json");
  const settings = validateSettings({
    ...DEFAULT_WORKSPACE_CODE_RAG_SETTINGS,
    ...parseConfigFile(userConfigPath),
    ...parseConfigFile(repositoryConfigPath),
    ...(options.settings ?? {}),
  });
  settings.qdrantApiKey = resolveQdrantApiKey(settings.qdrantApiKey, settings.qdrantDataDirectory);
  return settings;
}
