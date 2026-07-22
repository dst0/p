import { randomUUID } from "node:crypto";
import fs, { type FSWatcher } from "node:fs";
import path from "node:path";
import {
	type CodeRagService,
	EmbeddingServerManager,
	type IndexingProgress,
	QdrantServerManager,
	type RagState,
	WorkspaceCodeRagService,
} from "@dst0/p-code-index";
import { INDEXED_REPOS_FILE, loadIndexedRepos } from "./indexed-repos.ts";
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

interface RepositoryRuntime {
	root: string;
	service: CodeRagService;
	watcher: FSWatcher | null;
	dirty: boolean;
	active: boolean;
	queueOrder: number;
	queuePriority: number;
	registryUpdatedAt: string;
	state: RagState | "queued" | "error";
	indexedFiles: number;
	indexedChunks: number;
	progress?: IndexingProgress;
	lastError?: string;
	updatedAt: string;
	debounceTimer?: ReturnType<typeof setTimeout>;
	retryTimer?: ReturnType<typeof setTimeout>;
	watchRetryTimer?: ReturnType<typeof setTimeout>;
}

const DRAIN_MAX_CONCURRENCY = 2;
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

	async stop(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.registryWatcher?.close();
		this.registryWatcher = null;
		if (this.registryWatchRetryTimer) clearTimeout(this.registryWatchRetryTimer);
		if (this.reconcileTimer) clearInterval(this.reconcileTimer);
		const registrySyncPromise = this.registrySyncPromise;
		try {
			if (registrySyncPromise) await Promise.allSettled([registrySyncPromise]);
			await this.stopDrain();
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
		await this.syncRegistry();
		for (const runtime of this.runtimes.values()) this.requestRefresh(runtime, false);
	}

	private syncRegistry(): Promise<void> {
		if (this.registrySyncPromise) {
			this.registrySyncRequested = true;
			return this.registrySyncPromise;
		}
		this.registrySyncPromise = this.runRegistrySync().finally(() => {
			this.registrySyncPromise = undefined;
			if (this.registrySyncRequested && !this.disposed) {
				this.registrySyncRequested = false;
				void this.syncRegistry();
			}
		});
		return this.registrySyncPromise;
	}

	private async runRegistrySync(): Promise<void> {
		if (this.disposed) return;
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
			await this.stopDrain();
			await Promise.allSettled(retiredRuntimes.map((runtime) => runtime.service.dispose()));
		}
		if (this.disposed) return;
		for (const entry of enabledEntries) {
			const root = entry.root;
			const existing = this.runtimes.get(root);
			if (existing) {
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
				registryUpdatedAt: entry.updatedAt,
				state: "queued",
				indexedFiles: 0,
				indexedChunks: 0,
				updatedAt: new Date().toISOString(),
			};
			this.runtimes.set(root, runtime);
			this.watchRepository(runtime);
			this.requestRefresh(runtime, false, parseRequestPriority(entry.updatedAt), false);
		}
		this.writeStatus();
		this.startDrain();
	}

	private watchRegistry(): void {
		if (this.disposed || this.registryWatcher) return;
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
		if (this.disposed || this.registryWatchRetryTimer) return;
		this.registryWatchRetryTimer = setTimeout(() => {
			this.registryWatchRetryTimer = undefined;
			this.watchRegistry();
		}, this.options.retryMs);
	}

	private watchRepository(runtime: RepositoryRuntime): void {
		if (this.disposed || runtime.watcher) return;
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
		if (this.disposed || runtime.watchRetryTimer) return;
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
		if (this.disposed || this.runtimes.get(runtime.root) !== runtime) return;
		if (runtime.debounceTimer) clearTimeout(runtime.debounceTimer);
		const queue = () => {
			runtime.debounceTimer = undefined;
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
		if (this.disposed || this.drainPaused) return;
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
				if (!this.disposed && !this.drainPaused) this.startDrain();
			});
		}
	}

	private async drainWorker(w: DrainWorker): Promise<void> {
		while (!this.disposed && !w.stop) {
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
			runtime.dirty = false;
			runtime.active = true;
			runtime.queueOrder = 0;
			runtime.queuePriority = 0;
			w.runtime = runtime;
			runtime.state = runtime.indexedFiles > 0 ? "updating" : "initializing";
			runtime.updatedAt = new Date().toISOString();
			delete runtime.progress;
			delete runtime.lastError;
			this.writeStatus();

			try {
				await this.runRepositoryOperation(w, async (signal) => {
					await this.ensureBackends(signal);
					const initialized = await runtime.service.initialize({ checkFreshness: true });
					runtime.state = initialized.state;
					runtime.indexedFiles = initialized.indexedFiles;
					runtime.indexedChunks = initialized.indexedChunks;
					const summary = await runtime.service.refresh(
						{ onProgress: (progress) => this.updateRuntimeProgress(runtime, progress) },
						signal,
					);
					runtime.state = summary.status.state;
					runtime.indexedFiles = summary.status.indexedFiles;
					runtime.indexedChunks = summary.status.indexedChunks;
					delete runtime.progress;
					delete runtime.lastError;
				});
			} catch (error) {
				if (this.disposed || w.stop) return;
				runtime.state = "error";
				delete runtime.progress;
				runtime.lastError = safeErrorMessage(error);
				this.log("error", `Indexing failed for ${runtime.root}: ${runtime.lastError}`);
				if (!this.disposed && this.runtimes.get(runtime.root) === runtime && !runtime.retryTimer) {
					runtime.retryTimer = setTimeout(() => {
						runtime.retryTimer = undefined;
						this.requestRefresh(runtime, false);
					}, this.options.retryMs);
				}
			} finally {
				runtime.active = false;
				if (w.runtime === runtime) w.runtime = undefined;
			}
			runtime.updatedAt = new Date().toISOString();
			this.writeStatus();
		}
	}

	private async runRepositoryOperation(
		worker: DrainWorker,
		operation: (signal: AbortSignal) => Promise<void>,
	): Promise<void> {
		const controller = new AbortController();
		worker.controller = controller;
		const message = `Indexing operation timed out after ${this.options.repositoryTimeoutMs}ms`;
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort(new Error(message));
		}, this.options.repositoryTimeoutMs);
		try {
			await operation(controller.signal);
		} catch (error) {
			if (timedOut) throw new Error(message);
			throw error;
		} finally {
			clearTimeout(timer);
			if (worker.controller === controller) worker.controller = undefined;
		}
	}

	private async stopDrain(): Promise<void> {
		this.drainPaused = true;
		const workers = [...this.drainWorkers];
		for (const worker of workers) {
			worker.stop = true;
			if (!this.disposed && worker.runtime && this.runtimes.get(worker.runtime.root) === worker.runtime) {
				worker.runtime.dirty = true;
			}
			worker.controller?.abort(new Error("Indexing daemon stopped"));
		}
		await Promise.allSettled(workers.map((worker) => worker.promise));
		this.drainWorkers = [];
		this.drainPaused = false;
	}

	private updateRuntimeProgress(runtime: RepositoryRuntime, progress: IndexingProgress): void {
		const normalized = {
			phase: progress.phase,
			percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
		} satisfies IndexingProgress;
		if (runtime.progress?.phase === normalized.phase && runtime.progress.percent === normalized.percent) return;
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
