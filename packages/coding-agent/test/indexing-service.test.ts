import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
	CodeRagService,
	IndexUpdateSummary,
	RagStatus,
	RebuildIndexOptions,
	RefreshIndexOptions,
	SemanticSearchInput,
	SemanticSearchResponse,
} from "@dst0/p-code-index";
import { afterEach, describe, expect, it } from "vitest";
import { enableIndexingForRepo } from "../src/core/indexed-repos.ts";
import { IndexingDaemon } from "../src/core/indexing-daemon.ts";
import { IndexingService } from "../src/core/indexing-service.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

class FakeRagService implements CodeRagService {
	readonly workspaceRoot: string;
	refreshCount = 0;
	disposed = false;
	disposedDuringRefresh = false;
	refreshing = false;
	private refreshGate: Promise<void> | undefined;
	private releaseRefreshGate: (() => void) | undefined;

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	async initialize(): Promise<RagStatus> {
		return this.createStatus();
	}

	async status(): Promise<RagStatus> {
		return this.createStatus();
	}

	async search(input: SemanticSearchInput): Promise<SemanticSearchResponse> {
		return {
			query: input.query,
			workspaceRoot: this.workspaceRoot,
			status: this.createStatus(),
			results: [],
			diagnostics: { durationMs: 0, truncated: false },
		};
	}

	async refresh(options: RefreshIndexOptions = {}): Promise<IndexUpdateSummary> {
		this.refreshing = true;
		try {
			options.onProgress?.({ phase: "scanning", percent: 0 });
			options.onProgress?.({ phase: "indexing", percent: 37 });
			await this.refreshGate;
			this.refreshCount += 1;
			options.onProgress?.({ phase: "finalizing", percent: 100 });
			return {
				status: this.createStatus(),
				durationMs: 1,
				filesScanned: 1,
				filesAdded: 0,
				filesChanged: 1,
				filesDeleted: 0,
				filesUnchanged: 0,
				chunksEmbedded: 1,
				fullRebuild: false,
			};
		} finally {
			this.refreshing = false;
		}
	}

	async rebuild(options: RebuildIndexOptions = {}): Promise<IndexUpdateSummary> {
		return this.refresh({ onProgress: options.onProgress });
	}

	async dispose(): Promise<void> {
		this.disposedDuringRefresh = this.refreshing;
		this.disposed = true;
	}

	blockRefresh(): void {
		this.refreshGate = new Promise((resolve) => {
			this.releaseRefreshGate = resolve;
		});
	}

	releaseRefresh(): void {
		this.releaseRefreshGate?.();
		this.refreshGate = undefined;
		this.releaseRefreshGate = undefined;
	}

	private createStatus(): RagStatus {
		return {
			state: "ready",
			workspaceRoot: this.workspaceRoot,
			repoId: "fake-repo",
			indexedFiles: 1,
			indexedChunks: this.refreshCount,
			sparse: { exact: true, driftFileCount: 0 },
		};
	}
}

class AbortAwareRagService extends FakeRagService {
	abortObserved = false;

	override async refresh(options: RefreshIndexOptions = {}, signal?: AbortSignal): Promise<IndexUpdateSummary> {
		this.refreshing = true;
		options.onProgress?.({ phase: "indexing", percent: 10 });
		try {
			await new Promise<void>((_resolve, reject) => {
				const onAbort = () => {
					this.abortObserved = true;
					reject(signal?.reason ?? new Error("aborted"));
				};
				if (signal?.aborted) onAbort();
				else signal?.addEventListener("abort", onAbort, { once: true });
			});
			throw new Error("unreachable");
		} finally {
			this.refreshing = false;
		}
	}
}

describe("indexing daemon", () => {
	it("indexes enabled repositories and refreshes after file changes", async () => {
		const fixture = createFixture();
		enableIndexingForRepo(fixture.repo, fixture.agentDir);
		const services = new Map<string, FakeRagService>();
		let backendStarts = 0;
		const daemon = new IndexingDaemon({
			agentDir: fixture.agentDir,
			qdrantBinary: "unused",
			qdrantDataDirectory: path.join(fixture.agentDir, "qdrant"),
			pythonExecutable: "unused",
			embeddingModel: "unused",
			debounceMs: 20,
			retryMs: 50,
			reconcileMs: 60_000,
			serviceFactory: (workspaceRoot) => {
				const service = new FakeRagService(workspaceRoot);
				services.set(workspaceRoot, service);
				return service;
			},
			ensureBackends: async () => {
				backendStarts += 1;
			},
			disposeBackends: async () => {},
		});

		await daemon.start();
		const service = services.get(fs.realpathSync(fixture.repo));
		expect(service).toBeDefined();
		await waitFor(() => (service?.refreshCount ?? 0) >= 1);

		fs.writeFileSync(path.join(fixture.repo, "index.ts"), "export const changed = true;\n");
		await waitFor(() => (service?.refreshCount ?? 0) >= 2);

		const status = new IndexingService(fixture.agentDir).getStatus(fixture.repo);
		expect(status).toMatchObject({ indexed: true, serviceRunning: true, ragState: "ready", ragFiles: 1 });
		expect(backendStarts).toBeGreaterThanOrEqual(2);

		await daemon.stop();
		expect(service?.disposed).toBe(true);
		expect(new IndexingService(fixture.agentDir).getStatus(fixture.repo).serviceRunning).toBe(false);
	});

	it("continues draining file changes after the initial workers finish", async () => {
		const fixture = createFixture();
		const repositories = [fixture.repo, path.join(fixture.root, "repo-two"), path.join(fixture.root, "repo-three")];
		for (const repository of repositories) {
			fs.mkdirSync(path.join(repository, ".git"), { recursive: true });
			fs.writeFileSync(path.join(repository, "index.ts"), "export const initial = true;\n");
			enableIndexingForRepo(repository, fixture.agentDir);
		}
		const services = new Map<string, FakeRagService>();
		const daemon = new IndexingDaemon({
			agentDir: fixture.agentDir,
			qdrantBinary: "unused",
			qdrantDataDirectory: path.join(fixture.agentDir, "qdrant"),
			pythonExecutable: "unused",
			embeddingModel: "unused",
			debounceMs: 10,
			retryMs: 50,
			reconcileMs: 60_000,
			serviceFactory: (workspaceRoot) => {
				const service = new FakeRagService(workspaceRoot);
				services.set(workspaceRoot, service);
				return service;
			},
			ensureBackends: async () => {},
			disposeBackends: async () => {},
		});

		await daemon.start();
		await waitFor(
			() => services.size === repositories.length && [...services.values()].every((s) => s.refreshCount >= 1),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		const changedRepository = fs.realpathSync(repositories[2]);
		fs.writeFileSync(path.join(changedRepository, "index.ts"), "export const changedAfterDrain = true;\n");
		await waitFor(() => (services.get(changedRepository)?.refreshCount ?? 0) >= 2);

		await daemon.stop();
	});

	it("aborts a repository refresh when its indexing deadline expires", async () => {
		const fixture = createFixture();
		enableIndexingForRepo(fixture.repo, fixture.agentDir);
		let service: AbortAwareRagService | undefined;
		const daemon = new IndexingDaemon({
			agentDir: fixture.agentDir,
			qdrantBinary: "unused",
			qdrantDataDirectory: path.join(fixture.agentDir, "qdrant"),
			pythonExecutable: "unused",
			embeddingModel: "unused",
			repositoryTimeoutMs: 25,
			retryMs: 60_000,
			reconcileMs: 60_000,
			serviceFactory: (workspaceRoot) => {
				service = new AbortAwareRagService(workspaceRoot);
				return service;
			},
			ensureBackends: async () => {},
			disposeBackends: async () => {},
		});

		await daemon.start();
		await waitFor(() => service?.abortObserved === true);
		await waitFor(() => new IndexingService(fixture.agentDir).getStatus(fixture.repo).ragState === "error");
		expect(new IndexingService(fixture.agentDir).getStatus(fixture.repo).lastError).toContain("timed out");
		await daemon.stop();
	});

	it("allows only one daemon to own an agent directory", async () => {
		const fixture = createFixture();
		const options = {
			agentDir: fixture.agentDir,
			qdrantBinary: "unused",
			qdrantDataDirectory: path.join(fixture.agentDir, "qdrant"),
			pythonExecutable: "unused",
			embeddingModel: "unused",
			reconcileMs: 60_000,
			ensureBackends: async () => {},
			disposeBackends: async () => {},
		};
		const first = new IndexingDaemon(options);
		const second = new IndexingDaemon(options);
		await first.start();
		await expect(second.start()).rejects.toThrow(`already running with pid ${process.pid}`);
		await first.stop();

		const replacement = new IndexingDaemon(options);
		await expect(replacement.start()).resolves.toBeUndefined();
		await replacement.stop();
	});

	it("removes a repository after indexing is disabled", async () => {
		const fixture = createFixture();
		const client = new IndexingService(fixture.agentDir);
		client.enableIndexing(fixture.repo);
		const services: FakeRagService[] = [];
		const daemon = new IndexingDaemon({
			agentDir: fixture.agentDir,
			qdrantBinary: "unused",
			qdrantDataDirectory: path.join(fixture.agentDir, "qdrant"),
			pythonExecutable: "unused",
			embeddingModel: "unused",
			debounceMs: 10,
			retryMs: 50,
			reconcileMs: 60_000,
			serviceFactory: (workspaceRoot) => {
				const service = new FakeRagService(workspaceRoot);
				services.push(service);
				return service;
			},
			ensureBackends: async () => {},
			disposeBackends: async () => {},
		});
		await daemon.start();
		await waitFor(() => services[0]?.refreshCount === 1);

		client.disableIndexing(fixture.repo);
		await waitFor(() => services[0]?.disposed === true);
		expect(client.getDecision(fixture.repo)).toBe("disabled");

		await daemon.stop();
	});

	it("waits for an active refresh before disposing a disabled repository", async () => {
		const fixture = createFixture();
		const client = new IndexingService(fixture.agentDir);
		client.enableIndexing(fixture.repo);
		let service: FakeRagService | undefined;
		const daemon = new IndexingDaemon({
			agentDir: fixture.agentDir,
			qdrantBinary: "unused",
			qdrantDataDirectory: path.join(fixture.agentDir, "qdrant"),
			pythonExecutable: "unused",
			embeddingModel: "unused",
			debounceMs: 10,
			retryMs: 50,
			reconcileMs: 60_000,
			serviceFactory: (workspaceRoot) => {
				service = new FakeRagService(workspaceRoot);
				service.blockRefresh();
				return service;
			},
			ensureBackends: async () => {},
			disposeBackends: async () => {},
		});

		await daemon.start();
		await waitFor(() => service?.refreshing === true);
		expect(client.getStatus(fixture.repo)).toMatchObject({
			ragState: "updating",
			progress: { phase: "indexing", percent: 37 },
		});
		client.disableIndexing(fixture.repo);
		await waitFor(() => client.getStatus(fixture.repo).ragState === undefined);
		expect(service?.disposed).toBe(false);

		service?.releaseRefresh();
		await waitFor(() => service?.disposed === true);
		expect(service?.disposedDuringRefresh).toBe(false);
		await daemon.stop();
	});
});

function createFixture(): { root: string; agentDir: string; repo: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-service-"));
	temporaryDirectories.push(root);
	const agentDir = path.join(root, "agent");
	const repo = path.join(root, "repo");
	fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
	fs.writeFileSync(path.join(repo, "index.ts"), "export const initial = true;\n");
	return { root, agentDir, repo };
}

async function waitFor(predicate: () => boolean, timeoutMs: number = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for indexing service state");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
