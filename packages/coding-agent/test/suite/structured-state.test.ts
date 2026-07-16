import { describe, expect, it } from "vitest";
import type { EvidencePointer } from "../../src/core/compaction/compaction.ts";
import {
	createInitialStructuredSessionState,
	createStructuredSessionState,
} from "../../src/core/compaction/structured-state.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";

function makeEntry(overrides?: Partial<SessionEntry>): SessionEntry {
	return {
		id: "entry-1",
		parentId: null,
		type: "message",
		message: {
			role: "user",
			content: "test",
			timestamp: Date.now(),
		},
		timestamp: new Date().toISOString(),
		...overrides,
	} as SessionEntry;
}

describe("structured-state normalization", () => {
	it("filters /tmp/ scratch files from touchedFiles", () => {
		const previous = createInitialStructuredSessionState("test");
		previous.codebase.touchedFiles = [
			{ path: "/tmp/test-scratch.ts", status: "modified", summary: "temp file" },
			{ path: "packages/foo/src/bar.ts", status: "read", summary: "real file" },
		];

		const state = createStructuredSessionState({
			sessionId: "test",
			previous,
			summary: "Goal: test\n\nPlan:\n- [ ] test",
			entries: [makeEntry()],
			modifiedFiles: [],
		});

		const paths = state.codebase.touchedFiles.map((f) => f.path);
		expect(paths).not.toContain("/tmp/test-scratch.ts");
		expect(paths).toContain("packages/foo/src/bar.ts");
	});

	it("filters /var/folders/ scratch files from touchedFiles", () => {
		const previous = createInitialStructuredSessionState("test");
		previous.codebase.touchedFiles = [
			{ path: "/var/folders/ab12/cd34/T/tmp-123.ts", status: "modified", summary: "scratch" },
		];

		const state = createStructuredSessionState({
			sessionId: "test",
			previous,
			summary: "Goal: test\n\nPlan:\n- [ ] test",
			entries: [makeEntry()],
			modifiedFiles: [],
		});

		expect(state.codebase.touchedFiles).toHaveLength(0);
	});

	it("normalizes absolute paths to relative", () => {
		const previous = createInitialStructuredSessionState("test");
		previous.codebase.touchedFiles = [
			{
				path: "/Users/dst/dev/p/packages/coding-agent/src/core/compaction/structured-state.ts",
				status: "read",
				summary: "deep absolute",
			},
		];

		const state = createStructuredSessionState({
			sessionId: "test",
			previous,
			summary: "Goal: test\n\nPlan:\n- [ ] test",
			entries: [makeEntry()],
			modifiedFiles: [],
		});

		const path = state.codebase.touchedFiles[0]?.path;
		expect(path).toBe("structured-state.ts");
	});

	it("deduplicates touched files by normalized path", () => {
		const previous = createInitialStructuredSessionState("test");
		previous.codebase.touchedFiles = [{ path: "packages/foo.ts", status: "read", summary: "short" }];

		const state = createStructuredSessionState({
			sessionId: "test",
			previous,
			summary: "Goal: test\n\nPlan:\n- [ ] test",
			entries: [makeEntry()],
			modifiedFiles: ["packages/foo.ts"],
		});

		const matches = state.codebase.touchedFiles.filter((f) => f.path === "packages/foo.ts");
		expect(matches).toHaveLength(1);
		// Should keep the entry with more detailed summary
		expect(matches[0]!.summary).toContain("Modified");
	});

	it("filters dead evidence references", () => {
		const previous = createInitialStructuredSessionState("test");
		previous.evidence = [
			{
				id: "tool-result:real1",
				kind: "tool_result",
				summary: "real result",
				path: "packages/foo.ts",
				retrieveWhen: "",
			},
			{
				id: "tool-result:dead1",
				kind: "tool_result",
				summary: "dead ref",
				path: "",
				retrieveWhen: "when verifying X",
			},
		];

		const state = createStructuredSessionState({
			sessionId: "test",
			previous,
			summary: "Goal: test\n\nPlan:\n- [ ] test",
			entries: [makeEntry()],
		});

		const ids = state.evidence.map((e) => e.id);
		expect(ids).toContain("tool-result:real1");
		expect(ids).not.toContain("tool-result:dead1");
	});

	it("prunes evidence to max 50 entries", () => {
		const previous = createInitialStructuredSessionState("test");
		const evidence: EvidencePointer[] = [];
		for (let i = 0; i < 60; i++) {
			evidence.push({
				id: `tool-result:${i}`,
				kind: "tool_result",
				summary: `result ${i}`,
				path: `packages/file${i}.ts`,
				retrieveWhen: "",
			});
		}
		previous.evidence = evidence;

		const state = createStructuredSessionState({
			sessionId: "test",
			previous,
			summary: "Goal: test\n\nPlan:\n- [ ] test",
			entries: [makeEntry()],
		});

		expect(state.evidence.length).toBeLessThanOrEqual(50);
	});

	it("prunes dead evidenceEntryIds from plan items", () => {
		const previous = createInitialStructuredSessionState("test");
		previous.plan = [{ id: "p1", text: "Step one", status: "done", evidenceEntryIds: ["e1", "e2", "e3"] }];
		previous.evidence = [
			{ id: "e1", kind: "file", summary: "exists", path: "packages/foo.ts", retrieveWhen: "" },
			{ id: "e2", kind: "file", summary: "exists", path: "packages/bar.ts", retrieveWhen: "" },
			// e3 is not in evidence, should be pruned
		];

		const state = createStructuredSessionState({
			sessionId: "test",
			previous,
			summary: "Goal: test\n\nPlan:\n- [x] Step one",
			entries: [makeEntry()],
		});

		expect(state.plan[0]?.evidenceEntryIds).toEqual(["e1", "e2"]);
	});

	it("preserves previous goal when no new goal is provided", () => {
		const previous = createInitialStructuredSessionState("test");
		previous.canonicalRequest.current = "Fix the session state bugs and write tests";

		const state = createStructuredSessionState({
			sessionId: "test",
			previous,
			summary: "Plan:\n- [ ] Fix bugs\n- [ ] Write tests",
			entries: [makeEntry()],
		});

		expect(state.canonicalRequest.current).toBe("Fix the session state bugs and write tests");
	});

	it("merges originalRequests without duplicates", () => {
		const previous = createInitialStructuredSessionState("test");
		previous.canonicalRequest.current = "Fix bugs";
		previous.canonicalRequest.originalRequests = [
			{
				id: "req-1",
				entryId: "entry-1",
				timestamp: "2024-01-01T00:00:00Z",
				text: "First request",
				summary: "First request",
				kind: "request",
			},
		];

		const entry2 = makeEntry({
			id: "entry-2",
			message: {
				role: "user",
				content: "Second request",
				timestamp: Date.now(),
			},
		});

		const state = createStructuredSessionState({
			sessionId: "test",
			previous,
			summary: "Goal: Fix bugs",
			entries: [entry2],
		});

		const ids = state.canonicalRequest.originalRequests.map((r) => r.id);
		expect(ids).toContain("req-1");
		expect(ids).toContain("req-2");
		expect(state.canonicalRequest.originalRequests.length).toBe(2);
	});

	it("keeps the entry with more detailed summary when deduplicating touched files", () => {
		const previous = createInitialStructuredSessionState("test");
		previous.codebase.touchedFiles = [
			{ path: "packages/foo.ts", status: "read", summary: "short" },
			{
				path: "packages/foo.ts",
				status: "modified",
				summary: "very detailed summary of what was changed in this file",
			},
		];

		const state = createStructuredSessionState({
			sessionId: "test",
			previous,
			summary: "Goal: test\n\nPlan:\n- [ ] test",
			entries: [makeEntry()],
		});

		const matches = state.codebase.touchedFiles.filter((f) => f.path === "packages/foo.ts");
		expect(matches).toHaveLength(1);
		expect(matches[0]!.summary).toBe("very detailed summary of what was changed in this file");
	});
});
