import type { AgentMessage } from "@dst0/p-agent-core";
import { type AssistantMessage, getModel, type TextContent, type ToolResultMessage, type Usage } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import { estimateTokens, stubToolResultsForCompactionSummary } from "../src/core/compaction/compaction.ts";

const model = getModel("anthropic", "claude-sonnet-4-5")!;

function createUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};
}

function createAssistantToolCallMessage(
	id: string,
	name: string,
	arguments_: Record<string, unknown>,
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: arguments_ }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: createUsage(),
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
}

function getTextPart(part: ToolResultMessage["content"][number] | undefined): TextContent {
	expect(part?.type).toBe("text");
	if (!part || part.type !== "text") {
		throw new Error("Expected text content");
	}
	return part;
}

describe("context management", () => {
	it("counts image data when estimating tool result context", () => {
		const imageData = "a".repeat(64_000);
		const result: ToolResultMessage = {
			role: "toolResult",
			toolCallId: "call-read-image",
			toolName: "read",
			content: [
				{ type: "text", text: "Read image file [image/png]" },
				{ type: "image", mimeType: "image/png", data: imageData },
			],
			isError: false,
			timestamp: Date.now(),
		};

		expect(estimateTokens(result)).toBeGreaterThan(16_000);
	});

	it("stubs image tool results only for the one-shot compaction summary", () => {
		const oldImageData = "a".repeat(64_000);
		const oldImageResult: ToolResultMessage = {
			role: "toolResult",
			toolCallId: "call-old-image",
			toolName: "read",
			content: [
				{ type: "text", text: "Read image file [image/png]" },
				{ type: "image", mimeType: "image/png", data: oldImageData },
			],
			isError: false,
			timestamp: Date.now(),
		};
		const messages: AgentMessage[] = [
			{ role: "user", content: "hello", timestamp: Date.now() },
			createAssistantToolCallMessage("call-old-image", "read", { path: "/tmp/shot.png" }),
			oldImageResult,
		];

		const result = stubToolResultsForCompactionSummary(messages);

		const stubbedMessage = result.messages[2] as ToolResultMessage;
		expect(stubbedMessage.content.some((part) => part.type === "image")).toBe(false);
		expect(getTextPart(stubbedMessage.content[0]).text).toContain("[Tool result stubbed");
		expect(result.stubs.map((stub) => stub.rawPointer.id)).toContain("tool-result:call-old-image");
		expect(result.tokenSavingsEstimate).toBeGreaterThan(10_000);
		expect(oldImageResult.content.some((part) => part.type === "image")).toBe(true);
	});

	it("uses the provided summary when a result is stubbed after calling keep_context", () => {
		const largeContent = "a".repeat(10000);
		const toolResult: ToolResultMessage = {
			role: "toolResult",
			toolCallId: "call1",
			toolName: "bash",
			content: [{ type: "text", text: largeContent }],
			isError: false,
			timestamp: Date.now(),
			details: {
				contextExtract: {
					summary: "This is a custom summary",
					relevantLines: ["Key line 1"],
					source: "service_model",
				},
			},
		};

		const messages: AgentMessage[] = [
			{ role: "user", content: "hello", timestamp: Date.now() },
			createAssistantToolCallMessage("call1", "bash", { command: "ls" }),
			toolResult,
		];

		const result = stubToolResultsForCompactionSummary(messages);

		const stubbedMessage = result.messages[2] as ToolResultMessage;
		const stubbedText = getTextPart(stubbedMessage.content[0]).text;
		expect(stubbedText).toContain("[Tool result stubbed");
		expect(stubbedText).toContain("Summary: This is a custom summary");
		expect(stubbedText).toContain("- Key line 1");
	});
});
