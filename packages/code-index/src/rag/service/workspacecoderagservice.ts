import fs from "node:fs";
import path from "node:path";
import type { BM25Vocabulary } from "../../bm25.ts";
import { getGitInfo } from "../../discover.ts";
import { EmbeddingProviderHttp } from "../../embed/http.ts";
import type { EmbeddingProvider } from "../../embed/provider.ts";
import { QdrantServerManager } from "../../embed/qdrant-server.ts";
import { DEFAULT_WORKSPACE_CODE_RAG_SETTINGS, loadWorkspaceCodeRagSettings } from "../config.ts";
import type { FilePreparationPlan } from "../file-preparation.ts";
import type { FilePreparationResult, FilePreparationTask, ScannedFile } from "../file-preparation-core.ts";
import type {
  CodeRagService,
  IndexingProgress,
  IndexManifest,
  IndexUpdateSummary,
  InitializeRagOptions,
  ManifestFileEntry,
  RagErrorCode,
  RagErrorInfo,
  RagState,
  RagStatus,
  RagVectorStore,
  RebuildIndexOptions,
  RefreshIndexOptions,
  SemanticSearchHit,
  SemanticSearchInput,
  SemanticSearchResponse,
  StoredChunkPayload,
  StoredVectorPoint,
  WorkspaceCodeRagServiceOptions,
  WorkspaceCodeRagSettings,
} from "../types.ts";
import { QdrantVectorStore } from "../vector-store.ts";
import { hashText } from "./helpers.ts";
import type { NormalizedSearchInput, PreparedChunk, PreparedFile, RefreshPlan } from "./types.ts";
import {
  do_assertSpoolCapacity,
  do_createRefreshPlan,
  do_preparationLimits,
  do_preparationTask,
  do_preparedFileFromResult,
  do_processPreparedFiles,
  do_recordPreparationPlan,
  do_refreshPreparedFileIfChanged,
  do_scanWorkspace,
  do_sparseVocabularyTokenLimit,
} from "./workspacecoderagservice-methods/file-preparation.ts";
import {
  do_assertReusableCounts,
  do_encodeAndUpsert,
  do_encodeSpoolAndUpsert,
  do_fallbackRebuildProgress,
  do_isReusablePoint,
  do_performIncrementalRefresh,
  do_refreshSettingsSilently,
  do_reportProgress,
} from "./workspacecoderagservice-methods/incremental-refresh.ts";
import {
  do_dispose,
  do_initialize,
  do_rebuild,
  do_refresh,
  do_search,
  do_status,
} from "./workspacecoderagservice-methods/lifecycle.ts";
import { do_performRebuild } from "./workspacecoderagservice-methods/rebuild.ts";
import { do_runRefresh } from "./workspacecoderagservice-methods/refresh.ts";
import {
  do_collectionName,
  do_createGeneration,
  do_emptySearchResponse,
  do_emptyUpdateSummary,
  do_errorInfo,
  do_startBackgroundRefresh,
  do_summaryForPlan,
  do_vocabularyPath,
} from "./workspacecoderagservice-methods/search-response.ts";
import { do_performSparseGenerationRefresh } from "./workspacecoderagservice-methods/sparse-refresh.ts";
import {
  do_formatHits,
  do_loadVocabulary,
  do_manifestIncompatibility,
  do_normalizeSearchInput,
  do_reloadPersistedState,
  do_snapshotStatus,
  do_updateFastFreshness,
} from "./workspacecoderagservice-methods/state-management.ts";

export class WorkspaceCodeRagService implements CodeRagService {
  public workspaceRoot: string;

  public repoId: string;

  public repositoryDirectory: string;

  public manifestPath: string;

  public settings: WorkspaceCodeRagSettings;

  public embeddingProvider: EmbeddingProvider;

  public vectorStore: RagVectorStore;

  public qdrantServerManager: QdrantServerManager | null;

  public ownsEmbeddingProvider: boolean;

  public ownsVectorStore: boolean;

  public allowSearchRefresh: boolean;

  public now: () => Date;

  public manifest: IndexManifest | undefined;

  public state: RagState = "not_initialized";

  public staleReason: string | undefined;

  public lastError: RagErrorInfo | undefined;

  public configurationError: Error | undefined;

  public initialized = false;

  public disposed = false;

  public refreshPromise: Promise<IndexUpdateSummary> | undefined;

  public refreshController: AbortController | undefined;

  public cachedVocabulary: BM25Vocabulary | undefined;

  public cachedVocabularyGeneration: string | undefined;

  public lastPreparationPlan: FilePreparationPlan | undefined;

  public serviceOptions: WorkspaceCodeRagServiceOptions;

  constructor(options: WorkspaceCodeRagServiceOptions) {
    this.serviceOptions = options;
    this.workspaceRoot = fs.realpathSync(options.workspaceRoot);
    const workspaceStat = fs.statSync(this.workspaceRoot);
    if (!workspaceStat.isDirectory()) throw new Error(`Code RAG workspace is not a directory: ${this.workspaceRoot}`);
    const gitInfo = getGitInfo(this.workspaceRoot);
    this.repoId = hashText(`${this.workspaceRoot}\0${gitInfo.remote}`);
    this.repositoryDirectory = path.join(options.dataDirectory, this.repoId);
    this.manifestPath = path.join(this.repositoryDirectory, "manifest.json");
    this.now = options.now ?? (() => new Date());
    const manageLocalBackends = options.manageLocalBackends ?? true;
    this.allowSearchRefresh = options.allowSearchRefresh ?? true;

    try {
      this.settings = loadWorkspaceCodeRagSettings(options);
    } catch (error) {
      this.settings = { ...DEFAULT_WORKSPACE_CODE_RAG_SETTINGS, enabled: false };
      this.configurationError = error instanceof Error ? error : new Error(String(error));
      this.state = "unavailable";
      this.lastError = this.errorInfo("RAG_BACKEND_UNAVAILABLE", this.configurationError.message);
    }

    this.ownsEmbeddingProvider = options.embeddingProvider === undefined;
    this.embeddingProvider =
      options.embeddingProvider ??
      new EmbeddingProviderHttp(
        this.settings.embeddingServerUrl,
        this.settings.embeddingDimensions,
        manageLocalBackends,
        this.settings.embeddingModel,
        {
          pythonExecutable: this.settings.pythonExecutable,
          startupTimeoutMs: this.settings.embeddingStartupTimeoutMs,
          requestTimeoutMs: this.settings.embeddingTimeoutMs,
          batchSize: this.settings.encodeBatchSize,
        },
      );
    this.ownsVectorStore = options.vectorStore === undefined;
    this.vectorStore =
      options.vectorStore ??
      new QdrantVectorStore({
        url: this.settings.qdrantUrl,
        timeoutMs: this.settings.searchTimeoutMs,
        upsertBatchSize: this.settings.upsertBatchSize,
      });
    const qdrantUrl = new URL(this.settings.qdrantUrl);
    const qdrantPort = Number.parseInt(qdrantUrl.port || "6333", 10);
    const managesLocalQdrant =
      manageLocalBackends &&
      this.ownsVectorStore &&
      ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(qdrantUrl.hostname);
    this.qdrantServerManager = managesLocalQdrant
      ? new QdrantServerManager(qdrantPort, {
          qdrantBinary: this.settings.qdrantBinary,
          dataDirectory: this.settings.qdrantDataDirectory,
          startupTimeoutMs: this.settings.qdrantStartupTimeoutMs,
        })
      : null;
  }

  async initialize(options: InitializeRagOptions = {}): Promise<RagStatus> {
    return do_initialize(this, options);
  }

  async status(): Promise<RagStatus> {
    return do_status(this);
  }

  async search(input: SemanticSearchInput, signal?: AbortSignal): Promise<SemanticSearchResponse> {
    return do_search(this, input, signal);
  }

  async refresh(options: RefreshIndexOptions = {}, signal?: AbortSignal): Promise<IndexUpdateSummary> {
    return do_refresh(this, options, signal);
  }

  async rebuild(options: RebuildIndexOptions = {}, signal?: AbortSignal): Promise<IndexUpdateSummary> {
    return do_rebuild(this, options, signal);
  }

  async dispose(): Promise<void> {
    return do_dispose(this);
  }

  async runRefresh(options: RefreshIndexOptions, signal: AbortSignal): Promise<IndexUpdateSummary> {
    return do_runRefresh(this, options, signal);
  }

  async performRebuild(
    scanned: ScannedFile[],
    plan: RefreshPlan,
    startedAt: number,
    signal: AbortSignal,
    onProgress: RefreshIndexOptions["onProgress"],
  ): Promise<IndexUpdateSummary> {
    return do_performRebuild(this, scanned, plan, startedAt, signal, onProgress);
  }

  async performSparseGenerationRefresh(
    scanned: ScannedFile[],
    plan: RefreshPlan,
    startedAt: number,
    signal: AbortSignal,
    onProgress: RefreshIndexOptions["onProgress"],
  ): Promise<IndexUpdateSummary> {
    return do_performSparseGenerationRefresh(this, scanned, plan, startedAt, signal, onProgress);
  }

  async performIncrementalRefresh(
    plan: RefreshPlan,
    startedAt: number,
    signal: AbortSignal,
    onProgress: RefreshIndexOptions["onProgress"],
  ): Promise<IndexUpdateSummary> {
    return do_performIncrementalRefresh(this, plan, startedAt, signal, onProgress);
  }

  isReusablePoint(point: StoredVectorPoint, entries: Map<string, ManifestFileEntry>): boolean {
    return do_isReusablePoint(this, point, entries);
  }

  assertReusableCounts(entries: Map<string, ManifestFileEntry>, actual: Map<string, number>): void {
    do_assertReusableCounts(this, entries, actual);
  }

  fallbackRebuildProgress(onProgress: RefreshIndexOptions["onProgress"]): RefreshIndexOptions["onProgress"] {
    return do_fallbackRebuildProgress(this, onProgress);
  }

  refreshSettingsSilently(): void {
    do_refreshSettingsSilently(this);
  }

  async encodeSpoolAndUpsert(
    collection: string,
    spoolPath: string,
    totalChunks: number,
    vocabulary: BM25Vocabulary,
    signal: AbortSignal,
    onProgress: (completed: number, total: number) => void,
  ): Promise<void> {
    return do_encodeSpoolAndUpsert(this, collection, spoolPath, totalChunks, vocabulary, signal, onProgress);
  }

  async encodeAndUpsert(
    collection: string,
    chunks: PreparedChunk[],
    vocabulary: BM25Vocabulary,
    signal: AbortSignal,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<void> {
    return do_encodeAndUpsert(this, collection, chunks, vocabulary, signal, onProgress);
  }

  reportProgress(
    onProgress: RefreshIndexOptions["onProgress"],
    phase: IndexingProgress["phase"],
    percent: number,
    filesInfo?: { processedFiles?: number; totalFiles?: number },
    chunksInfo?: {
      processedChunks?: number;
      totalChunks?: number;
      reusedChunks?: number;
      recalculatedChunks?: number;
      recalculatedTotal?: number;
    },
  ): void {
    do_reportProgress(this, onProgress, phase, percent, filesInfo, chunksInfo);
  }

  preparedFileFromResult(result: FilePreparationResult, generation: string): PreparedFile {
    return do_preparedFileFromResult(this, result, generation);
  }

  preparationTask(
    file: Omit<ScannedFile, "hash" | "size" | "mtimeMs">,
    operation: "scan" | "prepare",
  ): FilePreparationTask {
    return do_preparationTask(this, file, operation);
  }

  preparationLimits(): {
    maxWorkers: number;
    workerMemoryBytes: number;
    memoryReserveBytes: number;
  } {
    return do_preparationLimits(this);
  }

  recordPreparationPlan(plan: FilePreparationPlan): void {
    do_recordPreparationPlan(this, plan);
  }

  assertSpoolCapacity(files: ScannedFile[]): void {
    do_assertSpoolCapacity(this, files);
  }

  sparseVocabularyTokenLimit(): number {
    return do_sparseVocabularyTokenLimit(this);
  }

  async processPreparedFiles(
    files: ScannedFile[],
    generation: string,
    signal: AbortSignal,
    onPrepared: (prepared: PreparedFile, index: number) => Promise<void> | void,
  ): Promise<void> {
    return do_processPreparedFiles(this, files, generation, signal, onPrepared);
  }

  async refreshPreparedFileIfChanged(
    prepared: PreparedFile,
    generation: string,
    signal: AbortSignal,
  ): Promise<PreparedFile> {
    return do_refreshPreparedFileIfChanged(this, prepared, generation, signal);
  }

  async scanWorkspace(signal: AbortSignal, onProgress: RefreshIndexOptions["onProgress"]): Promise<ScannedFile[]> {
    return do_scanWorkspace(this, signal, onProgress);
  }

  createRefreshPlan(scanned: ScannedFile[]): RefreshPlan {
    return do_createRefreshPlan(this, scanned);
  }

  updateFastFreshness(): void {
    do_updateFastFreshness(this);
  }

  async reloadPersistedState(): Promise<void> {
    return do_reloadPersistedState(this);
  }

  manifestIncompatibility(manifest: IndexManifest): string | undefined {
    return do_manifestIncompatibility(this, manifest);
  }

  loadVocabulary(manifest: IndexManifest): BM25Vocabulary {
    return do_loadVocabulary(this, manifest);
  }

  normalizeSearchInput(input: SemanticSearchInput): NormalizedSearchInput {
    return do_normalizeSearchInput(this, input);
  }

  formatHits(
    candidates: Array<{ score: number; payload: StoredChunkPayload }>,
    input: NormalizedSearchInput,
  ): { hits: SemanticSearchHit[]; truncated: boolean } {
    return do_formatHits(this, candidates, input);
  }

  snapshotStatus(): RagStatus {
    return do_snapshotStatus(this);
  }

  emptySearchResponse(query: string, startedAt: number): SemanticSearchResponse {
    return do_emptySearchResponse(this, query, startedAt);
  }

  emptyUpdateSummary(fullRebuild: boolean): IndexUpdateSummary {
    return do_emptyUpdateSummary(this, fullRebuild);
  }

  summaryForPlan(
    plan: RefreshPlan,
    startedAt: number,
    chunksEmbedded: number,
    fullRebuild: boolean,
  ): IndexUpdateSummary {
    return do_summaryForPlan(this, plan, startedAt, chunksEmbedded, fullRebuild);
  }

  errorInfo(code: RagErrorCode, message: string): RagErrorInfo {
    return do_errorInfo(this, code, message);
  }

  createGeneration(): string {
    return do_createGeneration(this);
  }

  collectionName(generation: string): string {
    return do_collectionName(this, generation);
  }

  vocabularyPath(generation: string): string {
    return do_vocabularyPath(this, generation);
  }

  startBackgroundRefresh(): void {
    do_startBackgroundRefresh(this);
  }
}
