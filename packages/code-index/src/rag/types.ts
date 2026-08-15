import type { EmbeddingProvider } from "../embed/provider.ts";
import type { EmbeddingRuntimeSettings } from "./embedding-settings.ts";
import type { RagVectorStore } from "./vector-types.ts";

export type RagState =
  | "not_initialized"
  | "initializing"
  | "ready"
  | "stale"
  | "updating"
  | "partial"
  | "unavailable"
  | "disabled";

export type RagErrorCode =
  | "RAG_DISABLED"
  | "RAG_NOT_INITIALIZED"
  | "RAG_STALE"
  | "RAG_BACKEND_UNAVAILABLE"
  | "RAG_EMBEDDING_SERVER_DOWN"
  | "RAG_EMBEDDING_SERVER_ERROR"
  | "RAG_QDRANT_DOWN"
  | "RAG_QDRANT_ERROR"
  | "RAG_NETWORK_ERROR"
  | "RAG_TIMEOUT"
  | "RAG_CANCELLED"
  | "RAG_INCOMPATIBLE_INDEX"
  | "RAG_PARTIAL_INDEX"
  | "RAG_INVALID_QUERY"
  | "RAG_SECURITY_BLOCK";

export interface RagErrorInfo {
  code: RagErrorCode;
  message: string;
  at: string;
}

export interface RagStatus {
  state: RagState;
  workspaceRoot: string;
  repoId: string;
  collection?: string;
  generation?: string;
  createdAt?: string;
  updatedAt?: string;
  indexedFiles: number;
  indexedChunks: number;
  staleReason?: string;
  sparse: {
    generation?: string;
    exact: boolean;
    driftFileCount: number;
  };
  preparation?: {
    mode: "worker_threads" | "in_process";
    workers: number;
    logicalCpus: number;
    availableMemoryBytes: number;
    memoryReserveBytes: number;
    workerMemoryBytes: number;
    maxInFlightBytes: number;
    fallbackReason?: string;
  };
  lastError?: RagErrorInfo;
}

export interface SemanticSearchInput {
  query: string;
  limit?: number;
  pathPrefix?: string;
  languages?: string[];
  symbolTypes?: string[];
  includeTests?: boolean;
  includeGenerated?: boolean;
  freshness?: "allow_stale" | "prefer_fresh" | "require_fresh";
}

export interface SemanticSearchHit {
  rank: number;
  path: string;
  startLine: number;
  endLine: number;
  language?: string;
  symbolName?: string;
  symbolType?: string;
  score?: number;
  content: string;
}

export interface SemanticSearchResponse {
  query: string;
  workspaceRoot: string;
  status: RagStatus;
  results: SemanticSearchHit[];
  diagnostics: {
    durationMs: number;
    candidateCount?: number;
    indexGeneration?: string;
    staleReason?: string;
    refreshInProgress?: boolean;
    truncated: boolean;
  };
}

export interface InitializeRagOptions {
  checkFreshness?: boolean;
}
export type IndexingProgressPhase = "scanning" | "preparing" | "indexing" | "finalizing";

export interface IndexingProgress {
  phase: IndexingProgressPhase;
  percent: number;
  totalFiles?: number;
  processedFiles?: number;
  totalChunks?: number;
  processedChunks?: number;
  /** Chunks reused directly from an existing index without re-embedding. */
  reusedChunks?: number;
  /** Chunks freshly embedded/recalculated in this run. */
  recalculatedChunks?: number;
  /** Total chunks requiring recalculation in this run. */
  recalculatedTotal?: number;
  /** Timestamp when this indexing run started. */
  startedAt?: string;
  /** Estimated remaining seconds to completion based on recent processing speed. */
  etaSeconds?: number;
}
export interface RefreshIndexOptions {
  forceSparseRebuild?: boolean;
  transactional?: boolean; // Build an isolated generation so cancellation cannot expose a partial update.
  onProgress?: (progress: IndexingProgress) => void;
}

export interface RebuildIndexOptions {
  reason?: string;
  onProgress?: (progress: IndexingProgress) => void;
}

export interface IndexUpdateSummary {
  status: RagStatus;
  durationMs: number;
  filesScanned: number;
  filesAdded: number;
  filesChanged: number;
  filesDeleted: number;
  filesUnchanged: number;
  chunksEmbedded: number;
  fullRebuild: boolean;
}

export interface ManifestFileEntry {
  hash: string;
  size: number;
  mtimeMs: number;
  chunkCount: number;
  indexedAt: string;
  language: string;
  isTest: boolean;
  isGenerated: boolean;
}

export interface IndexManifest {
  schemaVersion: number;
  repoId: string;
  root: string;
  collection: string;
  generation: string;
  state: "ready" | "partial" | "stale";
  createdAt: string;
  updatedAt: string;
  sourceRevision?: string;
  chunker: {
    name: string;
    version: string;
    defaultChunkLines: number;
    maxChunkLines: number;
  };
  embedding: {
    provider: string;
    model: string;
    version?: string;
    dimensions: number;
    compatibilityGroup?: string;
    modelRevision?: string;
    tokenizerHash?: string;
    pooling?: string;
    normalization?: string;
  };
  sparse: {
    strategy: "frozen-bm25";
    generation: string;
    vocabularyFile: string;
    corpusDocCount: number;
    frozenStatsAt: string;
    driftFileCount: number;
  };
  files: Record<string, ManifestFileEntry>;
  chunkCount: number;
  lastError?: RagErrorInfo;
}

export type {
  RagVectorStore,
  SparseVector,
  StoredChunkPayload,
  StoredVectorPoint,
  VectorPoint,
  VectorSearchFilters,
  VectorSearchResult,
} from "./vector-types.ts";

export interface CodeRagService {
  initialize(options?: InitializeRagOptions): Promise<RagStatus>;
  status(): Promise<RagStatus>;
  search(input: SemanticSearchInput, signal?: AbortSignal): Promise<SemanticSearchResponse>;
  refresh(options?: RefreshIndexOptions, signal?: AbortSignal): Promise<IndexUpdateSummary>;
  rebuild(options?: RebuildIndexOptions, signal?: AbortSignal): Promise<IndexUpdateSummary>;
  dispose(): Promise<void>;
}

export interface WorkspaceCodeRagSettings extends EmbeddingRuntimeSettings {
  enabled: boolean;
  enableTray?: boolean;
  searchMode: "hybrid" | "bm25-only" | "dense-only";
  autoRefresh: boolean;
  allowStaleSearch: boolean;
  remoteBackendsAllowed: boolean;
  qdrantUrl: string;
  qdrantApiKey?: string;
  qdrantBinary: string;
  qdrantDataDirectory: string;
  qdrantStartupTimeoutMs: number;
  defaultLimit: number;
  maxLimit: number;
  maxContextCharacters: number;
  maxResultCharacters: number;
  searchTimeoutMs: number;
  maxFileBytes: number;
  defaultChunkLines: number;
  maxChunkLines: number;
  maxSparseVocabularyTokens: number;
  preparationMaxWorkers: number;
  preparationWorkerMemoryBytes: number;
  preparationMemoryReserveBytes: number;
  encodeBatchSize: number;
  upsertBatchSize: number;
  maxEncodeCharacters: number;
  fullSparseRebuildChangeRatio: number;
  sparseRebuildDriftRatio: number;
  collectionPrefix: string;
}

export interface WorkspaceCodeRagServiceOptions {
  workspaceRoot: string;
  dataDirectory: string;
  userConfigPath?: string;
  repositoryConfigPath?: string;
  settings?: Partial<WorkspaceCodeRagSettings>;
  manageLocalBackends?: boolean;
  allowSearchRefresh?: boolean;
  embeddingProvider?: EmbeddingProvider;
  vectorStore?: RagVectorStore;
  now?: () => Date;
}
