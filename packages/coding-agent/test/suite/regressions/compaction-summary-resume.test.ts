import { describe, expect, it } from "vitest";
import { convertToLlm, createCompactionSummaryMessage } from "../../../src/core/messages.ts";

function messageText(message: ReturnType<typeof convertToLlm>[number]): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

describe("compaction summary resume context", () => {
	it("renders compacted state as authoritative task context", () => {
		const checkpoint = [
			"<session_checkpoint>",
			"Goal: Normalize task statuses before continuing the P-agent integration.",
			"Current plan:",
			"- [in_progress] Replace task proposals with Ready.",
			"Next action:",
			"- Run the targeted backend task-status tests.",
			"</session_checkpoint>",
		].join("\n");

		const [message] = convertToLlm([createCompactionSummaryMessage(checkpoint, 12_000, new Date().toISOString())]);

		expect(message?.role).toBe("user");
		const text = message ? messageText(message) : "";
		expect(text).toContain("authoritative working-state checkpoint");
		expect(text).toContain("Continue from its Goal, Plan, Next action");
		expect(text).toContain("latest user message");
		expect(text).toContain("Goal: Normalize task statuses");
		expect(text).toContain("task proposals with Ready");
	});
});
