import type { IndexingProgress, RagStatus } from "@dst0/p-code-index";
import { acknowledgeIndexingPriorityForRepo } from "../../indexed-repos.ts";
import type { IndexingDaemon } from "../indexingdaemon.ts";
import type { DrainWorker, RepositoryRuntime } from "../types.ts";

export function do_preemptFor(self: IndexingDaemon, runtime: RepositoryRuntime): void {
  if (runtime.active || !runtime.dirty) return;
  let victim: DrainWorker | undefined;
  for (const worker of self.drainWorkers) {
    if (worker.stop || worker.preemptedRuntime || !worker.controller || !worker.runtime || worker.runtime === runtime)
      continue;
    if (!victim || worker.runtime.activePriority < (victim.runtime?.activePriority ?? Number.POSITIVE_INFINITY)) {
      victim = worker;
    }
  }
  if (!victim?.runtime || runtime.queuePriority <= victim.runtime.activePriority) return;
  self.requestRefresh(victim.runtime, false, victim.runtime.activePriority, false);
  victim.preemptedRuntime = victim.runtime;
  victim.controller?.abort(new Error(`Indexing preempted for ${runtime.root}`));
}

export function do_acknowledgePriorityRequest(
  self: IndexingDaemon,
  runtime: RepositoryRuntime,
  requestId: string,
): void {
  acknowledgeIndexingPriorityForRepo(runtime.root, requestId, self.options.agentDir);
  if (runtime.registryPriorityRequestId === requestId) runtime.registryPriorityRequestId = undefined;
}

export async function do_runRepositoryOperation(
  self: IndexingDaemon,
  worker: DrainWorker,
  operation: (signal: AbortSignal, reportActivity: () => void) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  worker.controller = controller;
  const message = `Indexing operation timed out after ${self.options.repositoryTimeoutMs}ms without progress`;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reportActivity = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(message));
    }, self.options.repositoryTimeoutMs);
  };
  reportActivity();
  try {
    await operation(controller.signal, reportActivity);
  } catch (error) {
    if (timedOut) throw new Error(message);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (worker.controller === controller) worker.controller = undefined;
  }
}

export async function do_stopDrain(
  self: IndexingDaemon,
  abortActive: boolean = true,
  resume: boolean = true,
): Promise<void> {
  self.drainPaused = true;
  const workers = [...self.drainWorkers];
  for (const worker of workers) {
    worker.stop = true;
    if (resume && !self.disposed && worker.runtime && self.runtimes.get(worker.runtime.root) === worker.runtime) {
      worker.runtime.dirty = true;
    }
    if (abortActive) worker.controller?.abort(new Error("Indexing daemon stopped"));
  }
  await Promise.allSettled(workers.map((worker) => worker.promise));
  self.drainWorkers = [];
  self.drainPaused = !resume;
  if (resume && !self.disposed && !self.quiescing) self.startDrain();
}

export function do_applyRuntimeStatus(_self: IndexingDaemon, runtime: RepositoryRuntime, status: RagStatus): void {
  runtime.state = status.state;
  runtime.indexedFiles = status.indexedFiles;
  runtime.indexedChunks = status.indexedChunks;
  if (status.lastError) runtime.lastError = status.lastError.message;
  else delete runtime.lastError;
  runtime.updatedAt = new Date().toISOString();
}

export function do_pauseIntake(self: IndexingDaemon): void {
  self.registryWatcher?.close();
  self.registryWatcher = null;
  if (self.registryWatchRetryTimer) clearTimeout(self.registryWatchRetryTimer);
  self.registryWatchRetryTimer = undefined;
  if (self.reconcileTimer) clearInterval(self.reconcileTimer);
  self.reconcileTimer = undefined;
  for (const runtime of self.runtimes.values()) {
    runtime.watcher?.close();
    runtime.watcher = null;
    if (runtime.debounceTimer) clearTimeout(runtime.debounceTimer);
    runtime.debounceTimer = undefined;
    if (runtime.retryTimer) clearTimeout(runtime.retryTimer);
    runtime.retryTimer = undefined;
    if (runtime.watchRetryTimer) clearTimeout(runtime.watchRetryTimer);
    runtime.watchRetryTimer = undefined;
  }
}

export function do_updateRuntimeProgress(
  self: IndexingDaemon,
  runtime: RepositoryRuntime,
  progress: IndexingProgress,
): void {
  const now = Date.now();
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent * 10) / 10));
  const phaseChanged = runtime.progress?.phase !== progress.phase;
  if (phaseChanged) runtime.progressSamples = [];
  if (phaseChanged && progress.phase === "indexing") {
    runtime.indexingStartedAt = new Date(now).toISOString();
  }
  runtime.progressSamples ??= [];
  runtime.progressSamples.push({ timestamp: now, percent });
  // Keep last 60 seconds of samples
  const cutoff = now - 60_000;
  runtime.progressSamples = runtime.progressSamples.filter((s) => s.timestamp >= cutoff);

  let etaSeconds: number | undefined;
  if (progress.phase === "indexing" && percent > 0 && percent < 100) {
    const samples = runtime.progressSamples;
    const oldest = samples[0];
    const newest = samples[samples.length - 1];
    if (oldest && newest && newest.timestamp - oldest.timestamp >= 5_000) {
      const deltaPercent = newest.percent - oldest.percent;
      const deltaSec = (newest.timestamp - oldest.timestamp) / 1000;
      if (deltaPercent > 0 && deltaSec > 0) {
        const percentPerSec = deltaPercent / deltaSec;
        etaSeconds = Math.max(0, Math.round((100 - percent) / percentPerSec));
      }
    }
  }

  const normalized: IndexingProgress = {
    phase: progress.phase,
    percent,
    ...(progress.phase === "indexing" && runtime.indexingStartedAt ? { startedAt: runtime.indexingStartedAt } : {}),
    ...(progress.processedFiles !== undefined ? { processedFiles: progress.processedFiles } : {}),
    ...(progress.totalFiles !== undefined ? { totalFiles: progress.totalFiles } : {}),
    ...(progress.processedChunks !== undefined ? { processedChunks: progress.processedChunks } : {}),
    ...(progress.totalChunks !== undefined ? { totalChunks: progress.totalChunks } : {}),
    ...(progress.reusedChunks !== undefined ? { reusedChunks: progress.reusedChunks } : {}),
    ...(progress.recalculatedChunks !== undefined ? { recalculatedChunks: progress.recalculatedChunks } : {}),
    ...(progress.recalculatedTotal !== undefined ? { recalculatedTotal: progress.recalculatedTotal } : {}),
    ...(etaSeconds !== undefined ? { etaSeconds } : {}),
  };
  if (
    runtime.progress?.phase === normalized.phase &&
    runtime.progress.percent === normalized.percent &&
    runtime.progress.etaSeconds === normalized.etaSeconds &&
    runtime.progress.processedFiles === normalized.processedFiles &&
    runtime.progress.totalFiles === normalized.totalFiles &&
    runtime.progress.processedChunks === normalized.processedChunks &&
    runtime.progress.totalChunks === normalized.totalChunks &&
    runtime.progress.reusedChunks === normalized.reusedChunks &&
    runtime.progress.recalculatedChunks === normalized.recalculatedChunks &&
    runtime.progress.recalculatedTotal === normalized.recalculatedTotal
  ) {
    return;
  }
  runtime.progress = normalized;
  runtime.state = runtime.indexedFiles > 0 ? "updating" : "initializing";
  runtime.updatedAt = new Date().toISOString();
  self.writeStatus();
}
