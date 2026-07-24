import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { enableIndexingForRepo } from "../src/core/indexed-repos.ts";
import {
	INDEXING_SERVICE_REINSTALL_FILE,
	IndexingService,
	writeIndexingServiceStatus,
} from "../src/core/indexing-service.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("indexing reinstall UI continuity", () => {
	it("keeps the last healthy repository state visible during the daemon restart gap", () => {
		const fixture = createFixture();
		const daemonPid = 99_999_999;
		enableIndexingForRepo(fixture.repo, fixture.agentDir);
		writeIndexingServiceStatus(fixture.agentDir, {
			pid: daemonPid,
			running: false,
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			repos: [
				{
					path: fixture.repo,
					state: "ready",
					indexedFiles: 42,
					indexedChunks: 137,
					updatedAt: new Date().toISOString(),
				},
			],
		});
		writeReinstallMarker(fixture.agentDir, daemonPid, new Date().toISOString());

		expect(new IndexingService(fixture.agentDir).getStatus(fixture.repo)).toMatchObject({
			serviceRunning: true,
			ragState: "ready",
			ragFiles: 42,
			ragChunks: 137,
			progress: undefined,
		});
	});

	it("does not hide a real outage behind a stale or unrelated reinstall marker", () => {
		const fixture = createFixture();
		const daemonPid = 99_999_999;
		enableIndexingForRepo(fixture.repo, fixture.agentDir);
		writeIndexingServiceStatus(fixture.agentDir, {
			pid: daemonPid,
			running: false,
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			repos: [
				{
					path: fixture.repo,
					state: "ready",
					indexedFiles: 42,
					indexedChunks: 137,
					updatedAt: new Date().toISOString(),
				},
			],
		});

		writeReinstallMarker(fixture.agentDir, daemonPid, new Date(Date.now() - 6 * 60_000).toISOString());
		expect(new IndexingService(fixture.agentDir).getStatus(fixture.repo).serviceRunning).toBe(false);

		writeReinstallMarker(fixture.agentDir, daemonPid + 1, new Date().toISOString());
		expect(new IndexingService(fixture.agentDir).getStatus(fixture.repo).serviceRunning).toBe(false);
	});
});

function createFixture(): { repo: string; agentDir: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-reinstall-ui-"));
	temporaryDirectories.push(root);
	const repo = path.join(root, "repo");
	const agentDir = path.join(root, "agent");
	fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
	return { repo, agentDir };
}

function writeReinstallMarker(agentDir: string, pid: number, startedAt: string): void {
	fs.mkdirSync(agentDir, { recursive: true });
	fs.writeFileSync(
		path.join(agentDir, INDEXING_SERVICE_REINSTALL_FILE),
		`${JSON.stringify({ pid, startedAt })}\n`,
	);
}
