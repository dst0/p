import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import { getLatestStructuredSessionState } from "../../../src/core/compaction/index.ts";
import { createHarness, type Harness } from "../harness.ts";

const UPDATE_TOOL = "update_session_state";

function updateStateCall(goal: string, action: "initial_plan" | "replan" = "initial_plan") {
	return fauxToolCall(UPDATE_TOOL, {
		action,
		goal,
		plan: [{ text: "Inspect the requested file", status: "in_progress" }],
		progress: { current: ["Inspect the requested file"], next: ["Report the result"] },
	});
}

function finishCall(
	summary = "done",
	options: { status?: "success" | "partial" | "failed"; remainingWork?: string[] } = {},
) {
	return fauxToolCall("finish_work", {
		status: options.status ?? "success",
		summary,
		remaining_work: options.remainingWork,
	});
}

function toolEndEvents(harness: Harness, toolName: string) {
	return harness.eventsOfType("tool_execution_end").filter((event) => event.toolName === toolName);
}

describe("finish_work auto-prepend session state update", () => {
	it("auto-updates session state when finish_work called without prior update_session_state on first turn", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([fauxAssistantMessage(finishCall("auto-prepended state"), { stopReason: "toolUse" })]);

			await harness.session.prompt("Do something simple");

			const finishEnds = toolEndEvents(harness, "finish_work");
			expect(finishEnds).toHaveLength(1);
			expect(finishEnds[0]?.isError).toBe(false);

			const state = getLatestStructuredSessionState(harness.sessionManager.getEntries());
			expect(state).toBeDefined();
			// Auto-prepend uses existing state values; on first turn there is no prior state so goal is empty
			expect(state?.canonicalRequest.current).toBe("");
		} finally {
			harness.cleanup();
		}
	});

	it("auto-updates progress when finish_work called after tool use without mark_session_progress", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				// Turn 1: set up initial state with no open progress items
				fauxAssistantMessage(
					fauxToolCall(UPDATE_TOOL, {
						action: "initial_plan",
						goal: "Track progress then finish",
						plan: [{ text: "Inspect the requested file", status: "done" }],
						progress: { done: ["Inspect the requested file"] },
					}),
					{ stopReason: "toolUse" },
				),
				// Turn 2: a regular tool call sets _progressUpdateRequiredBeforeFinish = true
				fauxAssistantMessage(fauxToolCall("read_file", { path: "test.txt" }), { stopReason: "toolUse" }),
				// Turn 3: finish_work without calling update_session_state -> auto-prepend triggers
				fauxAssistantMessage(finishCall("auto-prepended progress"), { stopReason: "toolUse" }),
			]);

			await harness.session.prompt("Track progress then finish");

			const finishEnds = toolEndEvents(harness, "finish_work");
			expect(finishEnds).toHaveLength(1);
			expect(finishEnds[0]?.isError).toBe(false);

			const state = getLatestStructuredSessionState(harness.sessionManager.getEntries());
			expect(state?.progress.done).toContain("Inspect the requested file");
		} finally {
			harness.cleanup();
		}
	});

	it("auto-update uses current session state values as defaults", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage(
					fauxToolCall(UPDATE_TOOL, {
						action: "initial_plan",
						goal: "Original goal text",
						plan: [{ text: "Task one", status: "done" }],
						progress: { done: ["Task one"] },
						decisions: [{ decision: "Key decision", rationale: "Because reasons" }],
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall(UPDATE_TOOL, {
						action: "progress_update",
						plan: [{ text: "Task one", status: "done" }],
						progress: { done: ["Task one"] },
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(fauxToolCall(UPDATE_TOOL, { action: "none" }), { stopReason: "toolUse" }),
				fauxAssistantMessage(finishCall("preserves state"), { stopReason: "toolUse" }),
			]);

			await harness.session.prompt("Original goal text");

			const finishEnds = toolEndEvents(harness, "finish_work");
			expect(finishEnds).toHaveLength(1);
			expect(finishEnds[0]?.isError).toBe(false);

			const state = getLatestStructuredSessionState(harness.sessionManager.getEntries());
			expect(state?.canonicalRequest.current).toBe("Original goal text");
			expect(state?.decisions).toBeDefined();
			expect(state?.decisions?.[0]?.decision).toBe("Key decision");
		} finally {
			harness.cleanup();
		}
	});

	it("finish_work still fails when auto-update cannot resolve unresolved plan items", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage(updateStateCall("Do all tracked work"), { stopReason: "toolUse" }),
				fauxAssistantMessage(finishCall("done too early"), { stopReason: "toolUse" }),
				fauxAssistantMessage(
					finishCall("partially complete", {
						status: "partial",
						remainingWork: ["Inspect the requested file"],
					}),
					{ stopReason: "toolUse" },
				),
			]);

			await harness.session.prompt("Do all tracked work");

			const finishEnds = toolEndEvents(harness, "finish_work");
			expect(finishEnds).toHaveLength(2);
			expect(finishEnds[0]?.isError).toBe(true);
			expect(JSON.stringify(finishEnds[0]?.result.content)).toContain("unresolved work");
			expect(finishEnds[1]?.isError).toBe(false);
		} finally {
			harness.cleanup();
		}
	});
});
