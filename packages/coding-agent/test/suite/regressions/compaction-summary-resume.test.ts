import { describe, expect, it } from "vitest";
import { convertToLlm, createCompactionSummaryMessage } from "../../../src/core/messages.ts";

function firstText(message: ReturnType<typeof convertToLlm>[number]): string {
	const block = message.content[0];
	return block?.type === "text" ? block.text : "";
}

describe("compaction summary resume context", () => {
	it("renders compacted state as authoritative task context", () => {
		const checkpoint = [
			"<session_checkpoint>",
			"Goal: Normalize task statuses before continuing the P-agent integration.",
			"Current plan:",
			"- [in_progress] Replace Open task proposals with Ready.",
			"Next action:",
			"- Run the targeted backend task-status tests.",
			"</session_checkpoint>",
		].join("\n");

		const [message] = convertToLlm([createCompactionSummaryMessage(checkpoint, 12_000, new Date().toISOString())]);

		expect(message?.role).toBe("user");
		const text = message ? firstText(message) : "";
		expect(text).toContain("authoritative working-state checkpoint");
		expect(text).toContain("Continue from its Goal, Plan, Next action");
		expect(text).toContain("Do not infer the task only from the latest user message");
		expect(text).toContain("Goal: Normalize task statuses");
		expect(text).toContain("Replace Open task proposals with Ready");
	});
});
