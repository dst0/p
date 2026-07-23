import { randomUUID } from "node:crypto";
import fs, { type FSWatcher } from "node:fs";
import path from "node:path";
import {
	type CodeRagService,
	EmbeddingServerManager,
	type IndexingProgress,
	QdrantServerManager,
	type RagState,
	type RagStatus,
	WorkspaceCodeRagService,
} from "@dst0/p-code-index";
import { acknowledgeIndexingPriorityForRepo, INDEXED_REPOS_FILE, loadIndexedRepos } from "./indexed-repos.ts";
import {
	type IndexingServiceStatusData,
	type RepositoryServiceStatus,
	writeIndexingServiceStatus,
} from "./indexing-service.ts";

type WatchFactory = (
	target: string,
	options: { recursive: boolean },
	listener: (eventType: string, filename: string | Buffer | null) => void,
) => FSWatcher;

interface DrainWorker {
	stop: boolean;
	done: boolean;
	preemptedRuntime?: RepositoryRuntime;
	controller?: AbortController;
	runtime?: RepositoryRuntime;
	promise: Promise<void>;
}

interface DaemonLock {
	path: string;
	token: string;
}

export interface IndexingDaemonOptions {
	agentDir: string;
	qdrantBinary: string;
	qdrantDataDirectory: string;
	pythonExecutable: string;
	embeddingModel: string;
	debounceMs?: number;
	retryMs?: number;
	reconcileMs?: number;
	repositoryTimeoutMs?: number;
	serviceFactory?: (workspaceRoot: string) => CodeRagService;
	ensureBackends?: (signal?: AbortSignal) => Promise<void>;
	disposeBackends?: () => Promise<void>;
	watchFactory?: WatchFactory;
}

export interface IndexingDaemonStopOptions {
	/** Allow active repository refreshes to finish before resources are disposed. */
	graceful?: boolean;
}

interface RepositoryRuntime {
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
	progress?: IndexingProgress;
	/** Timestamp when the current indexing run started. */
	indexingStartedAt?: string;
	progressSamples?: Array<{ timestamp: number; percent: number }>;
	lastError?: string;
	updatedAt: string;
	debounceTimer?: ReturnType<typeof setTimeout>;
	retryTimer?: ReturnType<typeof setTimeout>;
	watchRetryTimer?: ReturnType<typeof setTimeout>;
}

const DRAIN_MAX_CONCURRENCY = 2;
const MANUAL_PRIORITY_OFFSET = 1_000_000_000_000_000;
const DEFAULT_REPOSITORY_TIMEOUT_MS = 30 * 60_000;
const DAEMON_LOCK_INITIALIZATION_GRACE_MS = 10_000;

const IGNORED_WATCH_PATH_SEGMENTS = new Set([
	".git",
	".hg",
	".p",
	".svn",
	".venv",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"storage",
	"target",
]);

export class IndexingDaemon {
	private readonly options: Required<
		Pick<IndexingDaemonOptions, "agentDir" | "debounceMs" | "retryMs" | "reconcileMs" | "repositoryTimeoutMs">
	>;
	private readonly serviceFactory: (workspaceRoot: string) => CodeRagService;
	private readonly ensureBackends: (signal?: AbortSignal) => Promise<void>;
	private readonly disposeBackends: () => Promise<void>;
	private readonly watchFactory: WatchFactory;
	private readonly runtimes = new Map<string, RepositoryRuntime>();
	private readonly startedAt = new Date().toISOString();
	private registryWatcher: FSWatcher | null = null;
	private registryWatchRetryTimer: ReturnType<typeof setTimeout> | undefined;
	private registrySyncPromise: Promise<void> | undefined;
	private registrySyncRequested = false;
	private reconcileTimer: ReturnType<typeof setInterval> | undefined;
	private drainWorkers: DrainWorker[] = [];
	private drainPaused = false;
	private nextQueueOrder = 0;
	private daemonLock: DaemonLock | undefined;
	private quiescing = false;
	private disposed = false;

	constructor(options: IndexingDaemonOptions) {
		this.options = {
			agentDir: options.agentDir,
			debounceMs: options.debounceMs ?? 750,
			retryMs: options.retryMs ?? 30_000,
			reconcileMs: options.reconcileMs ?? 5 * 60_000,
			repositoryTimeoutMs: options.repositoryTimeoutMs ?? DEFAULT_REPOSITORY_TIMEOUT_MS,
		};
		const qdrantManager = new QdrantServerManager(6333, {
			qdrantBinary: options.qdrantBinary,
			dataDirectory: options.qdrantDataDirectory,
			startupTimeoutMs: 30_000,
			onLog: (level, message) => this.log(level, message),
		});
		const embeddingManager = new EmbeddingServerManager(18742, options.embeddingModel, {
			pythonExecutable: options.pythonExecutable,
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
		this.ensureBackends =
			options.ensureBackends ??
			(async (signal) => {
				await qdrantManager.ensureStarted(signal);
				await embeddingManager.ensureStarted(signal);
			});
		this.disposeBackends =
			options.disposeBackends ??
			(async () => {
				await Promise.all([embeddingManager.stop(), qdrantManager.stop()]);
			});
		this.watchFactory =
			options.watchFactory ??
			((target, watchOptions, listener) => fs.watch(target, { ...watchOptions, encoding: "utf8" }, listener));
	}

	async start(): Promise<void> {
		if (this.disposed) throw new Error("Indexing daemon has been disposed");
		fs.mkdirSync(this.options.agentDir, { recursive: true, mode: 0o700 });
		this.daemonLock = acquireDaemonLock(this.options.agentDir);
		try {
			this.watchRegistry();
			await this.syncRegistry();
			this.reconcileTimer = setInterval(() => void this.reconcile(), this.options.reconcileMs);
			this.writeStatus();
		} catch (error) {
			try {
				await this.stop();
			} catch {
				// Preserve the startup failure after best-effort cleanup.
			}
			throw error;
		}
	}

	/**
	 * Stop accepting new refresh requests and let currently active repository
	 * operations finish. The process remains alive so an installer can stop the
	 * service immediately afterwards without interrupting index writes.
	 */
	async prepareForRestart(): Promise<void> {
		if (this.disposed || this.quiescing) return;
		this.quiescing = true;
		this.pauseIntake();
		const registrySyncPromise = this.registrySyncPromise;
		if (registrySyncPromise) await Promise.allSettled([registrySyncPromise]);
		await this.stopDrain(false, false);
		this.writeStatus();
	}

	async stop(options: IndexingDaemonStopOptions = {}): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.quiescing = true;
		this.pauseIntake();
		const registrySyncPromise = this.registrySyncPromise;
		try {
			if (registrySyncPromise) await Promise.allSettled([registrySyncPromise]);
			await this.stopDrain(!options.graceful, false);
			for (const runtime of this.runtimes.values()) this.closeRuntime(runtime);
			await Promise.allSettled([...this.runtimes.values()].map((runtime) => runtime.service.dispose()));
			await this.disposeBackends();
		} finally {
			this.runtimes.clear();
			try {
				this.writeStatus(false);
			} finally {
				if (this.daemonLock) releaseDaemonLock(this.daemonLock);
				this.daemonLock = undefined;
			}
		}
	}

	private async reconcile(): Promise<void> {
		if (this.disposed || this.quiescing) return;
		await this.syncRegistry();
		if (this.disposed || this.quiescing) return;
		for (const runtime of this.runtimes.values()) {
			if (runtime.active || runtime.dirty || runtime.debounceTimer) continue;
			try {
				const status = await runtime.service.initialize({ checkFreshness: true });
				this.applyRuntimeStatus(runtime, status);
				if (shouldRefreshState(status.state)) this.requestRefresh(runtime, false);
			} catch (error) {
				runtime.state = "error";
				runtime.lastError = safeErrorMessage(error);
				runtime.updatedAt = new Date().toISOString();
				this.requestRefresh(runtime, false);
			}
		}
		this.writeStatus();
	}

	private syncRegistry(): Promise<void> {
		if (this.registrySyncPromise) {
			this.registrySyncRequested = true;
			return this.registrySyncPromise;
		}
		this.registrySyncPromise = this.runRegistrySync().finally(() => {
			this.registrySyncPromise = undefined;
			if (this.registrySyncRequested && !this.disposed && !this.quiescing) {
				this.registrySyncRequested = false;
				void this.syncRegistry();
			}
		});
		return this.registrySyncPromise;
	}

	private async runRegistrySync(): Promise<void> {
		if (this.disposed || this.quiescing) return;
		const enabledEntries = loadIndexedRepos(this.options.agentDir)
			.filter((entry) => entry.decision === "enabled")
			.map((entry) => ({ ...entry, root: canonicalizePath(entry.path) }))
			.filter((entry) => isDirectory(entry.root));
		const enabledRoots = new Set(enabledEntries.map((entry) => entry.root));

		const retiredRuntimes: RepositoryRuntime[] = [];
		for (const [root, runtime] of this.runtimes) {
			if (enabledRoots.has(root)) continue;
			this.closeRuntime(runtime);
			this.runtimes.delete(root);
			retiredRuntimes.push(runtime);
		}
		if (retiredRuntimes.length > 0) {
			this.writeStatus();
			await this.stopDrain(true, true);
			await Promise.allSettled(retiredRuntimes.map((runtime) => runtime.service.dispose()));
		}
		if (this.disposed || this.quiescing) return;

		const hasNewRuntimes = enabledEntries.some((entry) => !this.runtimes.has(entry.root));
		if (hasNewRuntimes) await this.ensureBackends();

		for (const entry of enabledEntries) {
			const root = entry.root;
			const existing = this.runtimes.get(root);
			if (existing) {
				if (entry.priorityRequest && existing.registryPriorityRequestId !== entry.priorityRequest.id) {
					existing.registryPriorityRequestId = entry.priorityRequest.id;
					if (existing.active) {
						this.acknowledgePriorityRequest(existing, entry.priorityRequest.id);
					} else {
						this.requestRefresh(
							existing,
							false,
							parseManualRequestPriority(entry.priorityRequest.requestedAt),
							false,
						);
						this.preemptFor(existing);
					}
				}
				if (existing.registryUpdatedAt !== entry.updatedAt) {
					existing.registryUpdatedAt = entry.updatedAt;
					this.requestRefresh(existing, false, parseRequestPriority(entry.updatedAt), false);
				}
				continue;
			}
			const runtime: RepositoryRuntime = {
				root,
				service: this.serviceFactory(root),
				watcher: null,
				dirty: false,
				active: false,
				queueOrder: 0,
				queuePriority: 0,
				activePriority: 0,
				registryUpdatedAt: entry.updatedAt,
				registryPriorityRequestId: entry.priorityRequest?.id,
				state: "queued",
				indexedFiles: 0,
				indexedChunks: 0,
				updatedAt: new Date().toISOString(),
			};
			this.runtimes.set(root, runtime);
			this.watchRepository(runtime);

			try {
				const initializedStatus = await runtime.service.initialize({ checkFreshness: true });
				this.applyRuntimeStatus(runtime, initializedStatus);
				if (entry.priorityRequest || shouldRefreshState(initializedStatus.state)) {
					this.requestRefresh(
						runtime,
						false,
						entry.priorityRequest
							? parseManualRequestPriority(entry.priorityRequest.requestedAt)
							: parseRequestPriority(entry.updatedAt),
						false,
					);
				}
			} catch (error) {
				runtime.state = "error";
				runtime.lastError = safeErrorMessage(error);
				this.requestRefresh(runtime, false, parseRequestPriority(entry.updatedAt), false);
			}
		}
		this.writeStatus();
		this.startDrain();
	}

	private watchRegistry(): void {
		if (this.disposed || this.quiescing || this.registryWatcher) return;
		try {
			const watcher = this.watchFactory(this.options.agentDir, { recursive: false }, (_eventType, filename) => {
				const name = filename === null ? undefined : String(filename);
				if (name && name !== INDEXED_REPOS_FILE) return;
				void this.syncRegistry();
			});
			watcher.on("error", () => this.handleRegistryWatchError());
			this.registryWatcher = watcher;
		} catch {
			this.handleRegistryWatchError();
		}
	}

	private handleRegistryWatchError(): void {
		this.registryWatcher?.close();
		this.registryWatcher = null;
		if (this.disposed || this.quiescing || this.registryWatchRetryTimer) return;
		this.registryWatchRetryTimer = setTimeout(() => {
			this.registryWatchRetryTimer = undefined;
			this.watchRegistry();
		}, this.options.retryMs);
	}

	private watchRepository(runtime: RepositoryRuntime): void {
		if (this.disposed || this.quiescing || runtime.watcher) return;
		try {
			const watcher = this.watchFactory(runtime.root, { recursive: true }, (_eventType, filename) => {
				if (filename !== null && isIgnoredWatchPath(String(filename))) return;
				this.requestRefresh(runtime, true);
			});
			watcher.on("error", () => this.handleRepositoryWatchError(runtime));
			runtime.watcher = watcher;
		} catch {
			this.handleRepositoryWatchError(runtime);
		}
	}

	private handleRepositoryWatchError(runtime: RepositoryRuntime): void {
		runtime.watcher?.close();
		runtime.watcher = null;
		if (this.disposed || this.quiescing || runtime.watchRetryTimer) return;
		runtime.watchRetryTimer = setTimeout(() => {
			runtime.watchRetryTimer = undefined;
			if (this.runtimes.get(runtime.root) === runtime) this.watchRepository(runtime);
		}, this.options.retryMs);
	}

	private requestRefresh(
		runtime: RepositoryRuntime,
		debounce: boolean,
		priority: number = 0,
		startDrain: boolean = true,
	): void {
		if (this.disposed || this.quiescing || this.runtimes.get(runtime.root) !== runtime) return;
		if (runtime.debounceTimer) clearTimeout(runtime.debounceTimer);
		const queue = () => {
			runtime.debounceTimer = undefined;
			if (this.disposed || this.quiescing || this.runtimes.get(runtime.root) !== runtime) return;
			const wasDirty = runtime.dirty;
			runtime.dirty = true;
			if (!wasDirty) runtime.queueOrder = ++this.nextQueueOrder;
			runtime.queuePriority = Math.max(runtime.queuePriority, priority);
			// Don't reset state/progress when already actively indexing.
			// A file change mid-index should trigger a refresh after the current
			// one completes (via dirty=true) without flickering the display to "queued".
			if (runtime.active) {
				this.writeStatus();
			} else {
				runtime.state = "queued";
				delete runtime.progress;
				runtime.updatedAt = new Date().toISOString();
				this.writeStatus();
				if (startDrain) this.startDrain();
			}
		};
		if (debounce) runtime.debounceTimer = setTimeout(queue, this.options.debounceMs);
		else queue();
	}

	private startDrain(): void {
		if (this.disposed || this.quiescing || this.drainPaused) return;
		this.drainWorkers = this.drainWorkers.filter((worker) => !worker.done);
		while (
			this.drainWorkers.length < DRAIN_MAX_CONCURRENCY &&
			[...this.runtimes.values()].some((runtime) => runtime.dirty && !runtime.active)
		) {
			const worker: DrainWorker = { stop: false, done: false, promise: Promise.resolve() };
			this.drainWorkers.push(worker);
			worker.promise = this.drainWorker(worker).finally(() => {
				worker.done = true;
				this.drainWorkers = this.drainWorkers.filter((candidate) => candidate !== worker);
				if (!this.disposed && !this.quiescing && !this.drainPaused) this.startDrain();
			});
		}
	}

	private async drainWorker(w: DrainWorker): Promise<void> {
		while (!this.disposed && !this.quiescing && !w.stop) {
			let runtime: RepositoryRuntime | undefined;
			for (const candidate of this.runtimes.values()) {
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
			if (runtime.registryPriorityRequestId) {
				this.acknowledgePriorityRequest(runtime, runtime.registryPriorityRequestId);
			}
			runtime.state = runtime.indexedFiles > 0 ? "updating" : "initializing";
			runtime.updatedAt = new Date().toISOString();
			runtime.indexingStartedAt = runtime.updatedAt;
			runtime.progressSamples = [];
			delete runtime.progress;
			delete runtime.lastError;
			this.writeStatus();

			try {
				await this.runRepositoryOperation(w, async (signal, reportActivity) => {
					await this.ensureBackends(signal);
					const initialized = await runtime.service.initialize({ checkFreshness: true });
					this.applyRuntimeStatus(runtime, initialized);
					const summary = await runtime.service.refresh(
						{
							onProgress: (progress) => {
								reportActivity();
								this.updateRuntimeProgress(runtime, progress);
							},
						},
						signal,
					);
					this.applyRuntimeStatus(runtime, summary.status);
					delete runtime.progress;
					delete runtime.lastError;
				});
			} catch (error) {
				if (this.disposed || this.quiescing || w.stop) return;
				if (w.preemptedRuntime === runtime) {
					runtime.state = "queued";
					delete runtime.progress;
					delete runtime.lastError;
				} else {
					runtime.state = "error";
					delete runtime.progress;
					runtime.lastError = safeErrorMessage(error);
					this.log("error", `Indexing failed for ${runtime.root}: ${runtime.lastError}`);
					if (!this.disposed && !this.quiescing && this.runtimes.get(runtime.root) === runtime && !runtime.retryTimer) {
						runtime.retryTimer = setTimeout(() => {
							runtime.retryTimer = undefined;
							this.requestRefresh(runtime, false);
						}, this.options.retryMs);
					}
				}
			} finally {
				if (w.preemptedRuntime === runtime) w.preemptedRuntime = undefined;
				runtime.active = false;
				runtime.activePriority = 0;
				if (w.runtime === runtime) w.runtime = undefined;
			}
			runtime.updatedAt = new Date().toISOString();
			this.writeStatus();
		}
	}

	private preemptFor(runtime: RepositoryRuntime): void {
		if (runtime.active || !runtime.dirty) return;
		let victim: DrainWorker | undefined;
		for (const worker of this.drainWorkers) {
			if (
				worker.stop ||
				worker.preemptedRuntime ||
				!worker.controller ||
				!worker.runtime ||
				worker.runtime === runtime
			)
				continue;
			if (!victim || worker.runtime.activePriority < (victim.runtime?.activePriority ?? Number.POSITIVE_INFINITY)) {
				victim = worker;
			}
		}
		if (!victim?.runtime || runtime.queuePriority <= victim.runtime.activePriority) return;
		this.requestRefresh(victim.runtime, false, victim.runtime.activePriority, false);
		victim.preemptedRuntime = victim.runtime;
		victim.controller?.abort(new Error(`Indexing preempted for ${runtime.root}`));
	}

	private acknowledgePriorityRequest(runtime: RepositoryRuntime, requestId: string): void {
		acknowledgeIndexingPriorityForRepo(runtime.root, requestId, this.options.agentDir);
		if (runtime.registryPriorityRequestId === requestId) runtime.registryPriorityRequestId = undefined;
	}

	private async runRepositoryOperation(
		worker: DrainWorker,
		operation: (signal: AbortSignal, reportActivity: () => void) => Promise<void>,
	): Promise<void> {
		const controller = new AbortController();
		worker.controller = controller;
		const message = `Indexing operation timed out after ${this.options.repositoryTimeoutMs}ms without progress`;
		let timedOut = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const reportActivity = () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				timedOut = true;
				controller.abort(new Error(message));
			}, this.options.repositoryTimeoutMs);
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

	private async stopDrain(abortActive: boolean = true, resume: boolean = true): Promise<void> {
		this.drainPaused = true;
		const workers = [...this.drainWorkers];
		for (const worker of workers) {
			worker.stop = true;
			if (!this.disposed && worker.runtime && this.runtimes.get(worker.runtime.root) === worker.runtime) {
				worker.runtime.dirty = true;
			}
			if (abortActive) worker.controller?.abort(new Error("Indexing daemon stopped"));
		}
		await Promise.allSettled(workers.map((worker) => worker.promise));
		this.drainWorkers = [];
		this.drainPaused = !resume;
		if (resume && !this.disposed && !this.quiescing) this.startDrain();
	}

	private applyRuntimeStatus(runtime: RepositoryRuntime, status: RagStatus): void {
		runtime.state = status.state;
		runtime.indexedFiles = status.indexedFiles;
		runtime.indexedChunks = status.indexedChunks;
		if (status.lastError) runtime.lastError = status.lastError.message;
		else delete runtime.lastError;
		runtime.updatedAt = new Date().toISOString();
	}

	private pauseIntake(): void {
		this.registryWatcher?.close();
		this.registryWatcher = null;
		if (this.registryWatchRetryTimer) clearTimeout(this.registryWatchRetryTimer);
		this.registryWatchRetryTimer = undefined;
		if (this.reconcileTimer) clearInterval(this.reconcileTimer);
		this.reconcileTimer = undefined;
		for (const runtime of this.runtimes.values()) {
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

	private updateRuntimeProgress(runtime: RepositoryRuntime, progress: IndexingProgress): void {
		const now = Date.now();
		const percent = Math.max(0, Math.min(100, Math.round(progress.percent * 10) / 10));
		runtime.progressSamples ??= [];
		runtime.progressSamples.push({ timestamp: now, percent });
		// Keep last 60 seconds of samples
		const cutoff = now - 60_000;
		runtime.progressSamples = runtime.progressSamples.filter((s) => s.timestamp >= cutoff);

		let etaSeconds: number | undefined;
		if (percent > 0 && percent < 100) {
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
			// Fallback to overall startedAt if sliding window isn't warm yet
			if (etaSeconds === undefined && runtime.indexingStartedAt) {
				const elapsedSec = (now - Date.parse(runtime.indexingStartedAt)) / 1000;
				if (elapsedSec > 3) {
					const overallPercentPerSec = percent / elapsedSec;
					if (overallPercentPerSec > 0) {
						etaSeconds = Math.max(0, Math.round((100 - percent) / overallPercentPerSec));
					}
				}
			}
		}

		const normalized: IndexingProgress = {
			phase: progress.phase,
			percent,
			startedAt: runtime.indexingStartedAt,
			...(etaSeconds !== undefined ? { etaSeconds } : {}),
		};
		if (
			runtime.progress?.phase === normalized.phase &&
			runtime.progress.percent === normalized.percent &&
			runtime.progress.etaSeconds === normalized.etaSeconds
		) {
			return;
		}
		runtime.progress = normalized;
		runtime.state = runtime.indexedFiles > 0 ? "updating" : "initializing";
		runtime.updatedAt = new Date().toISOString();
		this.writeStatus();
	}

	private closeRuntime(runtime: RepositoryRuntime): void {
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

	private writeStatus(running: boolean = !this.disposed): void {
		const repos: RepositoryServiceStatus[] = [...this.runtimes.values()].map((runtime) => ({
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
			startedAt: this.startedAt,
			updatedAt: new Date().toISOString(),
			repos,
		};
		writeIndexingServiceStatus(this.options.agentDir, data);
	}

	private log(level: "debug" | "error", message: string): void {
		const line = `[code-index:${level}] ${message}`;
		if (level === "error") console.error(line);
		else console.log(line);
	}
}

function shouldRefreshState(state: RagState): boolean {
	return state !== "ready" && state !== "disabled";
}

function isDirectory(value: string): boolean {
	try {
		return fs.statSync(value).isDirectory();
	} catch {
		return false;
	}
}

function canonicalizePath(value: string): string {
	const resolved = path.resolve(value);
	try {
		return fs.realpathSync(resolved);
	} catch {
		return resolved;
	}
}

function isIgnoredWatchPath(filename: string): boolean {
	return filename
		.replaceAll("\\", "/")
		.split("/")
		.some((segment) => IGNORED_WATCH_PATH_SEGMENTS.has(segment));
}

function safeErrorMessage(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 500);
}

function parseRequestPriority(updatedAt: string): number {
	const parsed = Date.parse(updatedAt);
	return Number.isFinite(parsed) ? parsed : 0;
}

function parseManualRequestPriority(requestedAt: string): number {
	return MANUAL_PRIORITY_OFFSET + parseRequestPriority(requestedAt);
}

function acquireDaemonLock(agentDir: string): DaemonLock {
	const lockPath = path.join(agentDir, "indexing-service", "daemon.lock");
	fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
	for (;;) {
		const token = randomUUID();
		try {
			const descriptor = fs.openSync(lockPath, "wx", 0o600);
			try {
				fs.writeFileSync(
					descriptor,
					`${JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() })}\n`,
				);
			} finally {
				fs.closeSync(descriptor);
			}
			return { path: lockPath, token };
		} catch (error) {
			if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
			const owner = readDaemonLock(lockPath);
			if (owner && isProcessRunning(owner.pid)) {
				throw new Error(`Code indexing daemon is already running with pid ${owner.pid}`);
			}
			if (!owner) {
				let ageMs: number;
				try {
					ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
				} catch (statError) {
					if (statError instanceof Error && "code" in statError && statError.code === "ENOENT") continue;
					throw statError;
				}
				if (ageMs < DAEMON_LOCK_INITIALIZATION_GRACE_MS) {
					throw new Error("Code indexing daemon lock is being initialized");
				}
			}
			fs.rmSync(lockPath, { force: true });
		}
	}
}

function releaseDaemonLock(lock: DaemonLock): void {
	const owner = readDaemonLock(lock.path);
	if (owner?.token === lock.token) fs.rmSync(lock.path, { force: true });
}

function readDaemonLock(lockPath: string): { pid: number; token: string } | undefined {
	try {
		const value: unknown = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
		if (typeof value !== "object" || value === null) return undefined;
		const pid = Reflect.get(value, "pid");
		const token = Reflect.get(value, "token");
		if (!Number.isSafeInteger(pid) || typeof token !== "string") return undefined;
		return { pid: Number(pid), token };
	} catch {
		return undefined;
	}
}

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
}
