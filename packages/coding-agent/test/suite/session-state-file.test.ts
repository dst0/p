import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getSessionStateFilePath,
	readSessionStateFile,
	writeSessionStateFile,
} from "../../src/core/compaction/session-state-file.ts";
import {
	createInitialStructuredSessionState,
	type StructuredSessionState,
} from "../../src/core/compaction/structured-state.ts";

function makeState(overrides?: Partial<StructuredSessionState>): StructuredSessionState {
	const base = createInitialStructuredSessionState("test-session");
	return {
		...base,
		canonicalRequest: { ...base.canonicalRequest, current: "do something", ...overrides?.canonicalRequest },
		...overrides,
	};
}

describe("session-state-file", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "session-state-file-test-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("getSessionStateFilePath returns .pdev/state/<sessionId>.json", () => {
		const path = getSessionStateFilePath("/some/cwd", "abc123");
		expect(path).toBe("/some/cwd/.pdev/state/abc123.json");
	});

	it("readSessionStateFile returns undefined when file does not exist", () => {
		const result = readSessionStateFile(tmpDir, "nonexistent");
		expect(result).toBeUndefined();
	});

	it("write and read round-trips a valid state", () => {
		const state = makeState({
			sessionId: "test-session",
			plan: [{ id: "p1", text: "step one", status: "done", evidenceEntryIds: [] }],
		});

		writeSessionStateFile(tmpDir, state);
		const read = readSessionStateFile(tmpDir, "test-session");

		expect(read).toBeDefined();
		expect(read!.sessionId).toBe("test-session");
		expect(read!.plan).toHaveLength(1);
		expect(read!.plan[0].text).toBe("step one");
	});

	it("writeSessionStateFile creates .pdev/state directory", () => {
		const state = makeState({ sessionId: "dir-test" });

		writeSessionStateFile(tmpDir, state);
		const path = join(tmpDir, ".pdev", "state", "dir-test.json");

		const { existsSync } = require("node:fs");
		expect(existsSync(path)).toBe(true);
	});

	it("readSessionStateFile returns undefined for invalid JSON", async () => {
		const statePath = join(tmpDir, ".pdev", "state");
		await mkdir(statePath, { recursive: true });
		const path = join(statePath, "bad.json");
		await writeFile(path, "not json at all {{{");
		const result = readSessionStateFile(tmpDir, "bad");
		expect(result).toBeUndefined();
	});

	it("readSessionStateFile returns undefined for JSON missing required fields", async () => {
		const statePath = join(tmpDir, ".pdev", "state");
		await mkdir(statePath, { recursive: true });
		const path = join(statePath, "incomplete.json");
		await writeFile(path, JSON.stringify({ version: 1 }));
		const result = readSessionStateFile(tmpDir, "incomplete");
		expect(result).toBeUndefined();
	});

	it("overwriting state file replaces previous content", () => {
		const state1 = makeState({
			sessionId: "overwrite-test",
		});
		state1.canonicalRequest.current = "first";

		const state2 = makeState({
			sessionId: "overwrite-test",
			plan: [{ id: "p2", text: "new plan", status: "not_started", evidenceEntryIds: [] }],
		});
		state2.canonicalRequest.current = "second";

		writeSessionStateFile(tmpDir, state1);
		writeSessionStateFile(tmpDir, state2);

		const read = readSessionStateFile(tmpDir, "overwrite-test");
		expect(read).toBeDefined();
		expect(read!.canonicalRequest.current).toBe("second");
		expect(read!.plan).toHaveLength(1);
	});
});
