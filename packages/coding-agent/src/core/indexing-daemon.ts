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

export interface IndexingDaemonOptions {
	agentDir: string;
	qdrantBinary: string;
	qdrantDataDirectory: string;
	pythonExecutable: string;
	embeddingModel: string;
	debounceMs?: number;
	retryMs?: number;
	reconcileMs?: number;
	serviceFactory?: (workspaceRoot: string) => CodeRagService;
	ensureBackends?: () => Promise<void>;
	disposeBackends?: () => Promise<void>;
	watchFactory?: WatchFactory;
}

interface RepositoryRuntime {
	root: string;
	service: CodeRagService;
	watcher: FSWatcher | null;
	dirty: boolean;
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
		Pick<IndexingDaemonOptions, "agentDir" | "debounceMs" | "retryMs" | "reconcileMs">
	>;
	private readonly serviceFactory: (workspaceRoot: string) => CodeRagService;
	private readonly ensureBackends: () => Promise<void>;
	private readonly disposeBackends: () => Promise<void>;
	private readonly watchFactory: WatchFactory;
	private readonly runtimes = new Map<string, RepositoryRuntime>();
	private readonly startedAt = new Date().toISOString();
	private registryWatcher: FSWatcher | null = null;
	private registryWatchRetryTimer: ReturnType<typeof setTimeout> | undefined;
	private registrySyncPromise: Promise<void> | undefined;
	private registrySyncRequested = false;
	private reconcileTimer: ReturnType<typeof setInterval> | undefined;
	private drainPromise: Promise<void> | undefined;
	private disposed = false;

	constructor(options: IndexingDaemonOptions) {
		this.options = {
			agentDir: options.agentDir,
			debounceMs: options.debounceMs ?? 750,
			retryMs: options.retryMs ?? 30_000,
			reconcileMs: options.reconcileMs ?? 5 * 60_000,
		};
		const qdrantManager = new QdrantServerManager(6333, {
			qdrantBinary: options.qdrantBinary,
			dataDirectory: options.qdrantDataDirectory,
			startupTimeoutMs: 30_000,
			onLog: (level, message) => this.log(level, message),
		});
		const embeddingManager = new EmbeddingServerManager(8081, options.embeddingModel, {
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
				}));
		this.ensureBackends =
			options.ensureBackends ??
			(async () => {
				await qdrantManager.ensureStarted();
				await embeddingManager.ensureStarted();
			});
		this.disposeBackends =
			options.disposeBackends ??
			(async () => {
				embeddingManager.kill();
				qdrantManager.kill();
			});
		this.watchFactory =
			options.watchFactory ??
			((target, watchOptions, listener) => fs.watch(target, { ...watchOptions, encoding: "utf8" }, listener));
	}

	async start(): Promise<void> {
		if (this.disposed) throw new Error("Indexing daemon has been disposed");
		fs.mkdirSync(this.options.agentDir, { recursive: true, mode: 0o700 });
		this.watchRegistry();
		await this.syncRegistry();
		this.reconcileTimer = setInterval(() => void this.reconcile(), this.options.reconcileMs);
		this.writeStatus();
	}

	async stop(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.registryWatcher?.close();
		this.registryWatcher = null;
		if (this.registryWatchRetryTimer) clearTimeout(this.registryWatchRetryTimer);
		if (this.reconcileTimer) clearInterval(this.reconcileTimer);
		const registrySyncPromise = this.registrySyncPromise;
		if (registrySyncPromise) await registrySyncPromise;
		for (const runtime of this.runtimes.values()) this.closeRuntime(runtime);
		await this.drainPromise;
		await Promise.allSettled([...this.runtimes.values()].map((runtime) => runtime.service.dispose()));
		await this.disposeBackends();
		this.runtimes.clear();
		this.writeStatus(false);
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
		const enabledRoots = new Set(
			loadIndexedRepos(this.options.agentDir)
				.filter((entry) => entry.decision === "enabled")
				.map((entry) => canonicalizePath(entry.path))
				.filter((root) => isDirectory(root)),
		);

		const retiredRuntimes: RepositoryRuntime[] = [];
		for (const [root, runtime] of this.runtimes) {
			if (enabledRoots.has(root)) continue;
			this.closeRuntime(runtime);
			this.runtimes.delete(root);
			retiredRuntimes.push(runtime);
		}
		if (retiredRuntimes.length > 0) {
			this.writeStatus();
			await this.drainPromise;
			await Promise.allSettled(retiredRuntimes.map((runtime) => runtime.service.dispose()));
		}
		if (this.disposed) return;
		for (const root of enabledRoots) {
			if (this.runtimes.has(root)) continue;
			const runtime: RepositoryRuntime = {
				root,
				service: this.serviceFactory(root),
				watcher: null,
				dirty: false,
				state: "queued",
				indexedFiles: 0,
				indexedChunks: 0,
				updatedAt: new Date().toISOString(),
			};
			this.runtimes.set(root, runtime);
			this.watchRepository(runtime);
			this.requestRefresh(runtime, false);
		}
		this.writeStatus();
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

	private requestRefresh(runtime: RepositoryRuntime, debounce: boolean): void {
		if (this.disposed || this.runtimes.get(runtime.root) !== runtime) return;
		if (runtime.debounceTimer) clearTimeout(runtime.debounceTimer);
		const queue = () => {
			runtime.debounceTimer = undefined;
			runtime.dirty = true;
			runtime.state = "queued";
			delete runtime.progress;
			runtime.updatedAt = new Date().toISOString();
			this.writeStatus();
			this.startDrain();
		};
		if (debounce) runtime.debounceTimer = setTimeout(queue, this.options.debounceMs);
		else queue();
	}

	private startDrain(): void {
		if (this.drainPromise || this.disposed) return;
		this.drainPromise = this.drain().finally(() => {
			this.drainPromise = undefined;
			if (!this.disposed && [...this.runtimes.values()].some((runtime) => runtime.dirty)) this.startDrain();
		});
	}

	private async drain(): Promise<void> {
		while (!this.disposed) {
			const runtime = [...this.runtimes.values()].find((candidate) => candidate.dirty);
			if (!runtime) return;
			runtime.dirty = false;
			runtime.state = "initializing";
			runtime.updatedAt = new Date().toISOString();
			delete runtime.progress;
			delete runtime.lastError;
			this.writeStatus();
			try {
				await this.ensureBackends();
				const initialized = await runtime.service.initialize({ checkFreshness: true });
				runtime.state = initialized.state;
				runtime.indexedFiles = initialized.indexedFiles;
				runtime.indexedChunks = initialized.indexedChunks;
				const summary = await runtime.service.refresh({
					onProgress: (progress) => this.updateRuntimeProgress(runtime, progress),
				});
				runtime.state = summary.status.state;
				runtime.indexedFiles = summary.status.indexedFiles;
				runtime.indexedChunks = summary.status.indexedChunks;
				delete runtime.progress;
				delete runtime.lastError;
			} catch (error) {
				runtime.state = "error";
				delete runtime.progress;
				runtime.lastError = safeErrorMessage(error);
				if (!this.disposed && this.runtimes.get(runtime.root) === runtime && !runtime.retryTimer) {
					runtime.retryTimer = setTimeout(() => {
						runtime.retryTimer = undefined;
						this.requestRefresh(runtime, false);
					}, this.options.retryMs);
				}
			}
			runtime.updatedAt = new Date().toISOString();
			this.writeStatus();
		}
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
