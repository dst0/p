import type {
  IndexUpdateSummary,
  InitializeRagOptions,
  RagStatus,
  RebuildIndexOptions,
  RefreshIndexOptions,
  SemanticSearchInput,
  SemanticSearchResponse,
} from "../../types.ts";
import { CodeRagError } from "../coderagerror.ts";
import { classifySearchError, safeErrorMessage, waitForSignal } from "../helpers.ts";
import type { WorkspaceCodeRagService } from "../workspacecoderagservice.ts";

export async function do_initialize(
  self: WorkspaceCodeRagService,
  options: InitializeRagOptions = {},
): Promise<RagStatus> {
  if (self.disposed) throw new CodeRagError("RAG_BACKEND_UNAVAILABLE", "Code RAG service has been disposed");
  if (self.configurationError) return self.snapshotStatus();
  if (!self.settings.enabled) {
    self.state = "disabled";
    self.initialized = true;
    return self.snapshotStatus();
  }

  await self.qdrantServerManager?.ensureStarted();

  if (!self.refreshPromise) {
    if (!self.initialized) self.state = "initializing";
    try {
      await self.reloadPersistedState();
      if (!self.manifest) {
        return self.snapshotStatus();
      }
      if (self.lastError?.code === "RAG_INCOMPATIBLE_INDEX") return self.snapshotStatus();
    } catch (error) {
      self.initialized = true;
      self.state = "unavailable";
      const mapped =
        error instanceof CodeRagError ? error : new CodeRagError("RAG_INCOMPATIBLE_INDEX", safeErrorMessage(error));
      self.lastError = self.errorInfo(mapped.code, mapped.message);
      return self.snapshotStatus();
    }
  }

  if (options.checkFreshness ?? !self.refreshPromise) self.updateFastFreshness();
  return self.snapshotStatus();
}

export async function do_status(self: WorkspaceCodeRagService): Promise<RagStatus> {
  if (!self.initialized) await self.initialize({ checkFreshness: false });
  return self.snapshotStatus();
}

export async function do_search(
  self: WorkspaceCodeRagService,
  input: SemanticSearchInput,
  signal?: AbortSignal,
): Promise<SemanticSearchResponse> {
  const startedAt = Date.now();
  const normalized = self.normalizeSearchInput(input);
  await self.initialize({ checkFreshness: true });
  if (signal?.aborted) throw new CodeRagError("RAG_CANCELLED", "Semantic search was cancelled");

  if (self.state === "disabled") {
    return self.emptySearchResponse(normalized.query, startedAt);
  }
  if (!self.manifest) {
    if (normalized.freshness === "require_fresh") {
      if (!self.allowSearchRefresh) return self.emptySearchResponse(normalized.query, startedAt);
      try {
        await self.refresh({}, signal);
      } catch {
        return self.emptySearchResponse(normalized.query, startedAt);
      }
    } else if (normalized.freshness === "prefer_fresh") {
      if (self.allowSearchRefresh) self.startBackgroundRefresh();
      return self.emptySearchResponse(normalized.query, startedAt);
    } else {
      return self.emptySearchResponse(normalized.query, startedAt);
    }
  }

  if ((self.state === "stale" || self.state === "partial") && normalized.freshness === "require_fresh") {
    if (!self.allowSearchRefresh) return self.emptySearchResponse(normalized.query, startedAt);
    try {
      await self.refresh({}, signal);
    } catch {
      return self.emptySearchResponse(normalized.query, startedAt);
    }
  } else if (
    self.allowSearchRefresh &&
    (self.state === "stale" || self.state === "partial") &&
    normalized.freshness === "prefer_fresh"
  ) {
    self.startBackgroundRefresh();
  }
  if ((self.state === "stale" || self.state === "partial") && !self.settings.allowStaleSearch) {
    return self.emptySearchResponse(normalized.query, startedAt);
  }
  if (!self.manifest) return self.emptySearchResponse(normalized.query, startedAt);

  const operationSignal = AbortSignal.any([
    AbortSignal.timeout(self.settings.searchTimeoutMs),
    ...(signal ? [signal] : []),
  ]);
  try {
    const manifest = self.manifest;
    if (!(await self.vectorStore.collectionExists(manifest.collection))) {
      self.state = "stale";
      self.staleReason = "Qdrant collection is missing";
      self.lastError = self.errorInfo("RAG_INCOMPATIBLE_INDEX", self.staleReason);
      return self.emptySearchResponse(normalized.query, startedAt);
    }
    const vocabulary = self.loadVocabulary(manifest);
    const dense =
      self.settings.searchMode === "bm25-only"
        ? new Float32Array(0)
        : await self.embeddingProvider.encodeQuery(normalized.query, operationSignal);
    const sparse = vocabulary.encode(normalized.query);
    const candidateLimit = Math.max(normalized.limit * 5, 40);
    const candidates = await self.vectorStore.search(
      manifest.collection,
      dense,
      sparse,
      {
        repoId: self.repoId,
        languages: normalized.languages,
        includeTests: normalized.includeTests,
        includeGenerated: normalized.includeGenerated,
      },
      candidateLimit,
    );
    const { hits, truncated } = self.formatHits(candidates, normalized);
    return {
      query: normalized.query,
      workspaceRoot: self.workspaceRoot,
      status: self.snapshotStatus(),
      results: hits,
      diagnostics: {
        durationMs: Date.now() - startedAt,
        candidateCount: candidates.length,
        indexGeneration: manifest.generation,
        staleReason: self.staleReason,
        refreshInProgress: !!self.refreshPromise,
        truncated,
      },
    };
  } catch (error) {
    if (signal?.aborted) throw new CodeRagError("RAG_CANCELLED", "Semantic search was cancelled");
    const mapped = classifySearchError(error);
    // Record the error but don't permanently brick the service.
    // Preserve the previous state so subsequent searches can retry.
    self.lastError = self.errorInfo(mapped.code, mapped.message);
    return self.emptySearchResponse(normalized.query, startedAt);
  }
}

export async function do_refresh(
  self: WorkspaceCodeRagService,
  options: RefreshIndexOptions = {},
  signal?: AbortSignal,
): Promise<IndexUpdateSummary> {
  if (!self.initialized) await self.initialize({ checkFreshness: false });
  if (self.state === "disabled") return self.emptyUpdateSummary(false);
  if (self.configurationError) throw new CodeRagError("RAG_BACKEND_UNAVAILABLE", self.configurationError.message);
  if (signal?.aborted) throw new CodeRagError("RAG_CANCELLED", "Code RAG operation was cancelled");
  if (self.refreshPromise) return waitForSignal(self.refreshPromise, signal);

  self.refreshController = new AbortController();
  const onAbort = () => self.refreshController?.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const operation = self.runRefresh(options, self.refreshController.signal).finally(() => {
    signal?.removeEventListener("abort", onAbort);
    self.refreshPromise = undefined;
    self.refreshController = undefined;
  });
  self.refreshPromise = operation;
  return operation;
}

export async function do_rebuild(
  self: WorkspaceCodeRagService,
  options: RebuildIndexOptions = {},
  signal?: AbortSignal,
): Promise<IndexUpdateSummary> {
  if (self.refreshPromise) return waitForSignal(self.refreshPromise, signal);
  if (!self.initialized) await self.initialize({ checkFreshness: false });
  if (self.state === "disabled") return self.emptyUpdateSummary(true);
  if (signal?.aborted) throw new CodeRagError("RAG_CANCELLED", "Code RAG operation was cancelled");
  self.refreshController = new AbortController();
  const onAbort = () => self.refreshController?.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const operation = self
    .runRefresh({ forceSparseRebuild: true, onProgress: options.onProgress }, self.refreshController.signal)
    .finally(() => {
      signal?.removeEventListener("abort", onAbort);
      self.refreshPromise = undefined;
      self.refreshController = undefined;
    });
  self.refreshPromise = operation;
  return operation;
}

export async function do_dispose(self: WorkspaceCodeRagService): Promise<void> {
  if (self.disposed) return;
  self.disposed = true;
  self.refreshController?.abort(new Error("Code RAG service disposed"));
  const qdrantDisposal = self.qdrantServerManager?.stop();
  const embeddingDisposal = self.ownsEmbeddingProvider ? self.embeddingProvider.dispose?.() : undefined;
  const vectorStoreDisposal = self.ownsVectorStore ? self.vectorStore.dispose?.() : undefined;
  try {
    await self.refreshPromise;
  } catch {
    // Cancellation during disposal is expected.
  }
  await Promise.all([qdrantDisposal, embeddingDisposal, vectorStoreDisposal]);
}
