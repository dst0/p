import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireRepositoryLock } from "../src/rag/manifest.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("repository index lock", () => {
	it("does not steal an old lock from a live indexing process", () => {
		const directory = createDirectory();
		const lock = acquireRepositoryLock(directory);
		const lockPath = path.join(directory, "refresh.lock");
		fs.utimesSync(lockPath, new Date(0), new Date(0));

		expect(() => acquireRepositoryLock(directory, 0)).toThrow("already running");
		lock.release();
	});

	it("recovers a lock owned by a dead process immediately", () => {
		const directory = createDirectory();
		fs.writeFileSync(
			path.join(directory, "refresh.lock"),
			JSON.stringify({ pid: 2_147_483_647, startedAt: new Date().toISOString() }),
		);

		const lock = acquireRepositoryLock(directory, Number.MAX_SAFE_INTEGER);
		expect(fs.existsSync(path.join(directory, "refresh.lock"))).toBe(true);
		lock.release();
	});
});

function createDirectory(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "p-rag-lock-"));
	temporaryDirectories.push(directory);
	return directory;
}
