import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getIndexedReposPath } from "../src/core/indexed-repos.ts";
import { IndexingService } from "../src/core/indexing-service.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type IndexingPromptContext = {
	sessionManager: { getCwd: () => string };
	indexingService: IndexingService;
	showExtensionSelector: (title: string, options: string[]) => Promise<string | undefined>;
	showStatus: (message: string) => void;
};

type InteractiveModePrototype = {
	promptForCodeIndexingIfNeeded(this: IndexingPromptContext): Promise<void>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;
const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("InteractiveMode code-indexing prompt", () => {
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
});
