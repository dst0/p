import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import {
	getLatestStructuredSessionState,
	STRUCTURED_SESSION_STATE_CUSTOM_TYPE,
} from "../../src/core/compaction/index.ts";
import { createHarness, type Harness } from "./harness.ts";

const UPDATE_TOOL = "update_session_state";

function updateStateCall(goal: string, action: "initial_plan" | "replan" = "initial_plan") {
	return fauxToolCall(UPDATE_TOOL, {
		action,
		goal,
		plan: [{ text: "Inspect the requested file", status: "in_progress" }],
		progress: { current: ["Inspect the requested file"], next: ["Report the result"] },
	});
}

function finishCall(summary = "done") {
	return fauxToolCall("finish_work", { status: "success", summary });
}

function toolEndEvents(harness: Harness, toolName: string) {
	return harness.eventsOfType("tool_execution_end").filter((event) => event.toolName === toolName);
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
				fauxAssistantMessage(finishCall("read note"), { stopReason: "toolUse" }),
			]);

			await harness.session.prompt("Read note.txt and report the result");

			const readEnds = toolEndEvents(harness, "read");
			expect(readEnds).toHaveLength(2);
			expect(readEnds[0]?.isError).toBe(true);
			expect(JSON.stringify(readEnds[0]?.result.content)).toContain(UPDATE_TOOL);
			expect(readEnds[1]?.isError).toBe(false);
			expect(toolEndEvents(harness, UPDATE_TOOL)[0]?.isError).toBe(false);
			expect(getLatestStructuredSessionState(harness.sessionManager.getEntries())?.canonicalRequest.current).toBe(
				"Read note.txt and report the result",
			);
		} finally {
			harness.cleanup();
		}
	});

	it("requires update_session_state again for follow-up user messages without overwriting the durable goal", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage(updateStateCall("Preserve the primary goal"), { stopReason: "toolUse" }),
				fauxAssistantMessage(finishCall("seeded state"), { stopReason: "toolUse" }),
				fauxAssistantMessage(fauxToolCall("read", { path: "follow-up.txt" }), { stopReason: "toolUse" }),
				fauxAssistantMessage(updateStateCall("Preserve the primary goal", "replan"), { stopReason: "toolUse" }),
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

	it("requires update_session_state before completion after a direct assistant answer", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage("plain answer without finish_work"),
				fauxAssistantMessage(finishCall("premature finish"), { stopReason: "toolUse" }),
				fauxAssistantMessage(updateStateCall("Answer directly after recording the goal"), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage(finishCall("recorded state before finishing"), { stopReason: "toolUse" }),
			]);

			await harness.session.prompt("Answer directly after recording the goal");

			const finishEnds = toolEndEvents(harness, "finish_work");
			expect(finishEnds).toHaveLength(2);
			expect(finishEnds[0]?.isError).toBe(true);
			expect(JSON.stringify(finishEnds[0]?.result.content)).toContain(UPDATE_TOOL);
			expect(finishEnds[1]?.isError).toBe(false);
			expect(toolEndEvents(harness, UPDATE_TOOL)[0]?.isError).toBe(false);
			expect(getLatestStructuredSessionState(harness.sessionManager.getEntries())?.canonicalRequest.current).toBe(
				"Answer directly after recording the goal",
			);
		} finally {
			harness.cleanup();
		}
	});
});
