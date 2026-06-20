import type { AgentMessage } from "@dst0/p-agent-core";
import type { ToolResultMessage } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import { stubToolResultsForPrompt } from "../src/core/compaction/compaction.ts";

describe("context management", () => {
	it("keeps the most recent tool result raw even if it is large", () => {
		const largeContent = "a".repeat(10000); // ~2500 tokens, exceeds old 1200 threshold
		const messages: AgentMessage[] = [
			{ role: "user", content: "hello", timestamp: Date.now() },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "call1", name: "bash", arguments: { command: "ls" } }],
				api: "openai-completions" as any,
				provider: "faux" as any,
				model: "faux",
				usage: {} as any,
				stopReason: "toolUse",
				timestamp: Date.now(),
			},
			{
				role: "toolResult",
				toolCallId: "call1",
				toolName: "bash",
				content: [{ type: "text", text: largeContent }],
				isError: false,
				timestamp: Date.now(),
			} as ToolResultMessage,
		];

		// This simulates the settings used in _preparePromptContext for live prompts
		const livePromptSettings = {
			enabled: true,
			toolResultKeepRecentCount: 1, // My change
			toolResultClearThresholdTokens: 32000, // My change
			toolResultPromptBudgetTokens: 64000, // My change
			triggerReserveTokens: 12000,
			keepRecentMinTokens: 2000,
			keepRecentMaxTokens: 8000,
			summaryMaxTokens: 1200,
			renderedStateMaxTokens: 1500,
			targetContextTokens: 12000,
		};

		const result = stubToolResultsForPrompt(messages, livePromptSettings as any);

		// Should NOT be stubbed because it's the most recent (keepRecentCount: 1)
		expect(result.messages[2].role).toBe("toolResult");
		expect((result.messages[2] as ToolResultMessage).content[0].type).toBe("text");
		expect(((result.messages[2] as ToolResultMessage).content[0] as any).text).toBe(largeContent);
	});

	it("stubs older large tool results but keeps the most recent one", () => {
		const largeContent = "a".repeat(10000);
		const messages: AgentMessage[] = [
			{ role: "user", content: "hello", timestamp: Date.now() },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "call1", name: "bash", arguments: { command: "ls" } }],
				api: "openai-completions" as any,
				provider: "faux" as any,
				model: "faux",
				usage: {} as any,
				stopReason: "toolUse",
				timestamp: Date.now(),
			},
			{
				role: "toolResult",
				toolCallId: "call1",
				toolName: "bash",
				content: [{ type: "text", text: largeContent }],
				isError: false,
				timestamp: Date.now(),
			} as ToolResultMessage,
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "call2", name: "bash", arguments: { command: "ls" } }],
				api: "openai-completions" as any,
				provider: "faux" as any,
				model: "faux",
				usage: {} as any,
				stopReason: "toolUse",
				timestamp: Date.now(),
			},
			{
				role: "toolResult",
				toolCallId: "call2",
				toolName: "bash",
				content: [{ type: "text", text: "small output" }],
				isError: false,
				timestamp: Date.now(),
			} as ToolResultMessage,
		];

		const livePromptSettings = {
			enabled: true,
			toolResultKeepRecentCount: 1,
			toolResultClearThresholdTokens: 1200, // Trigger stubbing for large results
			toolResultPromptBudgetTokens: 4000,
			triggerReserveTokens: 12000,
			keepRecentMinTokens: 2000,
			keepRecentMaxTokens: 8000,
			summaryMaxTokens: 1200,
			renderedStateMaxTokens: 1500,
			targetContextTokens: 12000,
		};

		const result = stubToolResultsForPrompt(messages, livePromptSettings as any);

		// Old large result (index 2) should be stubbed
		expect((result.messages[2] as ToolResultMessage).content[0].type).toBe("text");
		expect(((result.messages[2] as ToolResultMessage).content[0] as any).text).toContain("[Tool result stubbed");

		// Recent result (index 4) should NOT be stubbed
		expect((result.messages[4] as ToolResultMessage).content[0].type).toBe("text");
		expect(((result.messages[4] as ToolResultMessage).content[0] as any).text).toBe("small output");
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
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "call1", name: "bash", arguments: { command: "ls" } }],
				api: "openai-completions" as any,
				provider: "faux" as any,
				model: "faux",
				usage: {} as any,
				stopReason: "toolUse",
				timestamp: Date.now(),
			},
			toolResult,
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "call2", name: "bash", arguments: { command: "ls" } }],
				api: "openai-completions" as any,
				provider: "faux" as any,
				model: "faux",
				usage: {} as any,
				stopReason: "toolUse",
				timestamp: Date.now(),
			},
			{
				role: "toolResult",
				toolCallId: "call2",
				toolName: "bash",
				content: [{ type: "text", text: "small output" }],
				isError: false,
				timestamp: Date.now(),
			} as ToolResultMessage,
		];

		const livePromptSettings = {
			enabled: true,
			toolResultKeepRecentCount: 1,
			toolResultClearThresholdTokens: 1200,
			toolResultPromptBudgetTokens: 4000,
			triggerReserveTokens: 12000,
			keepRecentMinTokens: 2000,
			keepRecentMaxTokens: 8000,
			summaryMaxTokens: 1200,
			renderedStateMaxTokens: 1500,
			targetContextTokens: 12000,
		};

		const result = stubToolResultsForPrompt(messages, livePromptSettings as any);

		// Old large result (index 2) should be stubbed and use our custom summary
		const stubbedMessage = result.messages[2] as ToolResultMessage;
		const stubbedText = (stubbedMessage.content[0] as any).text;
		expect(stubbedText).toContain("[Tool result stubbed");
		expect(stubbedText).toContain("Summary: This is a custom summary");
		expect(stubbedText).toContain("- Key line 1");
	});
});
