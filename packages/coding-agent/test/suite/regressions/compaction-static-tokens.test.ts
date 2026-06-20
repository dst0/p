/**
 * Regression tests for the context compaction fix — staticTokens inclusion,
 * isUsageReliable guard, post-compaction truncation, and prepareCompaction
 * systemPrompt wiring.
 */

import type { AgentMessage } from "@dst0/p-agent-core";
import type { AssistantMessage, Usage } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import {
	estimateContextTokens,
	estimateTokens,
	isUsageReliable,
	truncateKeptMessages,
} from "../../../src/core/compaction/compaction.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createUsage(input: number, output: number): Usage {
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createAssistant(text: string, usage: Usage, timestamp?: number): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		usage,
		stopReason: "stop",
		timestamp: timestamp ?? Date.now(),
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
	} as AssistantMessage;
}

function createUser(text: string, timestamp?: number): AgentMessage {
	return { role: "user", content: text, timestamp: timestamp ?? Date.now() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isUsageReliable", () => {
	it("returns true when input > 0", () => {
		expect(isUsageReliable(createUsage(100, 50))).toBe(true);
	});

	it("returns false when input === 0 (local LLM streaming chunks)", () => {
		expect(isUsageReliable(createUsage(0, 100))).toBe(false);
	});

	it("returns false when input is 0 and output is 0", () => {
		expect(isUsageReliable(createUsage(0, 0))).toBe(false);
	});
});

describe("estimateContextTokens with staticTokens", () => {
	it("includes staticTokens in total when systemPrompt is provided", () => {
		const systemPrompt = "A".repeat(4000); // ~1000 tokens
		const assistant = createAssistant("reply", createUsage(5000, 500));
		const messages = [createUser("hello"), assistant];

		const estimate = estimateContextTokens(messages, systemPrompt);
		expect(estimate.staticTokens).toBe(Math.ceil(4000 / 4));
		expect(estimate.tokens).toBe(estimate.usageTokens + estimate.trailingTokens + estimate.staticTokens);
	});

	it("includes staticTokens in no-usage fallback path", () => {
		const systemPrompt = "B".repeat(8000); // ~2000 tokens
		const messages = [createUser("only user message")];

		const estimate = estimateContextTokens(messages, systemPrompt);
		expect(estimate.usageTokens).toBe(0);
		expect(estimate.lastUsageIndex).toBeNull();
		expect(estimate.staticTokens).toBe(Math.ceil(8000 / 4));
		// trailingTokens = estimated (user chars / 4) + staticTokens
		const userTokens = estimateTokens(createUser("only user message"));
		expect(estimate.trailingTokens).toBe(userTokens + estimate.staticTokens);
	});

	it("staticTokens is 0 when no systemPrompt", () => {
		const messages = [createUser("hi"), createAssistant("bye", createUsage(100, 10))];
		const estimate = estimateContextTokens(messages);
		expect(estimate.staticTokens).toBe(0);
	});

	it("staticTokens does not affect trailingTokens", () => {
		const systemPrompt = "C".repeat(4000);
		const assistant = createAssistant("reply", createUsage(10000, 100));
		const trailing = createUser("after");
		const messages = [createUser("before"), assistant, trailing];

		const estimate = estimateContextTokens(messages, systemPrompt);
		expect(estimate.trailingTokens).toBe(estimateTokens(trailing));
		expect(estimate.staticTokens).toBe(Math.ceil(4000 / 4));
	});
});

describe("truncateKeptMessages", () => {
	it("skips compactionSummary messages", () => {
		const summary: AgentMessage = {
			role: "compactionSummary",
			summary: "Summary text",
			tokensBefore: 1000,
			timestamp: Date.now(),
		};
		const oversized = createUser("x".repeat(50000));
		const messages = [summary, oversized];

		truncateKeptMessages(messages, 1000);
		expect(messages[0]).toBe(summary); // unchanged
		expect((messages[1] as any).content.length).toBeLessThan(50000);
	});

	it("truncates oversized messages when they exceed budget", () => {
		const oversized = createUser("w".repeat(60000));
		const messages = [oversized];

		truncateKeptMessages(messages, 1000);
		const content = (messages[0] as any).content;
		expect(content).toContain("[...truncated");
	});

	it("leaves small messages untouched", () => {
		const small = createUser("hello");
		const messages = [small];

		truncateKeptMessages(messages, 10000);
		expect((messages[0] as any).content).toBe("hello");
	});
});
