import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BM25Vocabulary } from "../bm25.ts";
import { chunkFile } from "../chunk.ts";
import { LANG_MAP } from "../config.ts";
import { detectLanguage, discoverFilesWithOptions, getGitInfo } from "../discover.ts";
import { EmbeddingError, VectorStoreError } from "../embed/errors.ts";
import { EmbeddingProviderHttp } from "../embed/http.ts";
import type { EmbeddingProvider } from "../embed/provider.ts";
import { QdrantServerManager } from "../embed/qdrant-server.ts";
import { DEFAULT_WORKSPACE_CODE_RAG_SETTINGS, loadWorkspaceCodeRagSettings } from "./config.ts";
import {
	acquireRepositoryLock,
	CHUNKER_NAME,
	CHUNKER_VERSION,
	INDEX_MANIFEST_SCHEMA_VERSION,
	loadManifest,
	writeManifestAtomic,
} from "./manifest.ts";
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
	VectorPoint,
	WorkspaceCodeRagServiceOptions,
	WorkspaceCodeRagSettings,
} from "./types.ts";
import { QdrantVectorStore } from "./vector-store.ts";

interface ScannedFile {
	absPath: string;
	path: string;
	hash: string;
	size: number;
	mtimeMs: number;
	language: string;
	isTest: boolean;
	isGenerated: boolean;
}

interface PreparedChunk {
	id: string;
	embeddingText: string;
	payload: StoredChunkPayload;
}

interface PreparedFile {
	file: ScannedFile;
	entry: ManifestFileEntry;
	chunks: PreparedChunk[];
}

interface RefreshPlan {
	added: ScannedFile[];
	changed: ScannedFile[];
	deleted: Array<{ path: string; entry: ManifestFileEntry }>;
	unchanged: ScannedFile[];
}

interface NormalizedSearchInput {
	query: string;
	limit: number;
	pathPrefix?: string;
	languages?: string[];
	symbolTypes?: string[];
	includeTests: boolean;
	includeGenerated: boolean;
	freshness: "allow_stale" | "prefer_fresh" | "require_fresh";
}

const KNOWN_LANGUAGES = new Set(Object.values(LANG_MAP));
const KNOWN_SYMBOL_TYPES = new Set(["function", "class", "module", "section", "text"]);
const MAX_CHUNKS_PER_FILE = 2_000;

export class CodeRagError extends Error {
	readonly code: RagErrorCode;

	constructor(code: RagErrorCode, message: string) {
		super(message);
		this.name = "CodeRagError";
		this.code = code;
	}
}

export class WorkspaceCodeRagService implements CodeRagService {
	private workspaceRoot: string;
	private repoId: string;
	private repositoryDirectory: string;
	private manifestPath: string;
	private settings: WorkspaceCodeRagSettings;
	private embeddingProvider: EmbeddingProvider;
	private vectorStore: RagVectorStore;
	private qdrantServerManager: QdrantServerManager | null;
	private ownsEmbeddingProvider: boolean;
	private ownsVectorStore: boolean;
	private allowSearchRefresh: boolean;
	private now: () => Date;
	private manifest: IndexManifest | undefined;
	private state: RagState = "not_initialized";
	private staleReason: string | undefined;
	private lastError: RagErrorInfo | undefined;
	private configurationError: Error | undefined;
	private initialized = false;
	private disposed = false;
	private refreshPromise: Promise<IndexUpdateSummary> | undefined;
	private refreshController: AbortController | undefined;
	private cachedVocabulary: BM25Vocabulary | undefined;
	private cachedVocabularyGeneration: string | undefined;

	constructor(options: WorkspaceCodeRagServiceOptions) {
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
				},
			);
		this.ownsVectorStore = options.vectorStore === undefined;
		this.vectorStore =
			options.vectorStore ??
			new QdrantVectorStore({ url: this.settings.qdrantUrl, timeoutMs: this.settings.searchTimeoutMs });
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
		if (this.disposed) throw new CodeRagError("RAG_BACKEND_UNAVAILABLE", "Code RAG service has been disposed");
		if (this.configurationError) return this.snapshotStatus();
		if (!this.settings.enabled) {
			this.state = "disabled";
			this.initialized = true;
			return this.snapshotStatus();
		}

		await this.qdrantServerManager?.ensureStarted();

		if (!this.refreshPromise) {
			if (!this.initialized) this.state = "initializing";
			try {
				await this.reloadPersistedState();
				if (!this.manifest) {
					return this.snapshotStatus();
				}
				if (this.lastError?.code === "RAG_INCOMPATIBLE_INDEX") return this.snapshotStatus();
			} catch (error) {
				this.initialized = true;
				this.state = "unavailable";
				const mapped =
					error instanceof CodeRagError
						? error
						: new CodeRagError("RAG_INCOMPATIBLE_INDEX", safeErrorMessage(error));
				this.lastError = this.errorInfo(mapped.code, mapped.message);
				return this.snapshotStatus();
			}
		}

		if (options.checkFreshness ?? !this.refreshPromise) this.updateFastFreshness();
		return this.snapshotStatus();
	}

	async status(): Promise<RagStatus> {
		if (!this.initialized) await this.initialize({ checkFreshness: false });
		return this.snapshotStatus();
	}

	async search(input: SemanticSearchInput, signal?: AbortSignal): Promise<SemanticSearchResponse> {
		const startedAt = Date.now();
		const normalized = this.normalizeSearchInput(input);
		await this.initialize({ checkFreshness: true });
		if (signal?.aborted) throw new CodeRagError("RAG_CANCELLED", "Semantic search was cancelled");

		if (this.state === "disabled") {
			return this.emptySearchResponse(normalized.query, startedAt);
		}
		if (!this.manifest) {
			if (normalized.freshness === "require_fresh") {
				if (!this.allowSearchRefresh) return this.emptySearchResponse(normalized.query, startedAt);
				try {
					await this.refresh({}, signal);
				} catch {
					return this.emptySearchResponse(normalized.query, startedAt);
				}
			} else if (normalized.freshness === "prefer_fresh") {
				if (this.allowSearchRefresh) this.startBackgroundRefresh();
				return this.emptySearchResponse(normalized.query, startedAt);
			} else {
				return this.emptySearchResponse(normalized.query, startedAt);
			}
		}

		if ((this.state === "stale" || this.state === "partial") && normalized.freshness === "require_fresh") {
			if (!this.allowSearchRefresh) return this.emptySearchResponse(normalized.query, startedAt);
			try {
				await this.refresh({}, signal);
			} catch {
				return this.emptySearchResponse(normalized.query, startedAt);
			}
		} else if (
			this.allowSearchRefresh &&
			(this.state === "stale" || this.state === "partial") &&
			normalized.freshness === "prefer_fresh"
		) {
			this.startBackgroundRefresh();
		}
		if ((this.state === "stale" || this.state === "partial") && !this.settings.allowStaleSearch) {
			return this.emptySearchResponse(normalized.query, startedAt);
		}
		if (!this.manifest) return this.emptySearchResponse(normalized.query, startedAt);

		const operationSignal = AbortSignal.any([
			AbortSignal.timeout(this.settings.searchTimeoutMs),
			...(signal ? [signal] : []),
		]);
		try {
			const manifest = this.manifest;
			if (!(await this.vectorStore.collectionExists(manifest.collection))) {
				this.state = "stale";
				this.staleReason = "Qdrant collection is missing";
				this.lastError = this.errorInfo("RAG_INCOMPATIBLE_INDEX", this.staleReason);
				return this.emptySearchResponse(normalized.query, startedAt);
			}
			const vocabulary = this.loadVocabulary(manifest);
			const dense = await this.embeddingProvider.encodeQuery(normalized.query, operationSignal);
			const sparse = vocabulary.encode(normalized.query);
			const candidateLimit = Math.max(normalized.limit * 5, 40);
			const candidates = await this.vectorStore.search(
				manifest.collection,
				dense,
				sparse,
				{
					repoId: this.repoId,
					languages: normalized.languages,
					includeTests: normalized.includeTests,
					includeGenerated: normalized.includeGenerated,
				},
				candidateLimit,
			);
			const { hits, truncated } = this.formatHits(candidates, normalized);
			return {
				query: normalized.query,
				workspaceRoot: this.workspaceRoot,
				status: this.snapshotStatus(),
				results: hits,
				diagnostics: {
					durationMs: Date.now() - startedAt,
					candidateCount: candidates.length,
					indexGeneration: manifest.generation,
					staleReason: this.staleReason,
					refreshInProgress: !!this.refreshPromise,
					truncated,
				},
			};
		} catch (error) {
			if (signal?.aborted) throw new CodeRagError("RAG_CANCELLED", "Semantic search was cancelled");
			const mapped = classifySearchError(error);
			// Record the error but don't permanently brick the service.
			// Preserve the previous state so subsequent searches can retry.
			this.lastError = this.errorInfo(mapped.code, mapped.message);
			return this.emptySearchResponse(normalized.query, startedAt);
		}
	}

	async refresh(options: RefreshIndexOptions = {}, signal?: AbortSignal): Promise<IndexUpdateSummary> {
		if (!this.initialized) await this.initialize({ checkFreshness: false });
		if (this.state === "disabled") return this.emptyUpdateSummary(false);
		if (this.configurationError) throw new CodeRagError("RAG_BACKEND_UNAVAILABLE", this.configurationError.message);
		if (signal?.aborted) throw new CodeRagError("RAG_CANCELLED", "Code RAG operation was cancelled");
		if (this.refreshPromise) return waitForSignal(this.refreshPromise, signal);

		this.refreshController = new AbortController();
		const onAbort = () => this.refreshController?.abort(signal?.reason);
		signal?.addEventListener("abort", onAbort, { once: true });
		const operation = this.runRefresh(options, this.refreshController.signal).finally(() => {
			signal?.removeEventListener("abort", onAbort);
			this.refreshPromise = undefined;
			this.refreshController = undefined;
		});
		this.refreshPromise = operation;
		return operation;
	}

	async rebuild(options: RebuildIndexOptions = {}, signal?: AbortSignal): Promise<IndexUpdateSummary> {
		if (this.refreshPromise) return waitForSignal(this.refreshPromise, signal);
		if (!this.initialized) await this.initialize({ checkFreshness: false });
		if (this.state === "disabled") return this.emptyUpdateSummary(true);
		if (signal?.aborted) throw new CodeRagError("RAG_CANCELLED", "Code RAG operation was cancelled");
		this.refreshController = new AbortController();
		const onAbort = () => this.refreshController?.abort(signal?.reason);
		signal?.addEventListener("abort", onAbort, { once: true });
		const operation = this.runRefresh(
			{ forceSparseRebuild: true, onProgress: options.onProgress },
			this.refreshController.signal,
		).finally(() => {
			signal?.removeEventListener("abort", onAbort);
			this.refreshPromise = undefined;
			this.refreshController = undefined;
		});
		this.refreshPromise = operation;
		return operation;
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.refreshController?.abort(new Error("Code RAG service disposed"));
		const qdrantDisposal = this.qdrantServerManager?.stop();
		const embeddingDisposal = this.ownsEmbeddingProvider ? this.embeddingProvider.dispose?.() : undefined;
		const vectorStoreDisposal = this.ownsVectorStore ? this.vectorStore.dispose?.() : undefined;
		try {
			await this.refreshPromise;
		} catch {
			// Cancellation during disposal is expected.
		}
		await Promise.all([qdrantDisposal, embeddingDisposal, vectorStoreDisposal]);
	}

	private async runRefresh(options: RefreshIndexOptions, signal: AbortSignal): Promise<IndexUpdateSummary> {
		const startedAt = Date.now();
		const lock = acquireRepositoryLock(this.repositoryDirectory);
		try {
			await this.reloadPersistedState();
			this.state = this.manifest ? "updating" : "initializing";
			this.reportProgress(options.onProgress, "scanning", 0);
			const scanned = this.scanWorkspace(signal);
			this.reportProgress(options.onProgress, "indexing", 5);
			const plan = this.createRefreshPlan(scanned);
			const changedFileCount = plan.added.length + plan.changed.length + plan.deleted.length;
			const incompatibility = this.manifest
				? this.lastError?.code === "RAG_INCOMPATIBLE_INDEX"
					? this.lastError.message
					: this.manifestIncompatibility(this.manifest)
				: "Index is not initialized";
			if (changedFileCount === 0 && this.manifest && !options.forceSparseRebuild && incompatibility === undefined) {
				for (const file of plan.unchanged) {
					const entry = this.manifest.files[file.path];
					if (entry) this.manifest.files[file.path] = { ...entry, size: file.size, mtimeMs: file.mtimeMs };
				}
				this.manifest.state = "ready";
				this.manifest.updatedAt = this.now().toISOString();
				delete this.manifest.lastError;
				writeManifestAtomic(this.manifestPath, this.manifest);
				this.state = "ready";
				this.staleReason = undefined;
				this.lastError = undefined;
				this.reportProgress(options.onProgress, "finalizing", 100);
				return this.summaryForPlan(plan, startedAt, 0, false);
			}

			const previousFileCount = Object.keys(this.manifest?.files ?? {}).length;
			const changeRatio = changedFileCount / Math.max(previousFileCount, 1);
			if (
				options.forceSparseRebuild ||
				!this.manifest ||
				incompatibility !== undefined ||
				changeRatio > this.settings.fullSparseRebuildChangeRatio
			) {
				return await this.performRebuild(scanned, plan, startedAt, signal, options.onProgress);
			}
			return await this.performIncrementalRefresh(plan, startedAt, signal, options.onProgress);
		} catch (error) {
			const mapped = mapOperationError(error, signal);
			this.lastError = this.errorInfo(mapped.code, mapped.message);
			if (this.manifest) {
				this.state = mapped.code === "RAG_CANCELLED" ? "stale" : "partial";
				this.manifest = {
					...this.manifest,
					state: this.state === "partial" ? "partial" : "stale",
					lastError: this.lastError,
				};
				try {
					writeManifestAtomic(this.manifestPath, this.manifest);
				} catch {
					// Keep the previous on-disk manifest if status persistence fails.
				}
			} else {
				this.state = mapped.code === "RAG_CANCELLED" ? "not_initialized" : "unavailable";
			}
			throw mapped;
		} finally {
			lock.release();
		}
	}

	private async performRebuild(
		scanned: ScannedFile[],
		plan: RefreshPlan,
		startedAt: number,
		signal: AbortSignal,
		onProgress: RefreshIndexOptions["onProgress"],
	): Promise<IndexUpdateSummary> {
		const generation = this.createGeneration();
		const collection = this.collectionName(generation);
		const preparedFiles: PreparedFile[] = [];
		for (const [index, file] of scanned.entries()) {
			preparedFiles.push(this.prepareFile(file, generation, signal));
			this.reportProgress(onProgress, "indexing", 5 + (10 * (index + 1)) / Math.max(scanned.length, 1));
		}
		const vocabulary = new BM25Vocabulary();
		for (const prepared of preparedFiles) {
			for (const chunk of prepared.chunks) vocabulary.register(chunk.payload.content);
		}
		vocabulary.finalize();
		let createdCollection = false;
		try {
			await this.vectorStore.createCollection(collection, this.settings.embeddingDimensions);
			createdCollection = true;
			const chunks = preparedFiles.flatMap((file) => file.chunks);
			await this.encodeAndUpsert(collection, chunks, vocabulary, signal, (completed, total) => {
				this.reportProgress(onProgress, "indexing", 15 + (80 * completed) / Math.max(total, 1));
			});
			this.reportProgress(onProgress, "finalizing", 95);
			const now = this.now().toISOString();
			const vocabularyPath = this.vocabularyPath(generation);
			vocabulary.save(vocabularyPath);
			const previousManifest = this.manifest;
			const manifest: IndexManifest = {
				schemaVersion: INDEX_MANIFEST_SCHEMA_VERSION,
				repoId: this.repoId,
				root: this.workspaceRoot,
				collection,
				generation,
				state: "ready",
				createdAt: now,
				updatedAt: now,
				sourceRevision: getGitInfo(this.workspaceRoot).commit || undefined,
				chunker: {
					name: CHUNKER_NAME,
					version: CHUNKER_VERSION,
					defaultChunkLines: this.settings.defaultChunkLines,
					maxChunkLines: this.settings.maxChunkLines,
				},
				embedding: {
					provider: "local-python-http",
					model: this.settings.embeddingModel,
					dimensions: this.settings.embeddingDimensions,
				},
				sparse: {
					strategy: "frozen-bm25",
					generation,
					vocabularyFile: path.basename(vocabularyPath),
					corpusDocCount: vocabulary.totalDocs,
					frozenStatsAt: now,
					driftFileCount: 0,
				},
				files: Object.fromEntries(preparedFiles.map((file) => [file.file.path, file.entry])),
				chunkCount: chunks.length,
			};
			writeManifestAtomic(this.manifestPath, manifest);
			this.manifest = manifest;
			this.state = "ready";
			this.staleReason = undefined;
			this.lastError = undefined;
			this.cachedVocabulary = vocabulary;
			this.cachedVocabularyGeneration = generation;

			if (previousManifest && previousManifest.collection !== collection) {
				try {
					await this.vectorStore.deleteCollection(previousManifest.collection);
				} catch {
					// The new manifest is already committed; old-generation cleanup is best effort.
				}
				const oldVocabularyPath = path.join(this.repositoryDirectory, previousManifest.sparse.vocabularyFile);
				try {
					fs.unlinkSync(oldVocabularyPath);
				} catch (error) {
					if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
						// Old local vocabulary cleanup is best effort.
					}
				}
			}
			this.reportProgress(onProgress, "finalizing", 100);
			return this.summaryForPlan(plan, startedAt, chunks.length, true);
		} catch (error) {
			if (createdCollection) {
				try {
					await this.vectorStore.deleteCollection(collection);
				} catch {
					// Preserve the original failure.
				}
			}
			throw error;
		}
	}

	private async performIncrementalRefresh(
		plan: RefreshPlan,
		startedAt: number,
		signal: AbortSignal,
		onProgress: RefreshIndexOptions["onProgress"],
	): Promise<IndexUpdateSummary> {
		if (!this.manifest) throw new CodeRagError("RAG_NOT_INITIALIZED", "Code RAG index is not initialized");
		const status = await this.vectorStore.collectionStatus(this.manifest.collection);
		if (status.dimensions !== this.settings.embeddingDimensions) {
			throw new CodeRagError("RAG_INCOMPATIBLE_INDEX", "Stored vector dimensions are incompatible");
		}
		const vocabulary = this.loadVocabulary(this.manifest);
		const nextManifest = structuredClone(this.manifest);
		const indexedAt = this.now().toISOString();
		let chunksEmbedded = 0;
		let completedFiles = 0;
		const changedFiles = [...plan.added, ...plan.changed];
		const totalFiles = changedFiles.length + plan.deleted.length;

		for (const file of changedFiles) {
			if (signal.aborted) throw signal.reason ?? new Error("Code RAG refresh cancelled");
			const prepared = this.prepareFile(file, nextManifest.generation, signal);
			await this.encodeAndUpsert(
				nextManifest.collection,
				prepared.chunks,
				vocabulary,
				signal,
				(completed, total) => {
					const currentFileProgress = total === 0 ? 1 : completed / total;
					this.reportProgress(
						onProgress,
						"indexing",
						5 + (90 * (completedFiles + currentFileProgress)) / Math.max(totalFiles, 1),
					);
				},
			);
			await this.vectorStore.deleteFileVersions(
				nextManifest.collection,
				this.repoId,
				fileIdFor(this.repoId, file.path),
				prepared.chunks.length > 0 ? file.hash : undefined,
			);
			nextManifest.files[file.path] = prepared.entry;
			chunksEmbedded += prepared.chunks.length;
			completedFiles += 1;
			this.reportProgress(onProgress, "indexing", 5 + (90 * completedFiles) / Math.max(totalFiles, 1));
		}
		for (const deleted of plan.deleted) {
			if (signal.aborted) throw signal.reason ?? new Error("Code RAG refresh cancelled");
			await this.vectorStore.deleteFileVersions(
				nextManifest.collection,
				this.repoId,
				fileIdFor(this.repoId, deleted.path),
			);
			delete nextManifest.files[deleted.path];
			completedFiles += 1;
			this.reportProgress(onProgress, "indexing", 5 + (90 * completedFiles) / Math.max(totalFiles, 1));
		}
		for (const file of plan.unchanged) {
			const entry = nextManifest.files[file.path];
			if (entry) nextManifest.files[file.path] = { ...entry, size: file.size, mtimeMs: file.mtimeMs };
		}

		this.reportProgress(onProgress, "finalizing", 95);
		nextManifest.state = "ready";
		nextManifest.updatedAt = indexedAt;
		nextManifest.sourceRevision = getGitInfo(this.workspaceRoot).commit || undefined;
		nextManifest.chunkCount = Object.values(nextManifest.files).reduce((total, file) => total + file.chunkCount, 0);
		nextManifest.sparse.driftFileCount += plan.added.length + plan.changed.length + plan.deleted.length;
		delete nextManifest.lastError;
		writeManifestAtomic(this.manifestPath, nextManifest);
		this.manifest = nextManifest;
		this.state = "ready";
		this.staleReason = undefined;
		this.lastError = undefined;
		this.reportProgress(onProgress, "finalizing", 100);
		return this.summaryForPlan(plan, startedAt, chunksEmbedded, false);
	}

	private async encodeAndUpsert(
		collection: string,
		chunks: PreparedChunk[],
		vocabulary: BM25Vocabulary,
		signal: AbortSignal,
		onProgress?: (completed: number, total: number) => void,
	): Promise<void> {
		// Ensure embedding provider is ready (auto-start if needed)
		if (this.embeddingProvider.ensureReady) await this.embeddingProvider.ensureReady(signal);
		for (let offset = 0; offset < chunks.length; offset += this.settings.encodeBatchSize) {
			if (signal.aborted) throw signal.reason ?? new Error("Code RAG refresh cancelled");
			const batch = chunks.slice(offset, offset + this.settings.encodeBatchSize);
			const denseVectors = await this.embeddingProvider.encode(
				batch.map((chunk) => chunk.embeddingText),
				signal,
			);
			if (denseVectors.length !== batch.length) throw new Error("Embedding provider returned an incomplete batch");
			const points: VectorPoint[] = batch.map((chunk, index) => ({
				id: chunk.id,
				vectors: {
					dense: Array.from(denseVectors[index]),
					sparse: vocabulary.encode(chunk.payload.content),
				},
				payload: chunk.payload,
			}));
			for (let pointOffset = 0; pointOffset < points.length; pointOffset += this.settings.upsertBatchSize) {
				await this.vectorStore.upsert(
					collection,
					points.slice(pointOffset, pointOffset + this.settings.upsertBatchSize),
				);
			}
			onProgress?.(Math.min(offset + batch.length, chunks.length), chunks.length);
		}
		if (chunks.length === 0) onProgress?.(0, 0);
	}

	private reportProgress(
		onProgress: RefreshIndexOptions["onProgress"],
		phase: IndexingProgress["phase"],
		percent: number,
	): void {
		try {
			onProgress?.({ phase, percent: Math.max(0, Math.min(100, Math.round(percent))) });
		} catch {
			// Progress reporting must not interrupt indexing.
		}
	}

	private prepareFile(file: ScannedFile, generation: string, signal: AbortSignal): PreparedFile {
		if (signal.aborted) throw signal.reason ?? new Error("Code RAG refresh cancelled");
		const content = fs.readFileSync(file.absPath, "utf-8");
		if (hashText(content) !== file.hash) throw new Error(`File changed while indexing: ${file.path}`);
		const chunks = chunkFile(content, file.language, this.settings.defaultChunkLines, this.settings.maxChunkLines);
		if (chunks.length > MAX_CHUNKS_PER_FILE) {
			throw new CodeRagError("RAG_SECURITY_BLOCK", `File produced too many chunks: ${file.path}`);
		}
		const indexedAt = this.now().toISOString();
		const fileId = fileIdFor(this.repoId, file.path);
		const preparedChunks = chunks.map((chunk, ordinal) => {
			const chunkHash = hashText(chunk.text);
			const payload: StoredChunkPayload = {
				repoId: this.repoId,
				fileId,
				path: file.path,
				language: file.language,
				symbolName: chunk.symbol,
				symbolType: chunk.chunkType,
				startLine: chunk.startLine,
				endLine: chunk.endLine,
				fileHash: file.hash,
				chunkHash,
				chunkOrdinal: ordinal,
				chunkerVersion: CHUNKER_VERSION,
				indexGeneration: generation,
				isTest: file.isTest,
				isGenerated: file.isGenerated,
				content: chunk.text,
				indexedAt,
			};
			return {
				id: chunkPointId(this.repoId, fileId, file.hash, ordinal, chunkHash),
				embeddingText: chunk.text.slice(0, this.settings.maxEncodeCharacters),
				payload,
			};
		});
		return {
			file,
			entry: {
				hash: file.hash,
				size: file.size,
				mtimeMs: file.mtimeMs,
				chunkCount: preparedChunks.length,
				indexedAt,
				language: file.language,
				isTest: file.isTest,
				isGenerated: file.isGenerated,
			},
			chunks: preparedChunks,
		};
	}

	private scanWorkspace(signal: AbortSignal): ScannedFile[] {
		const files = discoverFilesWithOptions(this.workspaceRoot, { maxFileSize: this.settings.maxFileBytes });
		return files.map((absPath) => {
			if (signal.aborted) throw signal.reason ?? new Error("Code RAG refresh cancelled");
			const stat = fs.statSync(absPath);
			const relativePath = normalizeRepositoryPath(path.relative(this.workspaceRoot, absPath));
			return {
				absPath,
				path: relativePath,
				hash: hashText(fs.readFileSync(absPath)),
				size: stat.size,
				mtimeMs: stat.mtimeMs,
				language: detectLanguage(absPath),
				isTest: isTestPath(relativePath),
				isGenerated: isGeneratedPath(relativePath),
			};
		});
	}

	private createRefreshPlan(scanned: ScannedFile[]): RefreshPlan {
		const previous = this.manifest?.files ?? {};
		const currentPaths = new Set(scanned.map((file) => file.path));
		const added: ScannedFile[] = [];
		const changed: ScannedFile[] = [];
		const unchanged: ScannedFile[] = [];
		for (const file of scanned) {
			const prior = previous[file.path];
			if (!prior) added.push(file);
			else if (prior.hash !== file.hash) changed.push(file);
			else unchanged.push(file);
		}
		const deleted = Object.entries(previous)
			.filter(([filePath]) => !currentPaths.has(filePath))
			.map(([filePath, entry]) => ({ path: filePath, entry }));
		return { added, changed, deleted, unchanged };
	}

	private updateFastFreshness(): void {
		if (!this.manifest || this.state === "unavailable" || this.state === "disabled") return;
		try {
			const files = discoverFilesWithOptions(this.workspaceRoot, { maxFileSize: this.settings.maxFileBytes });
			if (files.length !== Object.keys(this.manifest.files).length) {
				this.state = "stale";
				this.staleReason = "The indexed file set changed";
				return;
			}
			for (const absPath of files) {
				const relativePath = normalizeRepositoryPath(path.relative(this.workspaceRoot, absPath));
				const entry = this.manifest.files[relativePath];
				const stat = fs.statSync(absPath);
				if (!entry || entry.size !== stat.size || entry.mtimeMs !== stat.mtimeMs) {
					this.state = "stale";
					this.staleReason = `File changed: ${relativePath}`;
					return;
				}
			}
			this.state = this.manifest.state;
			this.staleReason = undefined;
		} catch (error) {
			this.state = "unavailable";
			this.lastError = this.errorInfo("RAG_BACKEND_UNAVAILABLE", safeErrorMessage(error));
		}
	}

	private async reloadPersistedState(): Promise<void> {
		fs.mkdirSync(this.repositoryDirectory, { recursive: true, mode: 0o700 });
		const persisted = loadManifest(this.manifestPath);
		if (persisted?.generation !== this.manifest?.generation) {
			this.cachedVocabulary = undefined;
			this.cachedVocabularyGeneration = undefined;
		}
		this.manifest = persisted;
		this.initialized = true;
		this.staleReason = undefined;
		if (!persisted) {
			this.state = "not_initialized";
			this.lastError = undefined;
			return;
		}
		const incompatibility = this.manifestIncompatibility(persisted);
		if (incompatibility) {
			this.state = "stale";
			this.staleReason = incompatibility;
			this.lastError = this.errorInfo("RAG_INCOMPATIBLE_INDEX", incompatibility);
			return;
		}
		let collectionExists: boolean;
		try {
			collectionExists = await this.vectorStore.collectionExists(persisted.collection);
		} catch (error) {
			throw new CodeRagError("RAG_BACKEND_UNAVAILABLE", safeErrorMessage(error));
		}
		if (!collectionExists) {
			this.state = "stale";
			this.staleReason = "Qdrant collection is missing";
			this.lastError = this.errorInfo("RAG_INCOMPATIBLE_INDEX", this.staleReason);
			return;
		}
		this.state = persisted.state;
		this.lastError = persisted.lastError;
	}

	private manifestIncompatibility(manifest: IndexManifest): string | undefined {
		if (manifest.schemaVersion !== INDEX_MANIFEST_SCHEMA_VERSION) return "Index schema changed";
		if (manifest.repoId !== this.repoId || manifest.root !== this.workspaceRoot) return "Repository identity changed";
		if (manifest.chunker.name !== CHUNKER_NAME || manifest.chunker.version !== CHUNKER_VERSION) {
			return "Chunker version changed";
		}
		if (
			manifest.chunker.defaultChunkLines !== this.settings.defaultChunkLines ||
			manifest.chunker.maxChunkLines !== this.settings.maxChunkLines
		) {
			return "Chunker settings changed";
		}
		if (
			manifest.embedding.model !== this.settings.embeddingModel ||
			manifest.embedding.dimensions !== this.settings.embeddingDimensions
		) {
			return "Embedding model or dimensions changed";
		}
		if (!manifest.sparse.vocabularyFile) return "Sparse vocabulary metadata is missing";
		const vocabularyPath = path.join(this.repositoryDirectory, manifest.sparse.vocabularyFile);
		if (!fs.existsSync(vocabularyPath)) return "Sparse vocabulary file is missing";
		return undefined;
	}

	private loadVocabulary(manifest: IndexManifest): BM25Vocabulary {
		if (this.cachedVocabulary && this.cachedVocabularyGeneration === manifest.sparse.generation) {
			return this.cachedVocabulary;
		}
		const vocabularyPath = path.join(this.repositoryDirectory, manifest.sparse.vocabularyFile);
		if (!fs.existsSync(vocabularyPath))
			throw new CodeRagError("RAG_INCOMPATIBLE_INDEX", "Sparse vocabulary is missing");
		this.cachedVocabulary = BM25Vocabulary.load(vocabularyPath);
		this.cachedVocabularyGeneration = manifest.sparse.generation;
		return this.cachedVocabulary;
	}

	private normalizeSearchInput(input: SemanticSearchInput): NormalizedSearchInput {
		const query = input.query.trim();
		if (!query) throw new CodeRagError("RAG_INVALID_QUERY", "Semantic search query must not be empty");
		const requestedLimit = input.limit ?? this.settings.defaultLimit;
		const limit = Math.min(this.settings.maxLimit, Math.max(1, Math.floor(requestedLimit)));
		let pathPrefix: string | undefined;
		if (input.pathPrefix !== undefined) {
			pathPrefix = normalizePathFilter(input.pathPrefix);
		}
		const languages = input.languages?.map((language) => language.toLowerCase());
		for (const language of languages ?? []) {
			if (!KNOWN_LANGUAGES.has(language))
				throw new CodeRagError("RAG_INVALID_QUERY", `Unknown language filter: ${language}`);
		}
		const symbolTypes = input.symbolTypes?.map((symbolType) => symbolType.toLowerCase());
		for (const symbolType of symbolTypes ?? []) {
			if (!KNOWN_SYMBOL_TYPES.has(symbolType)) {
				throw new CodeRagError("RAG_INVALID_QUERY", `Unknown symbol type filter: ${symbolType}`);
			}
		}
		return {
			query,
			limit,
			pathPrefix,
			languages: languages && languages.length > 0 ? [...new Set(languages)] : undefined,
			symbolTypes: symbolTypes && symbolTypes.length > 0 ? [...new Set(symbolTypes)] : undefined,
			includeTests: input.includeTests ?? true,
			includeGenerated: input.includeGenerated ?? false,
			freshness: input.freshness ?? "prefer_fresh",
		};
	}

	private formatHits(
		candidates: Array<{ score: number; payload: StoredChunkPayload }>,
		input: NormalizedSearchInput,
	): { hits: SemanticSearchHit[]; truncated: boolean } {
		const hits: SemanticSearchHit[] = [];
		const seen = new Set<string>();
		const perFile = new Map<string, number>();
		let characters = 0;
		let truncated = false;
		for (const candidate of candidates) {
			const payload = candidate.payload;
			if (input.pathPrefix && payload.path !== input.pathPrefix && !payload.path.startsWith(`${input.pathPrefix}/`))
				continue;
			if (input.symbolTypes && !input.symbolTypes.includes(payload.symbolType)) continue;
			const dedupeKey = `${payload.path}:${payload.startLine}:${payload.endLine}:${payload.chunkHash}`;
			if (seen.has(dedupeKey) || (perFile.get(payload.path) ?? 0) >= 3) continue;
			let content = payload.content;
			if (content.length > this.settings.maxResultCharacters) {
				content = `${content.slice(0, this.settings.maxResultCharacters)}\n[snippet truncated]`;
				truncated = true;
			}
			if (characters + content.length > this.settings.maxContextCharacters) {
				truncated = true;
				break;
			}
			seen.add(dedupeKey);
			perFile.set(payload.path, (perFile.get(payload.path) ?? 0) + 1);
			characters += content.length;
			hits.push({
				rank: hits.length + 1,
				path: payload.path,
				startLine: payload.startLine,
				endLine: payload.endLine,
				language: payload.language,
				symbolName: payload.symbolName || undefined,
				symbolType: payload.symbolType,
				score: candidate.score,
				content,
			});
			if (hits.length >= input.limit) break;
		}
		return { hits, truncated };
	}

	private snapshotStatus(): RagStatus {
		return {
			state: this.state,
			workspaceRoot: this.workspaceRoot,
			repoId: this.repoId,
			collection: this.manifest?.collection,
			generation: this.manifest?.generation,
			createdAt: this.manifest?.createdAt,
			updatedAt: this.manifest?.updatedAt,
			indexedFiles: Object.keys(this.manifest?.files ?? {}).length,
			indexedChunks: this.manifest?.chunkCount ?? 0,
			staleReason: this.staleReason,
			sparse: {
				generation: this.manifest?.sparse.generation,
				exact: (this.manifest?.sparse.driftFileCount ?? 0) === 0,
				driftFileCount: this.manifest?.sparse.driftFileCount ?? 0,
			},
			lastError: this.lastError,
		};
	}

	private emptySearchResponse(query: string, startedAt: number): SemanticSearchResponse {
		return {
			query,
			workspaceRoot: this.workspaceRoot,
			status: this.snapshotStatus(),
			results: [],
			diagnostics: {
				durationMs: Date.now() - startedAt,
				indexGeneration: this.manifest?.generation,
				staleReason: this.staleReason,
				truncated: false,
			},
		};
	}

	private emptyUpdateSummary(fullRebuild: boolean): IndexUpdateSummary {
		return {
			status: this.snapshotStatus(),
			durationMs: 0,
			filesScanned: 0,
			filesAdded: 0,
			filesChanged: 0,
			filesDeleted: 0,
			filesUnchanged: 0,
			chunksEmbedded: 0,
			fullRebuild,
		};
	}

	private summaryForPlan(
		plan: RefreshPlan,
		startedAt: number,
		chunksEmbedded: number,
		fullRebuild: boolean,
	): IndexUpdateSummary {
		return {
			status: this.snapshotStatus(),
			durationMs: Date.now() - startedAt,
			filesScanned: plan.added.length + plan.changed.length + plan.unchanged.length,
			filesAdded: plan.added.length,
			filesChanged: plan.changed.length,
			filesDeleted: plan.deleted.length,
			filesUnchanged: plan.unchanged.length,
			chunksEmbedded,
			fullRebuild,
		};
	}

	private errorInfo(code: RagErrorCode, message: string): RagErrorInfo {
		return { code, message: message.slice(0, 500), at: this.now().toISOString() };
	}

	private createGeneration(): string {
		return `${this.now().getTime().toString(36)}-${randomBytes(4).toString("hex")}`;
	}

	private collectionName(generation: string): string {
		const prefix = this.settings.collectionPrefix.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
		return `${prefix}_${this.repoId.slice(0, 16)}_${generation.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
	}

	private vocabularyPath(generation: string): string {
		return path.join(this.repositoryDirectory, `bm25-${generation}.json`);
	}

	private startBackgroundRefresh(): void {
		if (!this.settings.autoRefresh || this.refreshPromise) return;
		void this.refresh().catch(() => undefined);
	}
}

function normalizeRepositoryPath(value: string): string {
	return value.split(path.sep).join("/");
}

function normalizePathFilter(value: string): string {
	const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
	if (!normalized || path.posix.isAbsolute(normalized) || /^[a-zA-Z]:\//.test(normalized)) {
		throw new CodeRagError("RAG_SECURITY_BLOCK", "Path filter must be repository-relative");
	}
	const clean = path.posix.normalize(normalized);
	if (clean === ".." || clean.startsWith("../")) {
		throw new CodeRagError("RAG_SECURITY_BLOCK", "Path filter cannot escape the repository");
	}
	return clean;
}

function hashText(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function fileIdFor(repoId: string, relativePath: string): string {
	return hashText(`${repoId}\0${relativePath}`);
}

function chunkPointId(repoId: string, fileId: string, fileHash: string, ordinal: number, chunkHash: string): string {
	const digest = hashText(`${repoId}\0${fileId}\0${fileHash}\0${ordinal}\0${chunkHash}`).slice(0, 32).split("");
	digest[12] = "4";
	digest[16] = "8";
	const hex = digest.join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isTestPath(relativePath: string): boolean {
	return /(^|\/)(__tests__|tests?|spec)(\/|$)/i.test(relativePath) || /\.(test|spec)\.[^/]+$/i.test(relativePath);
}

function isGeneratedPath(relativePath: string): boolean {
	return (
		/(^|\/)(generated|gen)(\/|$)/i.test(relativePath) || /(^|\.)generated\./i.test(path.posix.basename(relativePath))
	);
}

function safeErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

function classifySearchError(error: unknown): { code: RagErrorCode; message: string } {
	if (error instanceof EmbeddingError) {
		if (error.type === "server_down") {
			return { code: "RAG_EMBEDDING_SERVER_DOWN", message: error.message };
		}
		if (error.type === "server_error") {
			return { code: "RAG_EMBEDDING_SERVER_ERROR", message: error.message };
		}
		return { code: "RAG_EMBEDDING_SERVER_ERROR", message: error.message };
	}
	if (error instanceof VectorStoreError) {
		if (error.type === "qdrant_down") {
			return { code: "RAG_QDRANT_DOWN", message: error.message };
		}
		if (error.type === "network") {
			return { code: "RAG_NETWORK_ERROR", message: error.message };
		}
		return { code: "RAG_QDRANT_ERROR", message: error.message };
	}
	if (error instanceof Error && error.name === "TimeoutError") {
		return { code: "RAG_TIMEOUT", message: "Code RAG search timed out" };
	}
	return { code: "RAG_NETWORK_ERROR", message: safeErrorMessage(error) };
}

function mapOperationError(error: unknown, signal: AbortSignal): CodeRagError {
	if (error instanceof CodeRagError) return error;
	if (signal.aborted) return new CodeRagError("RAG_CANCELLED", "Code RAG refresh was cancelled");
	if (error instanceof Error && error.name === "TimeoutError") {
		return new CodeRagError("RAG_TIMEOUT", "Code RAG operation timed out");
	}
	return new CodeRagError("RAG_BACKEND_UNAVAILABLE", safeErrorMessage(error));
}

function waitForSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(new CodeRagError("RAG_CANCELLED", "Code RAG operation was cancelled"));
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(new CodeRagError("RAG_CANCELLED", "Code RAG operation was cancelled"));
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}
