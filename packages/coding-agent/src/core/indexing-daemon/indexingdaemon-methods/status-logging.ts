import {
  type IndexingServiceStatusData,
  type RepositoryServiceStatus,
  writeIndexingServiceStatus,
} from "../../indexing-service.ts";
import { EMBEDDING_IDLE_TIMEOUT_MS } from "../constants.ts";
import { safeErrorMessage } from "../helpers.ts";
import type { IndexingDaemon } from "../indexingdaemon.ts";
import type { RepositoryRuntime } from "../types.ts";

export function do_closeRuntime(_self: IndexingDaemon, runtime: RepositoryRuntime): void {
  runtime.watcher?.close();
  runtime.watcher = null;
  if (runtime.debounceTimer) clearTimeout(runtime.debounceTimer);
  if (runtime.retryTimer) clearTimeout(runtime.retryTimer);
  if (runtime.watchRetryTimer) clearTimeout(runtime.watchRetryTimer);
  runtime.dirty = false;
  runtime.active = false;
  runtime.queueOrder = 0;
  runtime.queuePriority = 0;
  runtime.activePriority = 0;
}

export function do_writeStatus(self: IndexingDaemon, running: boolean = !self.disposed): void {
  const repos: RepositoryServiceStatus[] = [...self.runtimes.values()].map((runtime) => ({
    path: runtime.root,
    state: runtime.state,
    indexedFiles: runtime.indexedFiles,
    indexedChunks: runtime.indexedChunks,
    updatedAt: runtime.updatedAt,
    progress: runtime.progress,
    lastError: runtime.lastError,
  }));
  const data: IndexingServiceStatusData = {
    pid: process.pid,
    running,
    startedAt: self.startedAt,
    updatedAt: new Date().toISOString(),
    indexingVersion: self.indexingVersion,
    repos,
  };
  writeIndexingServiceStatus(self.options.agentDir, data);
}

export function do_log(_self: IndexingDaemon, level: "debug" | "error", message: string): void {
  const line = `[code-index:${level}] ${message}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

export function do_resetEmbeddingIdleTimer(self: IndexingDaemon): void {
  self.cancelEmbeddingIdleTimer();
  if (self.options.useDenseEmbeddings === false) return;
  if ([...self.runtimes.values()].some((runtime) => runtime.active || runtime.dirty || runtime.debounceTimer)) return;
  self.embeddingIdleTimer = setTimeout(async () => {
    self.log("debug", "Embedding server idle timeout reached; stopping Python embedding server");
    try {
      await self.embeddingManager.stop();
    } catch (error) {
      self.log("error", `Failed to stop embedding server on idle: ${safeErrorMessage(error)}`);
    }
  }, EMBEDDING_IDLE_TIMEOUT_MS);
  if (self.embeddingIdleTimer) self.embeddingIdleTimer.unref?.();
}

export function do_cancelEmbeddingIdleTimer(self: IndexingDaemon): void {
  if (self.embeddingIdleTimer) {
    clearTimeout(self.embeddingIdleTimer);
    self.embeddingIdleTimer = undefined;
  }
}
