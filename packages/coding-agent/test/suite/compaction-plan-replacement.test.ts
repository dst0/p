import { describe, expect, it } from "vitest";
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

describe("compaction plan preservation (no plan rewriting from summary)", () => {
	it("preserves existing plan items when compaction summary contains plan section", () => {
		// Compaction summaries should NOT rewrite plans. Plans are only updated via
		// update_session_state (progress_update), not via compaction summaries.
		// This prevents stale plan items from conversation history from overwriting
		// the current structured plan.
		const previous = createInitialStructuredSessionState("test");
		previous.plan = [
			{ id: "current-1", text: "Current plan item one", status: "done", evidenceEntryIds: [] },
			{ id: "current-2", text: "Current plan item two", status: "in_progress", evidenceEntryIds: [] },
		];

		// Simulate a compaction summary that contains a Plan section (from conversation history)
		const state = createStructuredSessionState({
			sessionId: "test",
			previous,
			summary:
				"Goal: Continue working\n\nPlan:\n- [ ] Some old plan from history\n- [ ] Another old plan from history",
			entries: [makeEntry()],
		});

		// Existing plan should be preserved, NOT replaced by summary's plan
		expect(state.plan.length).toBe(2);
		expect(state.plan[0]?.text).toBe("Current plan item one");
		expect(state.plan[0]?.status).toBe("done");
		expect(state.plan[1]?.text).toBe("Current plan item two");
		expect(state.plan[1]?.status).toBe("in_progress");

		// Summary's plan items should NOT appear
		const texts = state.plan.map((p) => p.text);
		expect(texts).not.toContain("Some old plan from history");
		expect(texts).not.toContain("Another old plan from history");
	});

	it("preserves empty plan when compaction summary contains plan section", () => {
		const previous = createInitialStructuredSessionState("test");
		// previous.plan is empty by default

		const state = createStructuredSessionState({
			sessionId: "test",
			previous,
			summary: "Goal: Continue working\n\nPlan:\n- [ ] Plan from summary",
			entries: [makeEntry()],
		});

		// Plan should remain empty, not populated from summary
		expect(state.plan.length).toBe(0);
	});

	it("preserves plan when compaction summary has no plan section", () => {
		const previous = createInitialStructuredSessionState("test");
		previous.plan = [{ id: "p1", text: "Existing plan item", status: "in_progress", evidenceEntryIds: [] }];

		const state = createStructuredSessionState({
			sessionId: "test",
			previous,
			summary: "Goal: Continue working\n\nDecisions:\n- Some decision",
			entries: [makeEntry()],
		});

		expect(state.plan.length).toBe(1);
		expect(state.plan[0]?.text).toBe("Existing plan item");
		expect(state.plan[0]?.status).toBe("in_progress");
	});
});
