import { DRAIN_MAX_CONCURRENCY } from "../constants.ts";
import { getResourceBackoffMs, isResourceFailure, safeErrorMessage } from "../helpers.ts";
import type { IndexingDaemon } from "../indexingdaemon.ts";
import type { DrainWorker, RepositoryRuntime } from "../types.ts";

export function do_requestRefresh(
  self: IndexingDaemon,
  runtime: RepositoryRuntime,
  debounce: boolean,
  priority: number = 0,
  startDrain: boolean = true,
): void {
  if (self.disposed || self.quiescing || self.runtimes.get(runtime.root) !== runtime) return;
  self.cancelEmbeddingIdleTimer();
  if (runtime.debounceTimer) clearTimeout(runtime.debounceTimer);
  const queue = () => {
    runtime.debounceTimer = undefined;
    if (self.disposed || self.quiescing || self.runtimes.get(runtime.root) !== runtime) return;
    const wasDirty = runtime.dirty;
    runtime.dirty = true;
    if (!wasDirty) runtime.queueOrder = ++self.nextQueueOrder;
    runtime.queuePriority = Math.max(runtime.queuePriority, priority);
    // Don't reset state/progress when already actively indexing.
    // A file change mid-index should trigger a refresh after the current
    // one completes (via dirty=true) without flickering the display to "queued".
    if (runtime.active) {
      self.writeStatus();
    } else {
      runtime.state = "queued";
      delete runtime.progress;
      runtime.updatedAt = new Date().toISOString();
      self.writeStatus();
      if (startDrain) self.startDrain();
    }
  };
  if (debounce) runtime.debounceTimer = setTimeout(queue, self.options.debounceMs);
  else queue();
}

export function do_startDrain(self: IndexingDaemon): void {
  if (self.disposed || self.quiescing || self.drainPaused) return;
  self.drainWorkers = self.drainWorkers.filter((worker) => !worker.done);
  while (
    self.drainWorkers.length < DRAIN_MAX_CONCURRENCY &&
    [...self.runtimes.values()].some((runtime) => runtime.dirty && !runtime.active)
  ) {
    const worker: DrainWorker = { stop: false, done: false, promise: Promise.resolve() };
    self.drainWorkers.push(worker);
    worker.promise = self.drainWorker(worker).finally(() => {
      worker.done = true;
      self.drainWorkers = self.drainWorkers.filter((candidate) => candidate !== worker);
      if (!self.disposed && !self.quiescing && !self.drainPaused) self.startDrain();
    });
  }
}

export async function do_drainWorker(self: IndexingDaemon, w: DrainWorker): Promise<void> {
  while (!self.disposed && !self.quiescing && !w.stop) {
    let runtime: RepositoryRuntime | undefined;
    for (const candidate of self.runtimes.values()) {
      if (!candidate.dirty || candidate.active) continue;
      if (
        !runtime ||
        candidate.queuePriority > runtime.queuePriority ||
        (candidate.queuePriority === runtime.queuePriority && candidate.queueOrder < runtime.queueOrder)
      ) {
        runtime = candidate;
      }
    }
    if (!runtime) return;

    // Double-check still available (another worker may have grabbed it).
    if (!runtime.dirty || runtime.active) continue;
    const activePriority = runtime.queuePriority;
    runtime.dirty = false;
    runtime.active = true;
    runtime.queueOrder = 0;
    runtime.queuePriority = 0;
    runtime.activePriority = activePriority;
    w.runtime = runtime;
    runtime.state = runtime.indexedFiles > 0 ? "updating" : "initializing";
    runtime.updatedAt = new Date().toISOString();
    runtime.indexingStartedAt = undefined;
    runtime.progressSamples = [];
    delete runtime.progress;
    delete runtime.lastError;
    self.writeStatus();

    try {
      await self.runRepositoryOperation(w, async (signal, reportActivity) => {
        await self.ensureBackends(signal);
        const initialized = await runtime.service.initialize({ checkFreshness: true });
        self.applyRuntimeStatus(runtime, initialized);
        if (runtime.registryPriorityRequestId) {
          self.acknowledgePriorityRequest(runtime, runtime.registryPriorityRequestId);
        }
        const summary = await runtime.service.refresh(
          {
            transactional: true,
            onProgress: (progress) => {
              reportActivity();
              self.updateRuntimeProgress(runtime, progress);
            },
          },
          signal,
        );
        self.applyRuntimeStatus(runtime, summary.status);
        runtime.readyValidated = summary.status.state === "ready";
        delete runtime.progress;
        delete runtime.lastError;
        runtime.consecutiveResourceFailureCount = 0;
      });
    } catch (error) {
      if (w.preemptedRuntime === runtime) {
        await self.releaseEmbeddingDevice();
        if (!self.disposed && !self.quiescing && self.runtimes.get(runtime.root) === runtime) {
          runtime.state = "queued";
          delete runtime.progress;
          delete runtime.lastError;
        }
      } else {
        if (self.disposed || self.quiescing || w.stop) return;
        const isResourceError = isResourceFailure(error);
        runtime.state = "error";
        delete runtime.progress;
        runtime.lastError = safeErrorMessage(error);
        self.log("error", `Indexing failed for ${runtime.root}: ${runtime.lastError}`);
        if (!self.disposed && !self.quiescing && self.runtimes.get(runtime.root) === runtime && !runtime.retryTimer) {
          if (isResourceError) {
            runtime.consecutiveResourceFailureCount += 1;
            const backoffMs = getResourceBackoffMs(runtime.consecutiveResourceFailureCount);
            self.log(
              "error",
              `Resource failure #${runtime.consecutiveResourceFailureCount} for ${runtime.root}, retrying in ${backoffMs / 1000}s`,
            );
            runtime.retryTimer = setTimeout(() => {
              runtime.retryTimer = undefined;
              self.requestRefresh(runtime, false);
            }, backoffMs);
          } else {
            runtime.consecutiveResourceFailureCount = 0;
            runtime.retryTimer = setTimeout(() => {
              runtime.retryTimer = undefined;
              self.requestRefresh(runtime, false);
            }, self.options.retryMs);
          }
        }
      }
    } finally {
      if (w.preemptedRuntime === runtime) w.preemptedRuntime = undefined;
      runtime.active = false;
      runtime.activePriority = 0;
      if (w.runtime === runtime) w.runtime = undefined;
      self.resetEmbeddingIdleTimer();
    }
    runtime.updatedAt = new Date().toISOString();
    self.writeStatus();
  }
}
