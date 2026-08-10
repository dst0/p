import type { FSWatcher, Stats } from "fs";
import { IndexingService, type IndexStatus } from "../indexing-service.ts";
import {
  do_clearGitWatchers,
  do_dispose,
  do_getIndexingRoot,
  do_handleGitWatcherError,
  do_notifyBranchChange,
  do_refreshGitBranchAsync,
  do_refreshIndexingStatus,
  do_resolveGitBranchAsync,
  do_resolveGitBranchSync,
  do_scheduleGitWatcherRetry,
  do_scheduleRefresh,
  do_setAvailableProviderCount,
  do_setCwd,
} from "./footerdataprovider-methods/label-formatting.ts";
import {
  do_clearExtensionStatuses,
  do_clearProgress,
  do_getAvailableProviderCount,
  do_getExtensionStatuses,
  do_getGenProgress,
  do_getGitBranch,
  do_getIndexingStatus,
  do_getLoadingProgress,
  do_getModelSwitchProgress,
  do_getPrefillProgress,
  do_getQueuedProgress,
  do_getSendingProgress,
  do_notifyProgressChange,
  do_onBranchChange,
  do_onProgressChange,
  do_setExtensionStatus,
  do_setGenProgress,
  do_setLoadingProgress,
  do_setModelSwitchProgress,
  do_setPrefillProgress,
  do_setQueuedProgress,
  do_setSendingProgress,
} from "./footerdataprovider-methods/progress-tracking.ts";
import { do_setupGitWatcher } from "./footerdataprovider-methods/status-display.ts";
import { findGitPaths } from "./helpers.ts";
import type {
  GenerationProgress,
  GitPaths,
  LoadingProgress,
  ModelSwitchProgress,
  PrefillProgress,
  QueuedProgress,
  SendingProgress,
} from "./types.ts";

export class FooterDataProvider {
  public cwd: string;

  public static readonly WATCH_DEBOUNCE_MS = 500;

  public static readonly INDEXING_STATUS_POLL_MS = 500;

  public extensionStatuses = new Map<string, string>();

  public prefillProgress?: PrefillProgress;

  public genProgress?: GenerationProgress;

  public queuedProgress?: QueuedProgress;

  public queuedStartAt?: number;

  public sendingProgress?: SendingProgress;

  public modelSwitchProgress?: ModelSwitchProgress;

  public loadingProgress?: LoadingProgress;

  public readonly indexingService: IndexingService;

  public indexingStatus: IndexStatus;

  public indexingStatusTimer: ReturnType<typeof setInterval>;

  public cachedBranch: string | null | undefined = undefined;

  public gitPaths: GitPaths | null | undefined = undefined;

  public headWatcher: FSWatcher | null = null;

  public headWatchFilePath: string | null = null;

  public headWatchFileListener: ((current: Stats, previous: Stats) => void) | null = null;

  public reftableWatcher: FSWatcher | null = null;

  public reftableTablesListWatcher: FSWatcher | null = null;

  public reftableTablesListPath: string | null = null;

  public branchChangeCallbacks = new Set<() => void>();

  public progressChangeCallbacks = new Set<() => void>();

  public availableProviderCount = 0;

  public refreshTimer: ReturnType<typeof setTimeout> | null = null;

  public gitWatcherRetryTimer: ReturnType<typeof setTimeout> | null = null;

  public refreshInFlight = false;

  public refreshPending = false;

  public disposed = false;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.gitPaths = findGitPaths(cwd);
    this.indexingService = new IndexingService();
    this.indexingStatus = this.indexingService.getStatus(this.getIndexingRoot());
    this.setupGitWatcher();
    this.indexingStatusTimer = setInterval(
      () => this.refreshIndexingStatus(),
      FooterDataProvider.INDEXING_STATUS_POLL_MS,
    );
    this.indexingStatusTimer.unref();
  }

  getGitBranch(): string | null {
    return do_getGitBranch(this);
  }

  getExtensionStatuses(): ReadonlyMap<string, string> {
    return do_getExtensionStatuses(this);
  }

  getPrefillProgress(): PrefillProgress | undefined {
    return do_getPrefillProgress(this);
  }

  getGenProgress(): GenerationProgress | undefined {
    return do_getGenProgress(this);
  }

  getQueuedProgress(): QueuedProgress | undefined {
    return do_getQueuedProgress(this);
  }

  getSendingProgress(): SendingProgress | undefined {
    return do_getSendingProgress(this);
  }

  getModelSwitchProgress(): ModelSwitchProgress | undefined {
    return do_getModelSwitchProgress(this);
  }

  getLoadingProgress(): LoadingProgress | undefined {
    return do_getLoadingProgress(this);
  }

  getIndexingStatus(): IndexStatus {
    return do_getIndexingStatus(this);
  }

  onBranchChange(callback: () => void): () => void {
    return do_onBranchChange(this, callback);
  }

  onProgressChange(callback: () => void): () => void {
    return do_onProgressChange(this, callback);
  }

  setExtensionStatus(key: string, text: string | undefined): void {
    do_setExtensionStatus(this, key, text);
  }

  setPrefillProgress(progress: PrefillProgress | undefined): void {
    do_setPrefillProgress(this, progress);
  }

  setGenProgress(progress: GenerationProgress | undefined): void {
    do_setGenProgress(this, progress);
  }

  setQueuedProgress(progress: QueuedProgress | undefined): void {
    do_setQueuedProgress(this, progress);
  }

  setSendingProgress(progress: SendingProgress | undefined): void {
    do_setSendingProgress(this, progress);
  }

  setModelSwitchProgress(progress: ModelSwitchProgress | undefined): void {
    do_setModelSwitchProgress(this, progress);
  }

  setLoadingProgress(progress: LoadingProgress | undefined): void {
    do_setLoadingProgress(this, progress);
  }

  clearProgress(options?: { preserveQueued?: boolean }): void {
    do_clearProgress(this, options);
  }

  clearExtensionStatuses(): void {
    do_clearExtensionStatuses(this);
  }

  notifyProgressChange(): void {
    do_notifyProgressChange(this);
  }

  getAvailableProviderCount(): number {
    return do_getAvailableProviderCount(this);
  }

  setAvailableProviderCount(count: number): void {
    do_setAvailableProviderCount(this, count);
  }

  setCwd(cwd: string): void {
    do_setCwd(this, cwd);
  }

  dispose(): void {
    do_dispose(this);
  }

  notifyBranchChange(): void {
    do_notifyBranchChange(this);
  }

  getIndexingRoot(): string {
    return do_getIndexingRoot(this);
  }

  refreshIndexingStatus(): void {
    do_refreshIndexingStatus(this);
  }

  scheduleRefresh(): void {
    do_scheduleRefresh(this);
  }

  async refreshGitBranchAsync(): Promise<void> {
    return do_refreshGitBranchAsync(this);
  }

  resolveGitBranchSync(): string | null {
    return do_resolveGitBranchSync(this);
  }

  async resolveGitBranchAsync(): Promise<string | null> {
    return do_resolveGitBranchAsync(this);
  }

  clearGitWatchers(): void {
    do_clearGitWatchers(this);
  }

  scheduleGitWatcherRetry(): void {
    do_scheduleGitWatcherRetry(this);
  }

  handleGitWatcherError(): void {
    do_handleGitWatcherError(this);
  }

  setupGitWatcher(): void {
    do_setupGitWatcher(this);
  }
}
