import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getIndexedReposPath } from "../src/core/indexed-repos.ts";
import { IndexingService } from "../src/core/indexing-service.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

type IndexingPromptContext = {
	sessionManager: { getCwd: () => string };
	indexingService: IndexingService;
	showExtensionSelector: (title: string, options: string[]) => Promise<string | undefined>;
	showStatus: (message: string) => void;
};

type InteractiveModePrototype = {
	buildIndexStatusText(this: { indexingService: IndexingService }, resolvedPath: string, args: string): string;
	promptForCodeIndexingIfNeeded(this: IndexingPromptContext): Promise<void>;
	rebindCurrentSession(this: RebindContext): Promise<void>;
};

type RebindContext = {
	unsubscribe: (() => void) | undefined;
	applyRuntimeSettings: () => void;
	bindCurrentSessionExtensions: () => Promise<void>;
	subscribeToAgent: () => void;
	updateAvailableProviderCount: () => Promise<void>;
	updateEditorBorderColor: () => void;
	updateTerminalTitle: () => void;
	isInitialized: boolean;
	codeIndexingPrompt: Promise<void> | undefined;
	promptForCodeIndexingIfNeeded: () => Promise<void>;
	showError: (message: string) => void;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;
const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("InteractiveMode code-indexing prompt", () => {
	beforeAll(() => initTheme("dark"));

	it("moves an enabled repository to the top with /index up", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-command-"));
		temporaryDirectories.push(root);
		const agentDir = path.join(root, "agent");
		const repository = path.join(root, "repository");
		fs.mkdirSync(path.join(repository, ".git"), { recursive: true });
		const indexingService = new IndexingService(agentDir);
		const context = { indexingService };

		expect(interactiveModePrototype.buildIndexStatusText.call(context, repository, "up")).toContain(
			"Indexing is not enabled",
		);
		indexingService.enableIndexing(repository);
		expect(interactiveModePrototype.buildIndexStatusText.call(context, repository, "up")).toContain(
			"top of the indexing queue",
		);
	});

	it("does not block session readiness while waiting for the indexing decision", async () => {
		let resolvePrompt: (() => void) | undefined;
		const prompt = new Promise<void>((resolve) => {
			resolvePrompt = resolve;
		});
		const context: RebindContext = {
			unsubscribe: vi.fn(),
			applyRuntimeSettings: vi.fn(),
			bindCurrentSessionExtensions: vi.fn(async () => undefined),
			subscribeToAgent: vi.fn(),
			updateAvailableProviderCount: vi.fn(async () => undefined),
			updateEditorBorderColor: vi.fn(),
			updateTerminalTitle: vi.fn(),
			isInitialized: true,
			codeIndexingPrompt: undefined,
			promptForCodeIndexingIfNeeded: vi.fn(() => prompt),
			showError: vi.fn(),
		};

		await interactiveModePrototype.rebindCurrentSession.call(context);

		expect(context.promptForCodeIndexingIfNeeded).toHaveBeenCalledOnce();
		expect(context.codeIndexingPrompt).toBe(prompt);
		resolvePrompt?.();
		await prompt;
		await Promise.resolve();
		expect(context.codeIndexingPrompt).toBeUndefined();
	});

	it("persists a disabled repository decision when the selector is dismissed", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-prompt-"));
		temporaryDirectories.push(root);
		const agentDir = path.join(root, "agent");
		const repository = path.join(root, "repository");
		fs.mkdirSync(path.join(repository, ".git"), { recursive: true });
		const indexingService = new IndexingService(agentDir);
		const showExtensionSelector = vi.fn(async () => undefined);
		const context: IndexingPromptContext = {
			sessionManager: { getCwd: () => repository },
			indexingService,
			showExtensionSelector,
			showStatus: vi.fn(),
		};

		await interactiveModePrototype.promptForCodeIndexingIfNeeded.call(context);

		expect(indexingService.getDecision(repository)).toBe("disabled");
		expect(showExtensionSelector).toHaveBeenCalledOnce();
		const stored = JSON.parse(fs.readFileSync(getIndexedReposPath(agentDir), "utf8")) as {
			repos: Array<{ path: string; decision: string }>;
		};
		expect(stored.repos).toEqual([
			expect.objectContaining({ path: fs.realpathSync(repository), decision: "disabled" }),
		]);

		indexingService.enableIndexing(repository);
		expect(indexingService.getDecision(repository)).toBe("enabled");
	});

	it("formats files indexed and chunks indexed with out of X", () => {
		const indexingService = {
			getStatus: () => ({
				decision: "enabled" as const,
				indexed: true,
				serviceRunning: true,
				ragState: "ready" as const,
				ragFiles: 1041,
				ragChunks: 58072,
				totalFiles: 1041,
				totalChunks: 58072,
			}),
		} as unknown as IndexingService;
		const context = { indexingService };

		const text = interactiveModePrototype.buildIndexStatusText.call(context, "/repository", "");
		expect(text).toContain("Files indexed: 1041 out of 1041");
		expect(text).toContain("Chunks indexed: 58072 out of 58072");
	});
});
