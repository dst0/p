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

	it("preserves completed plan items when finish_work auto-updates after tool use", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				// Turn 1: set up initial state with no open progress items
				fauxAssistantMessage(
					fauxToolCall(UPDATE_TOOL, {
						action: "initial_plan",
						goal: "Track progress then finish",
						plan: [{ text: "Inspect the requested file", status: "done" }],
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
			expect(state?.plan.map((item) => [item.text, item.status])).toContainEqual([
				"Inspect the requested file",
				"done",
			]);
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
						decisions: [{ decision: "Key decision", rationale: "Because reasons" }],
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall(UPDATE_TOOL, {
						action: "progress_update",
						plan: [{ text: "Task one", status: "done" }],
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

	it("auto-completes unresolved plan items on successful finish_work", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage(updateStateCall("Do all tracked work"), { stopReason: "toolUse" }),
				fauxAssistantMessage(finishCall("completed"), { stopReason: "toolUse" }),
			]);

			await harness.session.prompt("Do all tracked work");

			const finishEnds = toolEndEvents(harness, "finish_work");
			expect(finishEnds).toHaveLength(1);
			expect(finishEnds[0]?.isError).toBe(false);

			const state = getLatestStructuredSessionState(harness.sessionManager.getEntries());

			expect(state?.plan).toEqual([
				expect.objectContaining({
					text: "Inspect the requested file",
					status: "done",
				}),
			]);
		} finally {
			harness.cleanup();
		}
	});

	it("partial with empty remaining_work remains blocked when work is unresolved", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage(updateStateCall("Do all tracked work"), { stopReason: "toolUse" }),
				fauxAssistantMessage(
					finishCall("partially complete", {
						status: "partial",
					}),
					{ stopReason: "toolUse" },
				),
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

	it("partial with populated remaining_work succeeds", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage(updateStateCall("Do all tracked work"), { stopReason: "toolUse" }),
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
			expect(finishEnds).toHaveLength(1);
			expect(finishEnds[0]?.isError).toBe(false);
		} finally {
			harness.cleanup();
		}
	});

	it("success with failed plan items remains blocked", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage(
					fauxToolCall(UPDATE_TOOL, {
						action: "initial_plan",
						goal: "Do all tracked work",
						plan: [{ text: "Inspect the requested file", status: "failed" }],
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(finishCall("done anyway"), { stopReason: "toolUse" }),
			]);

			await harness.session.prompt("Do all tracked work");

			const finishEnds = toolEndEvents(harness, "finish_work");
			expect(finishEnds).toHaveLength(1);
			expect(finishEnds[0]?.isError).toBe(true);
			expect(JSON.stringify(finishEnds[0]?.result.content)).toContain("unresolved work");
		} finally {
			harness.cleanup();
		}
	});

	it("success with blocked plan items remains blocked", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage(
					fauxToolCall(UPDATE_TOOL, {
						action: "initial_plan",
						goal: "Do all tracked work",
						plan: [{ text: "Inspect the requested file", status: "blocked" }],
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(finishCall("done anyway"), { stopReason: "toolUse" }),
			]);

			await harness.session.prompt("Do all tracked work");

			const finishEnds = toolEndEvents(harness, "finish_work");
			expect(finishEnds).toHaveLength(1);
			expect(finishEnds[0]?.isError).toBe(true);
			expect(JSON.stringify(finishEnds[0]?.result.content)).toContain("unresolved work");
		} finally {
			harness.cleanup();
		}
	});

\tit("does not reconcile when a success payload fails validation", async () => {
\t\tconst harness = await createHarness();
\t\ttry {
\t\t\tharness.setResponses([
\t\t\t\tfauxAssistantMessage(updateStateCall("Do all tracked work"), { stopReason: "toolUse" }),
\t\t\t\tfauxAssistantMessage(
\t\t\t\t\tfinishCall("invalid success", {
\t\t\t\t\t\tremainingWork: ["Inspect the requested file"],
\t\t\t\t\t}),
\t\t\t\t\t{ stopReason: "toolUse" },
\t\t\t\t),
\t\t\t\tfauxAssistantMessage(
\t\t\t\t\tfinishCall("partially complete", {
\t\t\t\t\t\tstatus: "partial",
\t\t\t\t\t\tremainingWork: ["Inspect the requested file"],
\t\t\t\t\t}),
\t\t\t\t\t{ stopReason: "toolUse" },
\t\t\t\t),
\t\t\t]);

\t\t\tawait harness.session.prompt("Do all tracked work");

\t\t\tconst finishEnds = toolEndEvents(harness, "finish_work");
\t\t\texpect(finishEnds).toHaveLength(2);
\t\t\texpect(finishEnds[0]?.isError).toBe(true);
\t\t\texpect(JSON.stringify(finishEnds[0]?.result.content)).toContain("validation error");
\t\t\texpect(finishEnds[1]?.isError).toBe(false);

\t\t\tconst state = getLatestStructuredSessionState(harness.sessionManager.getEntries());
\t\t\texpect(state?.plan.map((item) => [item.text, item.status])).toEqual([
\t\t\t\t["Inspect the requested file", "in_progress"],
\t\t\t]);
\t\t} finally {
\t\t\tharness.cleanup();
\t\t}
\t});

\tit("does not reconcile auto-completable items when another item blocks success", async () => {
\t\tconst harness = await createHarness();
\t\ttry {
\t\t\tharness.setResponses([
\t\t\t\tfauxAssistantMessage(
\t\t\t\t\tfauxToolCall(UPDATE_TOOL, {
\t\t\t\t\t\taction: "initial_plan",
\t\t\t\t\t\tgoal: "Do all tracked work",
\t\t\t\t\t\tplan: [
\t\t\t\t\t\t\t{ text: "Implement the change", status: "in_progress" },
\t\t\t\t\t\t\t{ text: "Run verification", status: "failed" },
\t\t\t\t\t\t],
\t\t\t\t\t}),
\t\t\t\t\t{ stopReason: "toolUse" },
\t\t\t\t),
\t\t\t\tfauxAssistantMessage(finishCall("done anyway"), { stopReason: "toolUse" }),
\t\t\t\tfauxAssistantMessage(
\t\t\t\t\tfinishCall("partially complete", {
\t\t\t\t\t\tstatus: "partial",
\t\t\t\t\t\tremainingWork: ["Implement the change", "Run verification"],
\t\t\t\t\t}),
\t\t\t\t\t{ stopReason: "toolUse" },
\t\t\t\t),
\t\t\t]);

\t\t\tawait harness.session.prompt("Do all tracked work");

\t\t\tconst finishEnds = toolEndEvents(harness, "finish_work");
\t\t\texpect(finishEnds).toHaveLength(2);
\t\t\texpect(finishEnds[0]?.isError).toBe(true);
\t\t\texpect(finishEnds[1]?.isError).toBe(false);

\t\t\tconst state = getLatestStructuredSessionState(harness.sessionManager.getEntries());
\t\t\texpect(state?.plan.map((item) => [item.text, item.status])).toEqual([
\t\t\t\t["Implement the change", "in_progress"],
\t\t\t\t["Run verification", "failed"],
\t\t\t]);
\t\t} finally {
\t\t\tharness.cleanup();
\t\t}
\t});
});
