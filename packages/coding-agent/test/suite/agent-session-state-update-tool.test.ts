import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, type Message, type TextContent } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import {
	getLatestStructuredSessionState,
	STRUCTURED_SESSION_STATE_CUSTOM_TYPE,
} from "../../src/core/compaction/index.ts";
import { createHarness, type Harness } from "./harness.ts";

const UPDATE_TOOL = "update_session_state";
const PROGRESS_TOOL = "mark_session_progress";

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

function markProgressCall(
	task: string,
	status: "not_started" | "in_progress" | "done" | "failed" | "blocked",
	next?: string[],
) {
	return fauxToolCall(PROGRESS_TOOL, { task, status, next });
}

function toolEndEvents(harness: Harness, toolName: string) {
	return harness.eventsOfType("tool_execution_end").filter((event) => event.toolName === toolName);
}

function getUserTexts(messages: Message[]): string[] {
	return messages.flatMap((message) => {
		if (message.role !== "user") return [];
		if (typeof message.content === "string") return [message.content];
		return message.content.filter((part): part is TextContent => part.type === "text").map((part) => part.text);
	});
}

describe("AgentSession default session-state tool", () => {
	it("requires update_session_state before first-turn tool use", async () => {
		const harness = await createHarness();
		try {
			writeFileSync(join(harness.tempDir, "note.txt"), "state tool smoke\n");
			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("read", { path: "note.txt" }), { stopReason: "toolUse" }),
				fauxAssistantMessage(updateStateCall("Read note.txt and report the result"), { stopReason: "toolUse" }),
				fauxAssistantMessage(fauxToolCall("read", { path: "note.txt" }), { stopReason: "toolUse" }),
				fauxAssistantMessage(finishCall("premature finish"), { stopReason: "toolUse" }),
				fauxAssistantMessage(markProgressCall("Inspect the requested file", "done"), { stopReason: "toolUse" }),
				fauxAssistantMessage(finishCall("read note"), { stopReason: "toolUse" }),
			]);

			await harness.session.prompt("Read note.txt and report the result");

			const readEnds = toolEndEvents(harness, "read");
			expect(readEnds).toHaveLength(2);
			expect(readEnds[0]?.isError).toBe(true);
			expect(JSON.stringify(readEnds[0]?.result.content)).toContain(UPDATE_TOOL);
			expect(readEnds[1]?.isError).toBe(false);
			expect(toolEndEvents(harness, UPDATE_TOOL)[0]?.isError).toBe(false);
			const finishEnds = toolEndEvents(harness, "finish_work");
			expect(finishEnds).toHaveLength(2);
			expect(finishEnds[0]?.isError).toBe(true);
			expect(JSON.stringify(finishEnds[0]?.result.content)).toContain(PROGRESS_TOOL);
			expect(finishEnds[1]?.isError).toBe(false);
			const state = getLatestStructuredSessionState(harness.sessionManager.getEntries());
			expect(state?.canonicalRequest.current).toBe("Read note.txt and report the result");
			expect(state?.plan.map((item) => [item.text, item.status])).toEqual([["Inspect the requested file", "done"]]);
			expect(state?.progress.done).toEqual(["Inspect the requested file"]);
		} finally {
			harness.cleanup();
		}
	});

	it("carries completed tool outcomes and refreshed working state into the next provider turn", async () => {
		const harness = await createHarness();
		try {
			writeFileSync(join(harness.tempDir, "note.txt"), "state tool smoke\n");
			let afterStateUpdate: string[] = [];
			let afterRead: string[] = [];
			let afterProgressUpdate: string[] = [];
			harness.setResponses([
				fauxAssistantMessage(updateStateCall("Read note.txt and report the result"), { stopReason: "toolUse" }),
				(context) => {
					afterStateUpdate = getUserTexts(context.messages);
					return fauxAssistantMessage(fauxToolCall("read", { path: "note.txt" }), { stopReason: "toolUse" });
				},
				(context) => {
					afterRead = getUserTexts(context.messages);
					return fauxAssistantMessage(markProgressCall("Inspect the requested file", "done"), {
						stopReason: "toolUse",
					});
				},
				(context) => {
					afterProgressUpdate = getUserTexts(context.messages);
					return fauxAssistantMessage(finishCall("read note"), { stopReason: "toolUse" });
				},
			]);

			await harness.session.prompt("Read note.txt and report the result");

			const initialCheckpoint = afterStateUpdate.find((text) => text.includes("<turn_checkpoint>")) ?? "";
			const initialWorkingState =
				afterStateUpdate.find((text) => text.trimStart().startsWith("<working_state>")) ?? "";
			expect(initialCheckpoint).toContain("SUCCESS update_session_state");
			expect(initialWorkingState).toContain("Read note.txt and report the result");
			expect(initialWorkingState).toContain("⏳ Inspect the requested file");

			const readCheckpoint = afterRead.filter((text) => text.includes("<turn_checkpoint>")).at(-1) ?? "";
			expect(readCheckpoint).toContain("SUCCESS read");
			expect(readCheckpoint).toContain("Do not repeat an identical successful call");

			const latestWorkingState =
				afterProgressUpdate.filter((text) => text.trimStart().startsWith("<working_state>")).at(-1) ?? "";
			expect(latestWorkingState).toContain("✅ Inspect the requested file");
			expect(latestWorkingState).not.toContain("⏳ Inspect the requested file");

			const persistedCheckpoints = harness.session.messages.filter(
				(message) => message.role === "custom" && message.customType === "turn_checkpoint",
			);
			expect(persistedCheckpoints).toHaveLength(3);
		} finally {
			harness.cleanup();
		}
	});

	it("updates existing plan items for progress_update instead of adding duplicates", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage(
					fauxToolCall(UPDATE_TOOL, {
						action: "initial_plan",
						goal: "Keep session state concise",
						plan: [{ text: "Patch state merge behavior", status: "in_progress" }],
						progress: { current: ["Patch state merge behavior"] },
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall(UPDATE_TOOL, {
						action: "progress_update",
						plan: [{ text: "Impl: Patch state merge behavior", status: "done" }],
						progress: { done: ["Patch state merge behavior"] },
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(finishCall("state updated"), { stopReason: "toolUse" }),
			]);

			await harness.session.prompt("Keep session state concise");

			const state = getLatestStructuredSessionState(harness.sessionManager.getEntries());
			expect(toolEndEvents(harness, UPDATE_TOOL).every((event) => !event.isError)).toBe(true);
			expect(state?.plan.map((item) => [item.text, item.status])).toEqual([["Patch state merge behavior", "done"]]);
			expect(state?.progress.done).toEqual(["Patch state merge behavior"]);
			expect(state?.progress.next).toEqual([]);
		} finally {
			harness.cleanup();
		}
	});

	it("clears explicit next actions before finish_work", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage(
					fauxToolCall(UPDATE_TOOL, {
						action: "initial_plan",
						goal: "Complete the tracked work",
						plan: [{ text: "Complete the tracked work", status: "done" }],
						progress: { next: ["Run final verification"] },
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall(UPDATE_TOOL, {
						action: "progress_update",
						progress: { next: [] },
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(finishCall("tracked work complete"), { stopReason: "toolUse" }),
			]);

			await harness.session.prompt("Complete the tracked work");

			const state = getLatestStructuredSessionState(harness.sessionManager.getEntries());
			expect(state?.progress.next).toEqual([]);
			expect(toolEndEvents(harness, "finish_work")).toHaveLength(1);
			expect(toolEndEvents(harness, "finish_work")[0]?.isError).toBe(false);
		} finally {
			harness.cleanup();
		}
	});

	it("does not treat terminal next-action placeholders as unresolved work", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage(
					fauxToolCall(UPDATE_TOOL, {
						action: "initial_plan",
						goal: "Complete the tracked work",
						plan: [{ text: "Complete the tracked work", status: "done" }],
						progress: { next: ["Done"] },
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(finishCall("tracked work complete"), { stopReason: "toolUse" }),
			]);

			await harness.session.prompt("Complete the tracked work");

			const state = getLatestStructuredSessionState(harness.sessionManager.getEntries());
			expect(state?.progress.next).toEqual([]);
			expect(toolEndEvents(harness, "finish_work")).toHaveLength(1);
			expect(toolEndEvents(harness, "finish_work")[0]?.isError).toBe(false);
		} finally {
			harness.cleanup();
		}
	});

	it("blocks successful finish_work while session state has unresolved plan items", async () => {
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
			expect(JSON.stringify(finishEnds[0]?.result.content)).toContain("Do not retry finish_work");
			expect(finishEnds[1]?.isError).toBe(false);
		} finally {
			harness.cleanup();
		}
	});

	it("replaces stale open plan items on replan instead of carrying them to completion", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage(
					fauxToolCall(UPDATE_TOOL, {
						action: "initial_plan",
						goal: "Clean session state",
						plan: [
							{ text: "Old stale task", status: "in_progress" },
							{ text: "Run checks", status: "not_started" },
						],
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall(UPDATE_TOOL, {
						action: "replan",
						goal: "Clean session state",
						plan: [{ text: "Run checks", status: "in_progress" }],
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(markProgressCall("Run checks", "done"), { stopReason: "toolUse" }),
				fauxAssistantMessage(finishCall("cleaned state"), { stopReason: "toolUse" }),
			]);

			await harness.session.prompt("Clean session state");

			const state = getLatestStructuredSessionState(harness.sessionManager.getEntries());
			expect(state?.plan.map((item) => [item.text, item.status])).toEqual([["Run checks", "done"]]);
			expect(toolEndEvents(harness, "finish_work").at(-1)?.isError).toBe(false);
		} finally {
			harness.cleanup();
		}
	});

	it("requires update_session_state again for follow-up user messages without overwriting the durable goal", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage(updateStateCall("Preserve the primary goal"), { stopReason: "toolUse" }),
				fauxAssistantMessage(markProgressCall("Inspect the requested file", "done"), { stopReason: "toolUse" }),
				fauxAssistantMessage(finishCall("seeded state"), { stopReason: "toolUse" }),
				fauxAssistantMessage(fauxToolCall("read", { path: "follow-up.txt" }), { stopReason: "toolUse" }),
				fauxAssistantMessage(updateStateCall("Preserve the primary goal", "replan"), { stopReason: "toolUse" }),
				fauxAssistantMessage(markProgressCall("Inspect the requested file", "done"), { stopReason: "toolUse" }),
				fauxAssistantMessage(finishCall("follow-up handled"), { stopReason: "toolUse" }),
			]);

			await harness.session.prompt("Preserve the primary goal");
			await harness.session.prompt("Also inspect follow-up.txt before answering");

			const readEnds = toolEndEvents(harness, "read");
			expect(readEnds).toHaveLength(1);
			expect(readEnds[0]?.isError).toBe(true);
			expect(JSON.stringify(readEnds[0]?.result.content)).toContain(UPDATE_TOOL);

			const stateEntries = harness.sessionManager
				.getEntries()
				.filter((entry) => entry.type === "custom" && entry.customType === STRUCTURED_SESSION_STATE_CUSTOM_TYPE);
			expect(stateEntries.length).toBeGreaterThanOrEqual(2);
			const state = getLatestStructuredSessionState(harness.sessionManager.getEntries());
			expect(state?.canonicalRequest.current).toBe("Preserve the primary goal");
			expect(state?.canonicalRequest.originalRequests.map((request) => request.text)).toEqual(
				expect.arrayContaining(["Preserve the primary goal", "Also inspect follow-up.txt before answering"]),
			);
		} finally {
			harness.cleanup();
		}
	});

	it("auto-prepends update_session_state before completion after a direct assistant answer", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage("plain answer without finish_work"),
				fauxAssistantMessage(finishCall("auto-prepended state"), { stopReason: "toolUse" }),
			]);

			await harness.session.prompt("Answer directly after recording the goal");

			const finishEnds = toolEndEvents(harness, "finish_work");
			expect(finishEnds).toHaveLength(1);
			expect(finishEnds[0]?.isError).toBe(false);

			// Auto-prepend creates state from current values; on first turn there is no prior state
			const state = getLatestStructuredSessionState(harness.sessionManager.getEntries());
			expect(state?.canonicalRequest.current).toBe("");
		} finally {
			harness.cleanup();
		}
	});
});
