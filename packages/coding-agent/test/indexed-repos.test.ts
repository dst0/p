import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	disableIndexingForRepo,
	enableIndexingForRepo,
	findIndexWorkspaceRoot,
	getIndexedReposPath,
	getRepoIndexingDecision,
	INDEXED_REPOS_SCHEMA_VERSION,
	loadIndexedRepos,
} from "../src/core/indexed-repos.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function createFixture(): { agentDir: string; repo: string; nested: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexed-repos-"));
	temporaryDirectories.push(root);
	const agentDir = path.join(root, "agent");
	const repo = path.join(root, "repo");
	const nested = path.join(repo, "src", "nested");
	fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
	fs.mkdirSync(nested, { recursive: true });
	return { agentDir, repo, nested };
}

describe("indexed repository decisions", () => {
	it("uses the git root and persists an explicit disabled decision", () => {
		const { agentDir, repo, nested } = createFixture();
		expect(findIndexWorkspaceRoot(nested)).toBe(fs.realpathSync(repo));
		expect(getRepoIndexingDecision(repo, agentDir)).toBe("unknown");

		disableIndexingForRepo(repo, agentDir);

		expect(getRepoIndexingDecision(nested, agentDir)).toBe("disabled");
		expect(loadIndexedRepos(agentDir)).toHaveLength(1);
		const stored = JSON.parse(fs.readFileSync(getIndexedReposPath(agentDir), "utf-8")) as {
			schemaVersion: number;
		};
		expect(stored.schemaVersion).toBe(INDEXED_REPOS_SCHEMA_VERSION);
	});

	it("replaces a disabled decision when indexing is enabled later", () => {
		const { agentDir, repo } = createFixture();
		disableIndexingForRepo(repo, agentDir);
		enableIndexingForRepo(repo, agentDir);

		expect(getRepoIndexingDecision(repo, agentDir)).toBe("enabled");
		expect(loadIndexedRepos(agentDir)).toHaveLength(1);
	});

	it("uses a non-repository folder as its own indexing root", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-index-folder-"));
		temporaryDirectories.push(root);
		expect(findIndexWorkspaceRoot(root)).toBe(fs.realpathSync(root));
	});
});
