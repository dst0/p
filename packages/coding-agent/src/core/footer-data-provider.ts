import { type ExecFileException, execFile, spawnSync } from "child_process";
import { existsSync, type FSWatcher, readFileSync, type Stats, statSync, unwatchFile, watchFile } from "fs";
import { dirname, join, resolve } from "path";
import { closeWatcher, FS_WATCH_RETRY_DELAY_MS, watchWithErrorHandler } from "../utils/fs-watch.ts";
import { findIndexWorkspaceRoot } from "./indexed-repos.ts";
import { IndexingService, type IndexStatus } from "./indexing-service.ts";

type GitPaths = {
	repoDir: string;
	commonGitDir: string;
	headPath: string;
};

export type PrefillProgress = {
	percent: number;
	elapsedMs: number;
	tokensPerSecond?: number;
};

export type GenerationProgress = {
	tokensPerSecond: number;
	tokens: number;
};

export type QueuedProgress = {
	position: number;
	queuedAhead: number;
	queue: string;
	workerId?: string;
	ticketId?: string;
	source: "llm-orchestrator";
	queuedAt?: number;
	queuedForMs?: number;
};

export type SendingProgress = {
	model: string;
};

export type ModelSwitchProgress = {
	fromModel: string;
	toModel: string;
};

export type LoadingProgress = {
	model: string;
};

/**
 * Find git metadata paths by walking up from cwd.
 * Handles both regular git repos (.git is a directory) and worktrees (.git is a file).
 */
function findGitPaths(cwd: string): GitPaths | null {
	let dir = cwd;
	while (true) {
		const gitPath = join(dir, ".git");
		if (existsSync(gitPath)) {
			try {
				const stat = statSync(gitPath);
				if (stat.isFile()) {
					const content = readFileSync(gitPath, "utf8").trim();
					if (content.startsWith("gitdir: ")) {
						const gitDir = resolve(dir, content.slice(8).trim());
						const headPath = join(gitDir, "HEAD");
						if (!existsSync(headPath)) return null;
						const commonDirPath = join(gitDir, "commondir");
						const commonGitDir = existsSync(commonDirPath)
							? resolve(gitDir, readFileSync(commonDirPath, "utf8").trim())
							: gitDir;
						return { repoDir: dir, commonGitDir, headPath };
					}
				} else if (stat.isDirectory()) {
					const headPath = join(gitPath, "HEAD");
					if (!existsSync(headPath)) return null;
					return { repoDir: dir, commonGitDir: gitPath, headPath };
				}
			} catch {
				return null;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/** Ask git for the current branch. Returns null on detached HEAD or if git is unavailable. */
function resolveBranchWithGitSync(repoDir: string): string | null {
	const result = spawnSync("git", ["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"], {
		cwd: repoDir,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	const branch = result.status === 0 ? result.stdout.trim() : "";
	return branch || null;
}

/** Ask git for the current branch asynchronously. Returns null on detached HEAD or if git is unavailable. */
function resolveBranchWithGitAsync(repoDir: string): Promise<string | null> {
	return new Promise((resolvePromise) => {
		execFile(
			"git",
			["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"],
			{
				cwd: repoDir,
				encoding: "utf8",
			},
			(error: ExecFileException | null, stdout: string) => {
				if (error) {
					resolvePromise(null);
					return;
				}
				const branch = stdout.trim();
				resolvePromise(branch || null);
			},
		);
	});
}

function isWslEnvironment(): boolean {
	return process.platform === "linux" && !!(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
}

function isWindowsMountedRepoPath(repoDir: string): boolean {
	return /^\/mnt\/[a-z](?:\/|$)/i.test(repoDir);
}

function shouldPollGitHead(repoDir: string): boolean {
	return isWslEnvironment() && isWindowsMountedRepoPath(repoDir);
}

/**
 * Provides git branch and extension statuses - data not otherwise accessible to extensions.
 * Token stats, model info available via ctx.sessionManager and ctx.model.
 */
export class FooterDataProvider {
	private cwd: string;
	private static readonly WATCH_DEBOUNCE_MS = 500;
	private static readonly INDEXING_STATUS_POLL_MS = 500;

	private extensionStatuses = new Map<string, string>();
	private prefillProgress?: PrefillProgress;
	private genProgress?: GenerationProgress;
	private queuedProgress?: QueuedProgress;
	private queuedStartAt?: number;
	private sendingProgress?: SendingProgress;
	private modelSwitchProgress?: ModelSwitchProgress;
	private loadingProgress?: LoadingProgress;
	private readonly indexingService: IndexingService;
	private indexingStatus: IndexStatus;
	private indexingStatusTimer: ReturnType<typeof setInterval>;
	private cachedBranch: string | null | undefined = undefined;
	private gitPaths: GitPaths | null | undefined = undefined;
	private headWatcher: FSWatcher | null = null;
	private headWatchFilePath: string | null = null;
	private headWatchFileListener: ((current: Stats, previous: Stats) => void) | null = null;
	private reftableWatcher: FSWatcher | null = null;
	private reftableTablesListWatcher: FSWatcher | null = null;
	private reftableTablesListPath: string | null = null;
	private branchChangeCallbacks = new Set<() => void>();
	private progressChangeCallbacks = new Set<() => void>();
	private availableProviderCount = 0;
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;
	private gitWatcherRetryTimer: ReturnType<typeof setTimeout> | null = null;
	private refreshInFlight = false;
	private refreshPending = false;
	private disposed = false;

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

	/** Current git branch, null if not in repo, "detached" if detached HEAD */
	getGitBranch(): string | null {
		if (this.cachedBranch === undefined) {
			this.cachedBranch = this.resolveGitBranchSync();
		}
		return this.cachedBranch;
	}

	/** Extension status texts set via ctx.ui.setStatus() */
	getExtensionStatuses(): ReadonlyMap<string, string> {
		return this.extensionStatuses;
	}

	getPrefillProgress(): PrefillProgress | undefined {
		return this.prefillProgress;
	}

	getGenProgress(): GenerationProgress | undefined {
		return this.genProgress;
	}

	getQueuedProgress(): QueuedProgress | undefined {
		return this.queuedProgress;
	}

	getSendingProgress(): SendingProgress | undefined {
		return this.sendingProgress;
	}

	getModelSwitchProgress(): ModelSwitchProgress | undefined {
		return this.modelSwitchProgress;
	}

	getLoadingProgress(): LoadingProgress | undefined {
		return this.loadingProgress;
	}

	getIndexingStatus(): IndexStatus {
		return this.indexingStatus;
	}

	/** Subscribe to git branch changes. Returns unsubscribe function. */
	onBranchChange(callback: () => void): () => void {
		this.branchChangeCallbacks.add(callback);
		return () => this.branchChangeCallbacks.delete(callback);
	}

	/** Subscribe to progress changes. Returns unsubscribe function. */
	onProgressChange(callback: () => void): () => void {
		this.progressChangeCallbacks.add(callback);
		return () => this.progressChangeCallbacks.delete(callback);
	}

	/** Internal: set extension status */
	setExtensionStatus(key: string, text: string | undefined): void {
		if (text === undefined) {
			this.extensionStatuses.delete(key);
		} else {
			this.extensionStatuses.set(key, text);
		}
	}

	/** Internal: set prefill progress */
	setPrefillProgress(progress: PrefillProgress | undefined): void {
		this.prefillProgress = progress;
		if (progress) {
			this.genProgress = undefined;
			this.queuedProgress = undefined;
			this.sendingProgress = undefined;
			this.modelSwitchProgress = undefined;
			this.loadingProgress = undefined;
		}
		this.notifyProgressChange();
	}

	/** Internal: set gen progress */
	setGenProgress(progress: GenerationProgress | undefined): void {
		this.genProgress = progress;
		if (progress) {
			this.prefillProgress = undefined;
			this.queuedProgress = undefined;
			this.sendingProgress = undefined;
			this.modelSwitchProgress = undefined;
			this.loadingProgress = undefined;
		}
		this.notifyProgressChange();
	}

	/** Internal: set queued progress */
	setQueuedProgress(progress: QueuedProgress | undefined): void {
		if (progress) {
			// Ignore legacy/local message-queue payloads at runtime as well as at
			// the type boundary. QUEUED is an execution phase reported by the
			// orchestrator, while unsent steering/follow-up messages have their own UI.
			if (progress.source !== "llm-orchestrator") {
				return;
			}
			const sameTicket = progress.ticketId
				? progress.ticketId === this.queuedProgress?.ticketId
				: this.queuedProgress?.ticketId === undefined && progress.queue === this.queuedProgress?.queue;
			this.queuedStartAt =
				progress.queuedAt ??
				(sameTicket ? this.queuedProgress?.queuedAt : undefined) ??
				Date.now() - Math.max(0, progress.queuedForMs ?? 0);
			this.queuedProgress = { ...progress, queuedAt: this.queuedStartAt };
		} else {
			this.queuedStartAt = undefined;
			this.queuedProgress = undefined;
		}
		if (this.queuedProgress) {
			this.prefillProgress = undefined;
			this.genProgress = undefined;
			this.sendingProgress = undefined;
			this.modelSwitchProgress = undefined;
			this.loadingProgress = undefined;
		}
		this.notifyProgressChange();
	}

	/** Internal: set request sending progress */
	setSendingProgress(progress: SendingProgress | undefined): void {
		this.sendingProgress = progress;
		if (progress) {
			this.prefillProgress = undefined;
			this.genProgress = undefined;
			this.queuedProgress = undefined;
			this.modelSwitchProgress = undefined;
			this.loadingProgress = undefined;
		}
		this.notifyProgressChange();
	}

	/** Internal: set model switch progress */
	setModelSwitchProgress(progress: ModelSwitchProgress | undefined): void {
		this.modelSwitchProgress = progress;
		if (progress) {
			this.prefillProgress = undefined;
			this.genProgress = undefined;
			this.queuedProgress = undefined;
			this.sendingProgress = undefined;
		}
		this.notifyProgressChange();
	}

	/** Internal: set loading progress */
	setLoadingProgress(progress: LoadingProgress | undefined): void {
		this.loadingProgress = progress;
		if (progress) {
			this.prefillProgress = undefined;
			this.genProgress = undefined;
			this.queuedProgress = undefined;
			this.sendingProgress = undefined;
		}
		this.notifyProgressChange();
	}

	/** Internal: clear active stream progress */
	clearProgress(options?: { preserveQueued?: boolean }): void {
		this.prefillProgress = undefined;
		this.genProgress = undefined;
		this.sendingProgress = undefined;
		this.modelSwitchProgress = undefined;
		this.loadingProgress = undefined;
		if (!options?.preserveQueued) {
			this.queuedProgress = undefined;
			this.queuedStartAt = undefined;
		}
		this.notifyProgressChange();
	}

	/** Internal: clear extension statuses */
	clearExtensionStatuses(): void {
		this.extensionStatuses.clear();
	}

	private notifyProgressChange(): void {
		for (const cb of this.progressChangeCallbacks) cb();
	}

	/** Number of unique providers with available models (for footer display) */
	getAvailableProviderCount(): number {
		return this.availableProviderCount;
	}

	/** Internal: update available provider count */
	setAvailableProviderCount(count: number): void {
		this.availableProviderCount = count;
	}

	setCwd(cwd: string): void {
		if (this.cwd === cwd) {
			return;
		}

		this.cwd = cwd;
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.clearGitWatchers();
		this.cachedBranch = undefined;
		this.gitPaths = findGitPaths(cwd);
		this.setupGitWatcher();
		this.refreshIndexingStatus();
		this.notifyBranchChange();
	}

	/** Internal: cleanup */
	dispose(): void {
		this.disposed = true;
		clearInterval(this.indexingStatusTimer);
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.clearGitWatchers();
		this.branchChangeCallbacks.clear();
		this.progressChangeCallbacks.clear();
	}

	private notifyBranchChange(): void {
		for (const cb of this.branchChangeCallbacks) cb();
	}

	private getIndexingRoot(): string {
		return findIndexWorkspaceRoot(this.cwd);
	}

	private refreshIndexingStatus(): void {
		if (this.disposed) return;
		const nextStatus = this.indexingService.getStatus(this.getIndexingRoot());
		if (sameIndexingStatus(this.indexingStatus, nextStatus)) return;
		this.indexingStatus = nextStatus;
		this.notifyProgressChange();
	}

	private scheduleRefresh(): void {
		if (this.disposed || this.refreshTimer) return;
		if (this.refreshInFlight) {
			this.refreshPending = true;
			return;
		}
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = null;
			void this.refreshGitBranchAsync();
		}, FooterDataProvider.WATCH_DEBOUNCE_MS);
	}

	private async refreshGitBranchAsync(): Promise<void> {
		if (this.disposed) return;
		if (this.refreshInFlight) {
			this.refreshPending = true;
			return;
		}

		this.refreshInFlight = true;
		try {
			const nextBranch = await this.resolveGitBranchAsync();
			if (this.disposed) return;
			if (this.cachedBranch !== undefined && this.cachedBranch !== nextBranch) {
				this.cachedBranch = nextBranch;
				this.notifyBranchChange();
				return;
			}
			this.cachedBranch = nextBranch;
		} finally {
			this.refreshInFlight = false;
			if (this.refreshPending && !this.disposed) {
				this.refreshPending = false;
				this.scheduleRefresh();
			}
		}
	}

	private resolveGitBranchSync(): string | null {
		try {
			if (!this.gitPaths) return null;
			const content = readFileSync(this.gitPaths.headPath, "utf8").trim();
			if (content.startsWith("ref: refs/heads/")) {
				const branch = content.slice(16);
				return branch === ".invalid" ? (resolveBranchWithGitSync(this.gitPaths.repoDir) ?? "detached") : branch;
			}
			return "detached";
		} catch {
			return null;
		}
	}

	private async resolveGitBranchAsync(): Promise<string | null> {
		try {
			if (!this.gitPaths) return null;
			const content = readFileSync(this.gitPaths.headPath, "utf8").trim();
			if (content.startsWith("ref: refs/heads/")) {
				const branch = content.slice(16);
				return branch === ".invalid"
					? ((await resolveBranchWithGitAsync(this.gitPaths.repoDir)) ?? "detached")
					: branch;
			}
			return "detached";
		} catch {
			return null;
		}
	}

	private clearGitWatchers(): void {
		closeWatcher(this.headWatcher);
		this.headWatcher = null;
		if (this.headWatchFilePath && this.headWatchFileListener) {
			unwatchFile(this.headWatchFilePath, this.headWatchFileListener);
			this.headWatchFilePath = null;
			this.headWatchFileListener = null;
		}
		closeWatcher(this.reftableWatcher);
		this.reftableWatcher = null;
		closeWatcher(this.reftableTablesListWatcher);
		this.reftableTablesListWatcher = null;
		if (this.reftableTablesListPath) {
			unwatchFile(this.reftableTablesListPath);
			this.reftableTablesListPath = null;
		}
		if (this.gitWatcherRetryTimer) {
			clearTimeout(this.gitWatcherRetryTimer);
			this.gitWatcherRetryTimer = null;
		}
	}

	private scheduleGitWatcherRetry(): void {
		if (this.disposed || this.gitWatcherRetryTimer) {
			return;
		}

		this.gitWatcherRetryTimer = setTimeout(() => {
			this.gitWatcherRetryTimer = null;
			this.setupGitWatcher();
		}, FS_WATCH_RETRY_DELAY_MS);
	}

	private handleGitWatcherError(): void {
		this.clearGitWatchers();
		this.scheduleGitWatcherRetry();
	}

	private setupGitWatcher(): void {
		this.clearGitWatchers();
		if (!this.gitPaths) return;

		const pollGitHead = shouldPollGitHead(this.gitPaths.repoDir);

		// Watch the directory containing HEAD, not HEAD itself.
		// Git uses atomic writes (write temp, rename over HEAD), which changes the inode.
		// fs.watch on a file stops working after the inode changes.
		this.headWatcher = watchWithErrorHandler(
			dirname(this.gitPaths.headPath),
			(_eventType, filename) => {
				if (!filename || filename === "HEAD") {
					this.scheduleRefresh();
				}
			},
			() => this.handleGitWatcherError(),
		);
		if (pollGitHead) {
			this.headWatchFilePath = this.gitPaths.headPath;
			this.headWatchFileListener = (current, previous) => {
				if (
					current.mtimeMs !== previous.mtimeMs ||
					current.ctimeMs !== previous.ctimeMs ||
					current.size !== previous.size
				) {
					this.scheduleRefresh();
				}
			};
			watchFile(this.headWatchFilePath, { interval: 1000 }, this.headWatchFileListener);
		}
		if (!this.headWatcher && !pollGitHead) {
			return;
		}

		// In reftable repos, branch switches update files in the reftable directory
		// instead of HEAD. Watch it separately so the footer picks up those changes.
		const reftableDir = join(this.gitPaths.commonGitDir, "reftable");
		if (existsSync(reftableDir)) {
			this.reftableWatcher = watchWithErrorHandler(
				reftableDir,
				() => {
					this.scheduleRefresh();
				},
				() => this.handleGitWatcherError(),
			);
			if (!this.reftableWatcher) {
				return;
			}

			const tablesListPath = join(reftableDir, "tables.list");
			if (existsSync(tablesListPath)) {
				this.reftableTablesListPath = tablesListPath;
				this.reftableTablesListWatcher = watchWithErrorHandler(
					tablesListPath,
					() => {
						this.scheduleRefresh();
					},
					() => this.handleGitWatcherError(),
				);
				if (!this.reftableTablesListWatcher) {
					return;
				}
				watchFile(tablesListPath, { interval: 250 }, (current, previous) => {
					if (
						current.mtimeMs !== previous.mtimeMs ||
						current.ctimeMs !== previous.ctimeMs ||
						current.size !== previous.size
					) {
						this.scheduleRefresh();
					}
				});
			}
		}
	}
}

/** Read-only view for extensions - excludes setExtensionStatus, setAvailableProviderCount and dispose */
export type ReadonlyFooterDataProvider = Pick<
	FooterDataProvider,
	| "getGitBranch"
	| "getExtensionStatuses"
	| "getAvailableProviderCount"
	| "getPrefillProgress"
	| "getGenProgress"
	| "getQueuedProgress"
	| "getSendingProgress"
	| "getModelSwitchProgress"
	| "getLoadingProgress"
	| "getIndexingStatus"
	| "onBranchChange"
	| "onProgressChange"
>;

function sameIndexingStatus(left: IndexStatus, right: IndexStatus): boolean {
	return (
		left.decision === right.decision &&
		left.indexed === right.indexed &&
		left.serviceRunning === right.serviceRunning &&
		left.ragState === right.ragState &&
		left.ragFiles === right.ragFiles &&
		left.ragChunks === right.ragChunks &&
		left.progress?.phase === right.progress?.phase &&
		left.progress?.percent === right.progress?.percent &&
		left.lastError === right.lastError
	);
}
