import type { FSWatcher } from "node:fs";
import type { CodeRagService, IndexingProgress, RagState } from "@dst0/p-code-index";
import type { IndexingTrayService } from "../indexing-tray-manager.ts";

export type WatchFactory = (
  target: string,
  options: { recursive: boolean },
  listener: (eventType: string, filename: string | Buffer | null) => void,
) => FSWatcher;

export interface DrainWorker {
  stop: boolean;
  done: boolean;
  preemptedRuntime?: RepositoryRuntime;
  controller?: AbortController;
  runtime?: RepositoryRuntime;
  promise: Promise<void>;
}

export interface DaemonLock {
  path: string;
  token: string;
}

export interface IndexingDaemonOptions {
  agentDir: string;
  qdrantBinary: string;
  qdrantDataDirectory: string;
  pythonExecutable: string;
  embeddingModel: string;
  embeddingConfigPath?: string;
  useDenseEmbeddings?: boolean;
  debounceMs?: number;
  retryMs?: number;
  reconcileMs?: number;
  repositoryTimeoutMs?: number;
  serviceFactory?: (workspaceRoot: string) => CodeRagService;
  ensureBackends?: (signal?: AbortSignal) => Promise<void>;
  releaseEmbeddingDevice?: () => Promise<void>;
  disposeBackends?: () => Promise<void>;
  watchFactory?: WatchFactory;
  trayManager?: IndexingTrayService;
}

export interface IndexingDaemonStopOptions {
  /** Allow active repository refreshes to finish before resources are disposed. */
  graceful?: boolean;
}

export interface RepositoryRuntime {
  root: string;
  service: CodeRagService;
  watcher: FSWatcher | null;
  dirty: boolean;
  active: boolean;
  queueOrder: number;
  queuePriority: number;
  activePriority: number;
  registryUpdatedAt: string;
  registryPriorityRequestId?: string;
  state: RagState | "queued" | "error";
  indexedFiles: number;
  indexedChunks: number;
  /** True after a persisted ready index was verified or a refresh completed. */
  readyValidated: boolean;
  progress?: IndexingProgress;
  /** Timestamp when the current indexing run started. */
  indexingStartedAt?: string;
  progressSamples?: Array<{ timestamp: number; percent: number }>;
  lastError?: string;
  /** Consecutive resource (OOM/disk/fd) failures for exponential backoff retry. */
  consecutiveResourceFailureCount: number;
  updatedAt: string;
  debounceTimer?: ReturnType<typeof setTimeout>;
  retryTimer?: ReturnType<typeof setTimeout>;
  watchRetryTimer?: ReturnType<typeof setTimeout>;
}
