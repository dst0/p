import { acquireRepositoryLock, writeManifestAtomic } from "../../manifest.ts";
import type { IndexUpdateSummary, RefreshIndexOptions } from "../../types.ts";
import { mapOperationError } from "../helpers.ts";
import type { WorkspaceCodeRagService } from "../workspacecoderagservice.ts";

export async function do_runRefresh(
  self: WorkspaceCodeRagService,
  options: RefreshIndexOptions,
  signal: AbortSignal,
): Promise<IndexUpdateSummary> {
  const startedAt = Date.now();
  const lock = acquireRepositoryLock(self.repositoryDirectory);
  try {
    self.lastPreparationPlan = undefined;
    await self.reloadPersistedState();
    self.state = self.manifest ? "updating" : "initializing";
    self.reportProgress(options.onProgress, "scanning", 0);
    const scanned = await self.scanWorkspace(signal, options.onProgress);
    self.reportProgress(options.onProgress, "indexing", 5);
    const plan = self.createRefreshPlan(scanned);
    const changedFileCount = plan.added.length + plan.changed.length + plan.deleted.length;
    const incompatibility = self.manifest
      ? self.lastError?.code === "RAG_INCOMPATIBLE_INDEX"
        ? self.lastError.message
        : self.manifestIncompatibility(self.manifest)
      : "Index is not initialized";

    // Sparse vocabulary changes require a new generation so stored and query token indices stay aligned
    const previousFileCount = Object.keys(self.manifest?.files ?? {}).length;
    const currentDriftCount = (self.manifest?.sparse.driftFileCount ?? 0) + changedFileCount;
    const driftRatio = currentDriftCount / Math.max(previousFileCount, 1);
    const sparseDriftExceeded = driftRatio > self.settings.sparseRebuildDriftRatio;

    if (
      changedFileCount === 0 &&
      self.manifest &&
      !options.forceSparseRebuild &&
      incompatibility === undefined &&
      !sparseDriftExceeded
    ) {
      for (const file of plan.unchanged) {
        const entry = self.manifest.files[file.path];
        if (entry) self.manifest.files[file.path] = { ...entry, size: file.size, mtimeMs: file.mtimeMs };
      }
      self.manifest.state = "ready";
      self.manifest.updatedAt = self.now().toISOString();
      delete self.manifest.lastError;
      writeManifestAtomic(self.manifestPath, self.manifest);
      self.state = "ready";
      self.staleReason = undefined;
      self.lastError = undefined;
      self.reportProgress(options.onProgress, "finalizing", 100);
      return self.summaryForPlan(plan, startedAt, 0, false);
    }

    const changeRatio = changedFileCount / Math.max(previousFileCount, 1);

    if (options.forceSparseRebuild || !self.manifest || incompatibility !== undefined) {
      return await self.performRebuild(scanned, plan, startedAt, signal, options.onProgress);
    }
    if (sparseDriftExceeded || changeRatio > self.settings.fullSparseRebuildChangeRatio) {
      return await self.performSparseGenerationRefresh(scanned, plan, startedAt, signal, options.onProgress);
    }

    return await self.performIncrementalRefresh(plan, startedAt, signal, options.onProgress);
  } catch (error) {
    const mapped = mapOperationError(error, signal);
    self.lastError = self.errorInfo(mapped.code, mapped.message);
    if (self.manifest) {
      self.state = mapped.code === "RAG_CANCELLED" ? "stale" : "partial";
      self.manifest = {
        ...self.manifest,
        state: self.state === "partial" ? "partial" : "stale",
        lastError: self.lastError,
      };
      try {
        writeManifestAtomic(self.manifestPath, self.manifest);
      } catch {
        // Keep the previous on-disk manifest if status persistence fails.
      }
    } else {
      self.state = mapped.code === "RAG_CANCELLED" ? "not_initialized" : "unavailable";
    }
    throw mapped;
  } finally {
    lock.release();
  }
}
