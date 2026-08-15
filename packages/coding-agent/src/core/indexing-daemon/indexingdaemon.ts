import fs, { type FSWatcher } from "node:fs";
import path from "node:path";
import {
  type CodeRagService,
  EmbeddingServerManager,
  type IndexingProgress,
  QdrantServerManager,
  type RagStatus,
  WorkspaceCodeRagService,
} from "@dst0/p-code-index";
import { computeIndexingRuntimeConfigFingerprint } from "../indexing-runtime-config.ts";
import { IndexingTrayManager, type IndexingTrayService } from "../indexing-tray-manager.ts";
import { computeIndexingVersion } from "../indexing-version.ts";
import { DEFAULT_REPOSITORY_TIMEOUT_MS } from "./constants.ts";
import { do_drainWorker, do_requestRefresh, do_startDrain } from "./indexingdaemon-methods/health-check.ts";
import {
  do_ensureBackends,
  do_prepareForRestart,
  do_reconcile,
  do_start,
  do_stop,
  do_syncRegistry,
} from "./indexingdaemon-methods/lifecycle.ts";
import {
  do_acknowledgePriorityRequest,
  do_applyRuntimeStatus,
  do_pauseIntake,
  do_preemptFor,
  do_runRepositoryOperation,
  do_stopDrain,
  do_updateRuntimeProgress,
} from "./indexingdaemon-methods/runtime-operations.ts";
import {
  do_cancelEmbeddingIdleTimer,
  do_closeRuntime,
  do_log,
  do_resetEmbeddingIdleTimer,
  do_writeStatus,
} from "./indexingdaemon-methods/status-logging.ts";
import {
  do_handleRegistryWatchError,
  do_handleRepositoryWatchError,
  do_runRegistrySync,
  do_watchRegistry,
  do_watchRepository,
} from "./indexingdaemon-methods/status-monitoring.ts";
import type {
  DaemonLock,
  DrainWorker,
  IndexingDaemonOptions,
  IndexingDaemonStopOptions,
  RepositoryRuntime,
  WatchFactory,
} from "./types.ts";

export class IndexingDaemon {
  public readonly options: Required<
    Pick<
      IndexingDaemonOptions,
      "agentDir" | "debounceMs" | "retryMs" | "reconcileMs" | "repositoryTimeoutMs" | "useDenseEmbeddings"
    >
  >;

  public readonly serviceFactory: (workspaceRoot: string) => CodeRagService;

  public readonly _ensureBackendsRaw: (signal?: AbortSignal) => Promise<void>;

  public readonly disposeBackends: () => Promise<void>;

  public readonly releaseEmbeddingDevice: () => Promise<void>;

  public readonly watchFactory: WatchFactory;

  public readonly embeddingManager: EmbeddingServerManager;

  public readonly trayManager: IndexingTrayService;

  public readonly runtimes = new Map<string, RepositoryRuntime>();

  public readonly startedAt = new Date().toISOString();

  public readonly indexingVersion: string;

  public readonly runtimeConfigFingerprint: string;

  public registryWatcher: FSWatcher | null = null;

  public registryWatchRetryTimer: ReturnType<typeof setTimeout> | undefined;

  public registrySyncPromise: Promise<void> | undefined;

  public registrySyncRequested = false;

  public reconcileTimer: ReturnType<typeof setInterval> | undefined;

  public drainWorkers: DrainWorker[] = [];

  public drainPaused = false;

  public nextQueueOrder = 0;

  public daemonLock: DaemonLock | undefined;

  public quiescing = false;

  public disposed = false;

  public embeddingIdleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: IndexingDaemonOptions) {
    this.options = {
      agentDir: options.agentDir,
      debounceMs: options.debounceMs ?? 750,
      retryMs: options.retryMs ?? 30_000,
      reconcileMs: options.reconcileMs ?? 5 * 60_000,
      repositoryTimeoutMs: options.repositoryTimeoutMs ?? DEFAULT_REPOSITORY_TIMEOUT_MS,
      useDenseEmbeddings: options.useDenseEmbeddings ?? true,
    };
    const qdrantManager = new QdrantServerManager(6333, {
      qdrantBinary: options.qdrantBinary,
      dataDirectory: options.qdrantDataDirectory,
      startupTimeoutMs: 30_000,
      onLog: (level, message) => this.log(level, message),
    });
    this.embeddingManager = new EmbeddingServerManager(18742, options.embeddingModel, {
      pythonExecutable: options.pythonExecutable,
      configPath: options.embeddingConfigPath ?? path.join(options.agentDir, "code-rag.json"),
      startupTimeoutMs: 5 * 60_000,
      onLog: (level, message) => this.log(level, message),
    });
    this.serviceFactory =
      options.serviceFactory ??
      ((workspaceRoot) =>
        new WorkspaceCodeRagService({
          workspaceRoot,
          dataDirectory: path.join(options.agentDir, "code-rag"),
          userConfigPath: path.join(options.agentDir, "code-rag.json"),
          manageLocalBackends: false,
          allowSearchRefresh: false,
        }));
    this._ensureBackendsRaw =
      options.ensureBackends ??
      (async (signal) => {
        await qdrantManager.ensureStarted(signal);
        if (this.options.useDenseEmbeddings) await this.embeddingManager.ensureStarted(signal);
      });
    this.disposeBackends =
      options.disposeBackends ??
      (async () => {
        await Promise.all([this.embeddingManager.stop(), qdrantManager.stop()]);
      });
    this.releaseEmbeddingDevice =
      options.releaseEmbeddingDevice ??
      (async () => {
        if (!this.options.useDenseEmbeddings) return;
        if (!(await this.embeddingManager.waitUntilIdle())) await this.embeddingManager.stop();
      });
    this.watchFactory =
      options.watchFactory ??
      ((target, watchOptions, listener) => fs.watch(target, { ...watchOptions, encoding: "utf8" }, listener));
    this.trayManager = options.trayManager ?? new IndexingTrayManager({ agentDir: options.agentDir });
    this.indexingVersion = computeIndexingVersion();
    this.runtimeConfigFingerprint = computeIndexingRuntimeConfigFingerprint(options.agentDir);
  }

  async ensureBackends(signal?: AbortSignal): Promise<void> {
    return do_ensureBackends(this, signal);
  }

  async start(): Promise<void> {
    return do_start(this);
  }

  async prepareForRestart(): Promise<void> {
    return do_prepareForRestart(this);
  }

  async stop(options: IndexingDaemonStopOptions = {}): Promise<void> {
    return do_stop(this, options);
  }

  async reconcile(): Promise<void> {
    return do_reconcile(this);
  }

  syncRegistry(): Promise<void> {
    return do_syncRegistry(this);
  }

  async runRegistrySync(): Promise<void> {
    return do_runRegistrySync(this);
  }

  watchRegistry(): void {
    do_watchRegistry(this);
  }

  handleRegistryWatchError(): void {
    do_handleRegistryWatchError(this);
  }

  watchRepository(runtime: RepositoryRuntime, useRecursive = true): void {
    do_watchRepository(this, runtime, useRecursive);
  }

  handleRepositoryWatchError(runtime: RepositoryRuntime): void {
    do_handleRepositoryWatchError(this, runtime);
  }

  requestRefresh(
    runtime: RepositoryRuntime,
    debounce: boolean,
    priority: number = 0,
    startDrain: boolean = true,
  ): void {
    do_requestRefresh(this, runtime, debounce, priority, startDrain);
  }

  startDrain(): void {
    do_startDrain(this);
  }

  async drainWorker(w: DrainWorker): Promise<void> {
    return do_drainWorker(this, w);
  }

  preemptFor(runtime: RepositoryRuntime): void {
    do_preemptFor(this, runtime);
  }

  acknowledgePriorityRequest(runtime: RepositoryRuntime, requestId: string): void {
    do_acknowledgePriorityRequest(this, runtime, requestId);
  }

  async runRepositoryOperation(
    worker: DrainWorker,
    operation: (signal: AbortSignal, reportActivity: () => void) => Promise<void>,
  ): Promise<void> {
    return do_runRepositoryOperation(this, worker, operation);
  }

  async stopDrain(abortActive: boolean = true, resume: boolean = true): Promise<void> {
    return do_stopDrain(this, abortActive, resume);
  }

  applyRuntimeStatus(runtime: RepositoryRuntime, status: RagStatus): void {
    do_applyRuntimeStatus(this, runtime, status);
  }

  pauseIntake(): void {
    do_pauseIntake(this);
  }

  updateRuntimeProgress(runtime: RepositoryRuntime, progress: IndexingProgress): void {
    do_updateRuntimeProgress(this, runtime, progress);
  }

  closeRuntime(runtime: RepositoryRuntime): void {
    do_closeRuntime(this, runtime);
  }

  writeStatus(running: boolean = !this.disposed): void {
    do_writeStatus(this, running);
  }

  log(level: "debug" | "error", message: string): void {
    do_log(this, level, message);
  }

  resetEmbeddingIdleTimer(): void {
    do_resetEmbeddingIdleTimer(this);
  }

  cancelEmbeddingIdleTimer(): void {
    do_cancelEmbeddingIdleTimer(this);
  }
}
