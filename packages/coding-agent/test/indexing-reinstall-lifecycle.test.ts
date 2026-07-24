import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
	CodeRagService,
	IndexUpdateSummary,
	InitializeRagOptions,
	RagState,
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
import {
	getIndexingReinstallControlPath,
	getIndexingReinstallReadyPath,
} from "../src/indexing-service-daemon.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

class LifecycleRagService implements CodeRagService {
	readonly workspaceRoot: string;
	refreshCount = 0;
	initializeCount = 0;
	abortCount = 0;
	refreshing = false;
	private state: RagState;
	private readonly persisted: boolean;
	private refreshGate: Promise<void> | undefined;
	private releaseRefreshGate: (() => void) | undefined;

	constructor(workspaceRoot: string, state: RagState, persisted: boolean = true) {
		this.workspaceRoot = workspaceRoot;
		this.state = state;
		this.persisted = persisted;
	}

	setState(state: RagState): void {
		this.state = state;
	}

	blockRefresh(): void {
		this.refreshGate = new Promise((resolve) => {
			this.releaseRefreshGate = resolve;
		});
	}

	releaseRefresh(): void {
		this.releaseRefreshGate?.();
		this.releaseRefreshGate = undefined;
		this.refreshGate = undefined;
	}

	async initialize(_options: InitializeRagOptions = {}): Promise<RagStatus> {
		this.initializeCount += 1;
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

	async refresh(options: RefreshIndexOptions = {}, signal?: AbortSignal): Promise<IndexUpdateSummary> {
		this.refreshing = true;
		options.onProgress?.({ phase: "scanning", percent: 0 });
		options.onProgress?.({ phase: "indexing", percent: 37 });
		try {
			await this.waitForGate(signal);
			this.refreshCount += 1;
			this.state = "ready";
			options.onProgress?.({ phase: "finalizing", percent: 100 });
			return {
				status: this.createStatus(true),
				durationMs: 1,
				filesScanned: 42,
				filesAdded: 0,
				filesChanged: 1,
				filesDeleted: 0,
				filesUnchanged: 41,
				chunksEmbedded: 1,
				fullRebuild: false,
			};
		} finally {
			this.refreshing = false;
		}
	}

	async rebuild(options: RebuildIndexOptions = {}, signal?: AbortSignal): Promise<IndexUpdateSummary> {
		return this.refresh({ onProgress: options.onProgress }, signal);
	}

	async dispose(): Promise<void> {}

	private createStatus(forcePersisted: boolean = false): RagStatus {
		const persisted = this.persisted || forcePersisted;
		return {
			state: this.state,
			workspaceRoot: this.workspaceRoot,
			repoId: "lifecycle-repo",
			...(persisted ? { collection: "existing-collection", generation: "existing-generation" } : {}),
			indexedFiles: this.state === "not_initialized" ? 0 : 42,
			indexedChunks: this.state === "not_initialized" ? 0 : 137 + this.refreshCount,
			sparse: { generation: persisted ? "existing-generation" : undefined, exact: true, driftFileCount: 0 },
		};
	}

	private async waitForGate(signal?: AbortSignal): Promise<void> {
		const gate = this.refreshGate;
		if (!gate) return;
		if (!signal) {
			await gate;
			return;
		}
		await new Promise<void>((resolve, reject) => {
			const onAbort = () => {
				this.abortCount += 1;
				reject(signal.reason ?? new Error("aborted"));
			};
			const onRelease = () => {
				signal.removeEventListener("abort", onAbort);
				resolve();
			};
			if (signal.aborted) onAbort();
			else {
				signal.addEventListener("abort", onAbort, { once: true });
				void gate.then(onRelease);
			}
		});
	}
}

describe("indexing reinstall lifecycle", () => {
	it("reuses a compatible ready index without queueing another refresh", async () => {
		const fixture = createFixture();
		enableIndexingForRepo(fixture.repo, fixture.agentDir);
		let service: LifecycleRagService | undefined;
		let backendStarts = 0;
		const daemon = createDaemon(fixture.agentDir, fixture.repo, (root) => {
			service = new LifecycleRagService(root, "ready", true);
			return service;
		}, {
			ensureBackends: async () => {
				backendStarts += 1;
			},
		});

		try {
			await daemon.start();
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(service?.refreshCount).toBe(0);
			expect(backendStarts).toBe(1);
			expect(new IndexingService(fixture.agentDir).getStatus(fixture.repo)).toMatchObject({
				ragState: "ready",
				ragFiles: 42,
				ragChunks: 137,
				progress: undefined,
			});
		} finally {
			await daemon.stop({ graceful: true });
		}
	});

	it("refreshes an incompatible or stale persisted index on startup", async () => {
		const fixture = createFixture();
		enableIndexingForRepo(fixture.repo, fixture.agentDir);
		let service: LifecycleRagService | undefined;
		const daemon = createDaemon(fixture.agentDir, fixture.repo, (root) => {
			service = new LifecycleRagService(root, "stale", true);
			return service;
		});

		try {
			await daemon.start();
			await waitFor(() => service?.refreshCount === 1);
			expect(new IndexingService(fixture.agentDir).getStatus(fixture.repo).ragState).toBe("ready");
		} finally {
			await daemon.stop({ graceful: true });
		}
	});

	it("uses reconcile freshness checks to recover a missed filesystem event", async () => {
		const fixture = createFixture();
		enableIndexingForRepo(fixture.repo, fixture.agentDir);
		let service: LifecycleRagService | undefined;
		const daemon = createDaemon(fixture.agentDir, fixture.repo, (root) => {
			service = new LifecycleRagService(root, "ready", true);
			return service;
		}, { reconcileMs: 25 });

		try {
			await daemon.start();
			expect(service?.refreshCount).toBe(0);
			service?.setState("stale");
			await waitFor(() => service?.refreshCount === 1);
			expect(service?.initializeCount).toBeGreaterThan(1);
		} finally {
			await daemon.stop({ graceful: true });
		}
	});

	it("keeps active progress stable and waits for completion before restart", async () => {
		const fixture = createFixture();
		enableIndexingForRepo(fixture.repo, fixture.agentDir);
		let service: LifecycleRagService | undefined;
		const daemon = createDaemon(fixture.agentDir, fixture.repo, (root) => {
			service = new LifecycleRagService(root, "not_initialized", false);
			service.blockRefresh();
			return service;
		});

		try {
			await daemon.start();
			await waitFor(() => service?.refreshing === true);
			const before = new IndexingService(fixture.agentDir).getStatus(fixture.repo);
			expect(before).toMatchObject({ ragState: "initializing", progress: { phase: "indexing", percent: 37 } });

			let prepared = false;
			const preparePromise = daemon.prepareForRestart().then(() => {
				prepared = true;
			});
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(prepared).toBe(false);
			expect(service?.abortCount).toBe(0);
			expect(new IndexingService(fixture.agentDir).getStatus(fixture.repo)).toMatchObject({
				ragState: "initializing",
				progress: { phase: "indexing", percent: 37 },
			});

			service?.releaseRefresh();
			await preparePromise;
			expect(service?.refreshCount).toBe(1);
			expect(service?.abortCount).toBe(0);
			expect(new IndexingService(fixture.agentDir).getStatus(fixture.repo)).toMatchObject({
				ragState: "ready",
				progress: undefined,
			});
		} finally {
			service?.releaseRefresh();
			await daemon.stop({ graceful: true });
		}
	});

	it("keeps reinstall control files inside the indexing service directory", () => {
		expect(getIndexingReinstallControlPath("/tmp/agent")).toBe(
			path.join("/tmp/agent", "indexing-service", "reinstall-control.json"),
		);
		expect(getIndexingReinstallReadyPath("/tmp/agent")).toBe(
			path.join("/tmp/agent", "indexing-service", "reinstall-ready.json"),
		);
	});
});

function createFixture(): { root: string; repo: string; agentDir: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-reinstall-"));
	temporaryDirectories.push(root);
	const repo = path.join(root, "repo");
	const agentDir = path.join(root, "agent");
	fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
	fs.writeFileSync(path.join(repo, "index.ts"), "export const value = true;\n");
	return { root, repo, agentDir };
}

function createDaemon(
	agentDir: string,
	_repo: string,
	serviceFactory: (workspaceRoot: string) => CodeRagService,
	overrides: {
		reconcileMs?: number;
		ensureBackends?: (signal?: AbortSignal) => Promise<void>;
	} = {},
): IndexingDaemon {
	return new IndexingDaemon({
		agentDir,
		qdrantBinary: "unused",
		qdrantDataDirectory: path.join(agentDir, "qdrant"),
		pythonExecutable: "unused",
		embeddingModel: "unused",
		debounceMs: 10,
		retryMs: 60_000,
		reconcileMs: overrides.reconcileMs ?? 60_000,
		serviceFactory,
		ensureBackends: overrides.ensureBackends ?? (async () => {}),
		disposeBackends: async () => {},
	});
}

async function waitFor(predicate: () => boolean, timeoutMs: number = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for indexing lifecycle state");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
