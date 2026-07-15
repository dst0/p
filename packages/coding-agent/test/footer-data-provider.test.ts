import { execFile, spawnSync } from "child_process";
import { existsSync, type FSWatcher, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let resolvedBranch = "main";

vi.mock("child_process", () => ({
	execFile: vi.fn(
		(
			_command: string,
			args: readonly string[],
			_options: unknown,
			callback: (error: Error | null, stdout: string, stderr: string) => void,
		) => {
			if (args[1] === "symbolic-ref") {
				setTimeout(
					() =>
						callback(
							resolvedBranch ? null : new Error("detached"),
							resolvedBranch ? `${resolvedBranch}\n` : "",
							"",
						),
					0,
				);
				return;
			}
			setTimeout(() => callback(new Error("unsupported"), "", ""), 0);
		},
	),
	spawnSync: vi.fn((_command: string, args: readonly string[]) => {
		if (args[1] === "symbolic-ref") {
			return { status: resolvedBranch ? 0 : 1, stdout: resolvedBranch ? `${resolvedBranch}\n` : "", stderr: "" };
		}
		return { status: 1, stdout: "", stderr: "" };
	}),
}));

import { FooterDataProvider } from "../src/core/footer-data-provider.ts";

type WorktreeFixture = {
	worktreeDir: string;
	reftableDir: string;
};

type FooterDataProviderInternals = {
	scheduleRefresh: () => void;
};

function createPlainReftableRepo(tempDir: string): string {
	const repoDir = join(tempDir, "repo");
	mkdirSync(join(repoDir, ".git", "reftable"), { recursive: true });
	writeFileSync(join(repoDir, ".git", "HEAD"), "ref: refs/heads/.invalid\n");
	return repoDir;
}

function createPlainRepo(tempDir: string): string {
	const repoDir = join(tempDir, "repo");
	mkdirSync(join(repoDir, ".git"), { recursive: true });
	writeFileSync(join(repoDir, ".git", "HEAD"), "ref: refs/heads/main\n");
	return repoDir;
}

function createReftableWorktree(tempDir: string): WorktreeFixture {
	const repoDir = join(tempDir, "repo");
	const commonGitDir = join(repoDir, ".git");
	const gitDir = join(commonGitDir, "worktrees", "src");
	const worktreeDir = join(tempDir, "worktree");
	const reftableDir = join(commonGitDir, "reftable");

	mkdirSync(gitDir, { recursive: true });
	mkdirSync(reftableDir, { recursive: true });
	mkdirSync(worktreeDir, { recursive: true });

	writeFileSync(join(worktreeDir, ".git"), `gitdir: ${gitDir}\n`);
	writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/.invalid\n");
	writeFileSync(join(gitDir, "commondir"), "../..\n");
	writeFileSync(join(reftableDir, "tables.list"), "0\n");

	return { worktreeDir, reftableDir };
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
	const startedAt = Date.now();
	while (!condition()) {
		if (Date.now() - startedAt > timeoutMs) {
			throw new Error("Timed out waiting for condition");
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe("FooterDataProvider reftable branch detection", () => {
	let originalCwd: string;
	let tempDir: string;

	beforeEach(() => {
		originalCwd = process.cwd();
		tempDir = mkdtempSync(join(tmpdir(), "footer-data-provider-"));
		resolvedBranch = "main";
		vi.mocked(spawnSync).mockClear();
		vi.mocked(execFile).mockClear();
	});

	afterEach(() => {
		process.chdir(originalCwd);
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("uses HEAD directly in a regular repo from a nested directory", () => {
		const repoDir = createPlainRepo(tempDir);
		const nestedDir = join(repoDir, "src", "nested");
		mkdirSync(nestedDir, { recursive: true });
		process.chdir(nestedDir);

		const provider = new FooterDataProvider(nestedDir);
		try {
			expect(provider.getGitBranch()).toBe("main");
			expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
		} finally {
			provider.dispose();
		}
	});

	it("resolves the branch via git when HEAD is .invalid in a reftable repo", () => {
		const repoDir = createPlainReftableRepo(tempDir);
		process.chdir(repoDir);

		const provider = new FooterDataProvider(repoDir);
		try {
			expect(provider.getGitBranch()).toBe("main");
			expect(vi.mocked(spawnSync)).toHaveBeenCalledWith(
				"git",
				["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"],
				expect.objectContaining({
					cwd: expect.stringMatching(/repo$/),
					encoding: "utf8",
					stdio: ["ignore", "pipe", "ignore"],
				}),
			);
		} finally {
			provider.dispose();
		}
	});

	it("resolves the branch via git in a reftable-backed worktree", () => {
		const { worktreeDir } = createReftableWorktree(tempDir);
		process.chdir(worktreeDir);

		const provider = new FooterDataProvider(worktreeDir);
		try {
			expect(provider.getGitBranch()).toBe("main");
		} finally {
			provider.dispose();
		}
	});

	it("treats an unresolved .invalid reftable HEAD as detached", () => {
		const repoDir = createPlainReftableRepo(tempDir);
		process.chdir(repoDir);
		resolvedBranch = "";

		const provider = new FooterDataProvider(repoDir);
		try {
			expect(provider.getGitBranch()).toBe("detached");
		} finally {
			provider.dispose();
		}
	});

	it("does not notify listeners when reftable updates keep the same branch", async () => {
		const { worktreeDir, reftableDir } = createReftableWorktree(tempDir);
		process.chdir(worktreeDir);

		const provider = new FooterDataProvider(worktreeDir);
		try {
			expect(provider.getGitBranch()).toBe("main");
			vi.mocked(spawnSync).mockClear();
			const onBranchChange = vi.fn();
			provider.onBranchChange(onBranchChange);
			const providerInternals = provider as unknown as FooterDataProviderInternals;

			writeFileSync(join(reftableDir, "tables.list"), "1\n");
			providerInternals.scheduleRefresh();
			await waitFor(() => vi.mocked(execFile).mock.calls.length === 1);

			expect(vi.mocked(execFile)).toHaveBeenCalledTimes(1);
			expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
			expect(provider.getGitBranch()).toBe("main");
			expect(onBranchChange).not.toHaveBeenCalled();
		} finally {
			provider.dispose();
		}
	});

	it("debounces rapid reftable updates into a single async refresh", async () => {
		const { worktreeDir, reftableDir } = createReftableWorktree(tempDir);
		process.chdir(worktreeDir);

		const provider = new FooterDataProvider(worktreeDir);
		try {
			expect(provider.getGitBranch()).toBe("main");
			vi.mocked(execFile).mockClear();
			const providerInternals = provider as unknown as FooterDataProviderInternals;

			writeFileSync(join(reftableDir, "tables.list"), "1\n");
			providerInternals.scheduleRefresh();
			writeFileSync(join(reftableDir, "tables.list"), "2\n");
			providerInternals.scheduleRefresh();
			writeFileSync(join(reftableDir, "tables.list"), "3\n");
			providerInternals.scheduleRefresh();
			await waitFor(() => vi.mocked(execFile).mock.calls.length === 1);
			await new Promise((resolve) => setTimeout(resolve, 650));

			expect(vi.mocked(execFile)).toHaveBeenCalledTimes(1);
		} finally {
			provider.dispose();
		}
	});

	it("updates the cached branch when the reftable directory changes", async () => {
		const { worktreeDir, reftableDir } = createReftableWorktree(tempDir);
		process.chdir(worktreeDir);

		const provider = new FooterDataProvider(worktreeDir);
		try {
			expect(provider.getGitBranch()).toBe("main");
			resolvedBranch = "foo";
			const onBranchChange = vi.fn();
			provider.onBranchChange(onBranchChange);
			const providerInternals = provider as unknown as FooterDataProviderInternals;

			writeFileSync(join(reftableDir, "tables.list"), "1\n");
			providerInternals.scheduleRefresh();
			await waitFor(() => vi.mocked(execFile).mock.calls.length === 1);
			await waitFor(() => provider.getGitBranch() === "foo");

			expect(vi.mocked(execFile)).toHaveBeenCalledTimes(1);
			expect(provider.getGitBranch()).toBe("foo");
			expect(onBranchChange).toHaveBeenCalledTimes(1);
		} finally {
			provider.dispose();
		}
	});

	it("retries git watchers 5 seconds after an async fs.watch error", async () => {
		vi.useFakeTimers();
		const repoDir = createPlainRepo(tempDir);
		process.chdir(repoDir);

		const provider = new FooterDataProvider(repoDir);
		try {
			const providerWithInternals = provider as unknown as {
				headWatcher: FSWatcher | null;
			};
			const originalWatcher = providerWithInternals.headWatcher;
			expect(originalWatcher).not.toBeNull();
			expect(originalWatcher?.listenerCount("error")).toBeGreaterThan(0);

			originalWatcher?.emit("error", new Error("simulated EMFILE"));
			expect(providerWithInternals.headWatcher).toBeNull();

			await vi.advanceTimersByTimeAsync(4999);
			expect(providerWithInternals.headWatcher).toBeNull();

			await vi.advanceTimersByTimeAsync(1);
			expect(providerWithInternals.headWatcher).not.toBeNull();
			expect(providerWithInternals.headWatcher).not.toBe(originalWatcher);
		} finally {
			provider.dispose();
			vi.useRealTimers();
		}
	});
});

describe("FooterDataProvider progress state", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "footer-data-provider-progress-"));
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("clears stale model switch progress when a new request starts sending", () => {
		const provider = new FooterDataProvider(tempDir);

		provider.setModelSwitchProgress({
			fromModel: "misha-pc/misha-pc-model",
			toModel: "mini-pc-11450/lms-micro/high-32-kvq4-cache",
		});
		provider.setSendingProgress({ model: "mini-pc-11450/lms-micro/high-32-kvq4-cache" });

		expect(provider.getSendingProgress()).toEqual({ model: "mini-pc-11450/lms-micro/high-32-kvq4-cache" });
		expect(provider.getModelSwitchProgress()).toBeUndefined();
	});

	it("clears stale switch and loading progress when provider prefill begins", () => {
		const provider = new FooterDataProvider(tempDir);

		provider.setModelSwitchProgress({ fromModel: "offline-worker/model", toModel: "online-worker/model" });
		provider.setLoadingProgress({ model: "online-worker/model" });
		provider.setPrefillProgress({ percent: 25, elapsedMs: 1000, tokensPerSecond: 200 });

		expect(provider.getPrefillProgress()).toEqual({ percent: 25, elapsedMs: 1000, tokensPerSecond: 200 });
		expect(provider.getModelSwitchProgress()).toBeUndefined();
		expect(provider.getLoadingProgress()).toBeUndefined();
	});

	it("clears stale switch progress when llm-orchestrator queue progress arrives", () => {
		const provider = new FooterDataProvider(tempDir);

		provider.setModelSwitchProgress({ fromModel: "misha-pc/misha-pc-model", toModel: "lms-micro/model" });
		provider.setQueuedProgress({
			position: 2,
			queuedAhead: 1,
			queue: "worker",
			workerId: "llama-cpu",
			source: "llm-orchestrator",
		});

		expect(provider.getQueuedProgress()).toEqual({
			position: 2,
			queuedAhead: 1,
			queue: "worker",
			workerId: "llama-cpu",
			source: "llm-orchestrator",
			queuedAt: expect.any(Number),
		});
		expect(provider.getModelSwitchProgress()).toBeUndefined();
	});

	it("keeps loading visible with the current model switch for retry display", () => {
		const provider = new FooterDataProvider(tempDir);

		provider.setModelSwitchProgress({ fromModel: "old/model", toModel: "new/model" });
		provider.setLoadingProgress({ model: "new/model" });

		expect(provider.getModelSwitchProgress()).toEqual({ fromModel: "old/model", toModel: "new/model" });
		expect(provider.getLoadingProgress()).toEqual({ model: "new/model" });
	});

	it("uses the orchestrator queue timestamp instead of resetting elapsed time locally", () => {
		const provider = new FooterDataProvider(tempDir);
		const queuedAt = 1_700_000_000_000;

		provider.setQueuedProgress({
			position: 3,
			queuedAhead: 2,
			queue: "model",
			ticketId: "queue-ticket-a",
			queuedAt,
			source: "llm-orchestrator",
		});

		const result = provider.getQueuedProgress();
		expect(result?.queuedAt).toBe(queuedAt);
	});

	it("preserves queuedAt on subsequent setQueuedProgress calls", async () => {
		const provider = new FooterDataProvider(tempDir);

		provider.setQueuedProgress({
			position: 3,
			queuedAhead: 2,
			queue: "model",
			ticketId: "queue-ticket-a",
			source: "llm-orchestrator",
		});
		const firstAt = provider.getQueuedProgress()!.queuedAt;

		await new Promise((resolve) => setTimeout(resolve, 50));
		provider.setQueuedProgress({
			position: 2,
			queuedAhead: 1,
			queue: "model",
			ticketId: "queue-ticket-a",
			source: "llm-orchestrator",
		});

		expect(provider.getQueuedProgress()!.queuedAt).toBe(firstAt);
	});

	it("clears queuedAt when setQueuedProgress is called with undefined", () => {
		const provider = new FooterDataProvider(tempDir);

		provider.setQueuedProgress({
			position: 1,
			queuedAhead: 0,
			queue: "model",
			source: "llm-orchestrator",
		});
		expect(provider.getQueuedProgress()!.queuedAt).toBeDefined();

		provider.setQueuedProgress(undefined);
		expect(provider.getQueuedProgress()).toBeUndefined();
	});

	it("derives a stable queue start from server elapsed time when queuedAt is absent", () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(10_000);
			const provider = new FooterDataProvider(tempDir);
			provider.setQueuedProgress({
				position: 1,
				queuedAhead: 0,
				queue: "worker",
				queuedForMs: 2500,
				source: "llm-orchestrator",
			});

			expect(provider.getQueuedProgress()?.queuedAt).toBe(7500);
		} finally {
			vi.useRealTimers();
		}
	});

	it("can preserve orchestrator queue state across a retry request boundary", () => {
		const provider = new FooterDataProvider(tempDir);
		provider.setQueuedProgress({
			position: 2,
			queuedAhead: 1,
			queue: "model",
			ticketId: "queue-ticket-a",
			queuedAt: 1234,
			source: "llm-orchestrator",
		});

		provider.clearProgress({ preserveQueued: true });

		expect(provider.getQueuedProgress()).toEqual({
			position: 2,
			queuedAhead: 1,
			queue: "model",
			ticketId: "queue-ticket-a",
			queuedAt: 1234,
			source: "llm-orchestrator",
		});
	});

	it("clears orchestrator queue state and its timer by default", () => {
		const provider = new FooterDataProvider(tempDir);
		provider.setQueuedProgress({
			position: 1,
			queuedAhead: 0,
			queue: "model",
			ticketId: "queue-ticket-a",
			queuedAt: 1234,
			source: "llm-orchestrator",
		});

		provider.clearProgress();

		expect(provider.getQueuedProgress()).toBeUndefined();
	});

	it("rejects legacy local message queue payloads as execution progress", () => {
		const provider = new FooterDataProvider(tempDir);

		provider.setQueuedProgress({ messages: 2, source: "messages" } as never);

		expect(provider.getQueuedProgress()).toBeUndefined();
	});
});
