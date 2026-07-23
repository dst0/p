import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createInitialStructuredSessionState,
	createStructuredSessionState,
	getSessionStateFilePath,
	mergeStructuredSessionState,
	readSessionStateFile,
	renderStructuredSessionCheckpoint,
	renderWorkingSessionState,
	writeSessionStateFile,
} from "../../src/core/compaction/index.ts";

const IGNORED_RISK = "post-compaction context exceeds target";
const REAL_RISK = "release validation is still pending";
const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "p-session-risk-filter-"));
	tempDirs.push(dir);
	return dir;
}

describe("session-state risk filtering", () => {
	it("drops post-compaction target diagnostics while retaining real risks", () => {
		const previous = createInitialStructuredSessionState("session");
		previous.audit.knownRisks = [IGNORED_RISK, REAL_RISK];

		const state = mergeStructuredSessionState(previous, {
			audit: { knownRisks: [`${IGNORED_RISK} (12000 > 10000)`, "another real risk"] },
		});

		expect(state.audit.knownRisks).toEqual([REAL_RISK, "another real risk"]);
	});

	it("filters compaction audit diagnostics before persisting structured state", () => {
		const state = createStructuredSessionState({
			sessionId: "session",
			summary: "## Goal\nKeep useful session risks",
			entries: [],
			audit: {
				beforeTokens: 20000,
				afterTokens: 12000,
				savedTokens: 8000,
				summaryTokens: 1000,
				renderedStateTokens: 1000,
				recentRawTokens: 11000,
				toolRawTokens: 0,
				toolStubTokens: 0,
				droppedEntries: [],
				stubbedToolResults: [],
				risks: [IGNORED_RISK, REAL_RISK],
			},
		});

		expect(state.audit.knownRisks).toEqual([REAL_RISK]);
	});

	it("never renders a stale persisted diagnostic", () => {
		const state = createInitialStructuredSessionState("session");
		state.canonicalRequest.current = "Continue the task";
		state.audit.knownRisks = [IGNORED_RISK, REAL_RISK];

		const checkpoint = renderStructuredSessionCheckpoint(state, 4000);
		const workingState = renderWorkingSessionState(state, 4000);

		expect(checkpoint).not.toContain(IGNORED_RISK);
		expect(workingState).not.toContain(IGNORED_RISK);
		expect(checkpoint).toContain(REAL_RISK);
		expect(workingState).toContain(REAL_RISK);
	});

	it("sanitizes dedicated state files on read and write", () => {
		const cwd = createTempDir();
		const state = createInitialStructuredSessionState("session");
		state.audit.knownRisks = [IGNORED_RISK, REAL_RISK];

		writeSessionStateFile(cwd, state);
		const path = getSessionStateFilePath(cwd, state.sessionId);
		expect(readFileSync(path, "utf8")).not.toContain(IGNORED_RISK);

		writeFileSync(path, `${JSON.stringify(state)}\n`);
		expect(readSessionStateFile(cwd, state.sessionId)?.audit.knownRisks).toEqual([REAL_RISK]);
	});
});
