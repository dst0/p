import type { AgentMessage, AgentTool } from "@dst0/p-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { convertToLlm, SLEEP_TOOL_NAME } from "../../src/core/messages.ts";
import { createHarness, type Harness } from "./harness.ts";

function persistedMessages(harness: Harness): AgentMessage[] {
	return harness.sessionManager.getEntries().flatMap((entry) => (entry.type === "message" ? [entry.message] : []));
}

function assistantToolNames(messages: AgentMessage[]): string[] {
	return messages.flatMap((message) =>
		message.role === "assistant"
			? message.content.flatMap((content) => (content.type === "toolCall" ? [content.name] : []))
			: [],
	);
}

function toolResultNames(messages: AgentMessage[]): string[] {
	return messages.flatMap((message) => (message.role === "toolResult" ? [message.toolName] : []));
}

function createEchoTool(): AgentTool {
	return {
		name: "echo",
		label: "Echo",
		description: "Echo text back",
		parameters: Type.Object({ text: Type.String() }),
		execute: async (_toolCallId, params) => {
			const text = typeof params === "object" && params !== null && "text" in params ? String(params.text) : "";
			return { content: [{ type: "text", text: `echo:${text}` }], details: { text } };
		},
	};
}

describe("AgentSession sleep history filtering", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("drops assistant sleep-only turns from persisted and visible history", async () => {
		const harness = await createHarness({ completionMode: "implicit" });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall(SLEEP_TOOL_NAME, { seconds: 0 })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("start");

		const persisted = persistedMessages(harness);
		expect(persisted.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(assistantToolNames(persisted)).toEqual([]);
		expect(toolResultNames(persisted)).toEqual([]);
		expect(harness.session.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(harness.session.getSessionStats().toolCalls).toBe(0);
		expect(harness.session.getSessionStats().toolResults).toBe(0);
	});

	it("removes sleep from mixed tool turns while preserving real tool history and context", async () => {
		const harness = await createHarness({ completionMode: "implicit", tools: [createEchoTool()] });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall(SLEEP_TOOL_NAME, { seconds: 0 }), fauxToolCall("echo", { text: "hello" })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("start");

		const persisted = persistedMessages(harness);
		expect(assistantToolNames(persisted)).toEqual(["echo"]);
		expect(toolResultNames(persisted)).toEqual(["echo"]);
		expect(assistantToolNames(harness.session.messages)).toEqual(["echo"]);
		expect(toolResultNames(harness.session.messages)).toEqual(["echo"]);
		expect(harness.session.getSessionStats().toolCalls).toBe(1);
		expect(harness.session.getSessionStats().toolResults).toBe(1);

		const llmMessages = convertToLlm(harness.session.state.messages);
		expect(JSON.stringify(llmMessages)).not.toContain(`"${SLEEP_TOOL_NAME}"`);
		expect(JSON.stringify(llmMessages)).toContain('"echo"');
	});
});
