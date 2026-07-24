import type { AgentMessage } from "@dst0/p-agent-core";
import type { AssistantMessage, Model, Usage } from "@dst0/p-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type CompactionDetails,
	type CompactionPreparation,
	compact,
	createInitialStructuredSessionState,
	estimateContextTokens,
	mergeStructuredSessionState,
	prepareCompaction,
	renderMinimalCompactionCheckpoint,
	selectKeepRecentTokensForTarget,
	truncateKeptMessages,
} from "../src/core/compaction/index.ts";
import type { SessionEntry, SessionMessageEntry } from "../src/core/session-manager.ts";

const { completeSimpleMock } = vi.hoisted(() => ({ completeSimpleMock: vi.fn() }));

vi.mock("@dst0/p-ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@dst0/p-ai")>();
	return { ...actual, completeSimple: completeSimpleMock };
});

function usage(input = 100, output = 20): Usage {
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "compaction-test",
		usage: usage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function model(): Model<"anthropic-messages"> {
	return {
		id: "compaction-test",
		name: "Compaction Test",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 64_000,
		maxTokens: 8192,
	};
}

function durableState() {
	return mergeStructuredSessionState(createInitialStructuredSessionState("retention-session"), {
		canonicalRequest: {
			current: "Keep a 64k coding session fully functional after minimal context compaction.",
			sourceEntryIds: ["original-user"],
			originalRequests: [
				{
					id: "req-1",
					entryId: "original-user",
					timestamp: "2026-07-24T00:00:00.000Z",
					kind: "request",
					text: "Retain every requirement and keep the post-compaction prompt below 20k tokens.",
					summary: "Retain every requirement and keep the post-compaction prompt below 20k tokens.",
				},
			],
		},
		constraints: {
			add: [
				{
					id: "constraint-budget",
					text: "Post-compaction context must stay below 20k tokens for a normal 64k session.",
					source: "user",
					status: "active",
					enforceability: "test",
				},
				{
					id: "constraint-functionality",
					text: "The agent must remain fully functional and recall exact discarded evidence on demand.",
					source: "user",
					status: "active",
					enforceability: "runtime_check",
				},
			],
		},
		plan: {
			add: [
				...Array.from({ length: 16 }, (_, index) => ({
					id: `done-${index}`,
					text: `Historical completed item ${index}`,
					status: "done" as const,
					evidenceEntryIds: [],
				})),
				{
					id: "open-state",
					text: "Make durable state authoritative after compaction",
					status: "in_progress" as const,
					evidenceEntryIds: [],
				},
				{
					id: "open-tests",
					text: "Run comprehensive retention and context-budget tests",
					status: "not_started" as const,
					evidenceEntryIds: [],
				},
			],
		},
		decisions: {
			add: [
				{
					id: "decision-recall",
					decision: "Keep exact history outside the provider prompt",
					rationale: "session_recall can retrieve persisted messages and tool results only when needed.",
					evidencePointers: [],
					status: "active",
				},
			],
		},
		evidence: {
			add: [
				{
					id: "tool-result:large-log",
					kind: "tool_result",
					summary: "Exact large tool output retained outside prompt context",
					retrieveWhen: "Need exact compacted diagnostics.",
				},
			],
		},
	});
}

function preparation(state = durableState()): CompactionPreparation {
	return {
		firstKeptEntryId: "kept-entry",
		messagesToSummarize: [
			{
				role: "user",
				content: "A later turn which the summarizer may describe incompletely.",
				timestamp: Date.now(),
			},
		],
		turnPrefixMessages: [],
		isSplitTurn: false,
		tokensBefore: 64_000,
		previousSummary: "A stale and incomplete free-form summary.",
		fileOps: { read: new Set(), written: new Set(), edited: new Set() },
		settings: {
			enabled: true,
			triggerReserveTokens: 2000,
			triggerRatio: 1,
			keepRecentMinTokens: 1200,
			keepRecentMaxTokens: 4000,
			summaryMaxTokens: 1000,
			renderedStateMaxTokens: 1000,
			targetContextTokens: 8000,
		},
		keepRecentTokens: 1200,
		tokensToSummarize: 1000,
		recentRawTokens: 1200,
		droppedEntryIds: ["dropped-entry"],
		systemPromptTokens: 5000,
		structuredState: state,
	};
}

function createLongSession(state = durableState()): SessionEntry[] {
	const entries: SessionEntry[] = [];
	let parentId: string | null = null;
	for (let turn = 0; turn < 20; turn++) {
		const userId = `user-${turn}`;
		const user: SessionMessageEntry = {
			type: "message",
			id: userId,
			parentId,
			timestamp: new Date(1_700_000_000_000 + turn * 2).toISOString(),
			message: {
				role: "user",
				content: `Turn ${turn} requirement ${"u".repeat(5000)}`,
				timestamp: 1_700_000_000_000 + turn * 2,
			},
		};
		entries.push(user);
		parentId = userId;
		const assistantId = `assistant-${turn}`;
		entries.push({
			type: "message",
			id: assistantId,
			parentId,
			timestamp: new Date(1_700_000_000_001 + turn * 2).toISOString(),
			message: assistant(`Turn ${turn} result ${"a".repeat(5000)}`),
		});
		parentId = assistantId;
	}
	entries.push({
		type: "custom",
		id: "structured-state",
		parentId,
		timestamp: new Date(1_700_000_000_100).toISOString(),
		customType: "pi.structured-session-state",
		data: state,
	});
	return entries;
}

describe("minimal loss-resistant compaction", () => {
	beforeEach(() => {
		completeSimpleMock.mockReset();
		completeSimpleMock.mockResolvedValue(
			assistant("## Goal\nDo something vague.\n\n## Plan\n- [ ] Continue somehow.\n\n## Decisions\n- Lost detail."),
		);
	});

	it("reserves the target for static prompt and durable checkpoint before raw history", () => {
		expect(
			selectKeepRecentTokensForTarget(
				64_000,
				{
					enabled: true,
					keepRecentMinTokens: 2000,
					keepRecentMaxTokens: 8000,
					renderedStateMaxTokens: 1500,
					targetContextTokens: 12_000,
				},
				6000,
			),
		).toBe(4500);
	});

	it("prepares a 64k-scale session with a bounded recent suffix and attached durable state", () => {
		const result = prepareCompaction(
			createLongSession(),
			{
				enabled: true,
				keepRecentMinTokens: 1200,
				keepRecentMaxTokens: 8000,
				renderedStateMaxTokens: 1000,
				targetContextTokens: 8000,
			},
			"s".repeat(20_000),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.preparation.keepRecentTokens).toBeLessThanOrEqual(2000);
		expect(result.preparation.structuredState?.constraints.map((item) => item.id)).toContain("constraint-budget");
		expect(result.preparation.tokensToSummarize).toBeGreaterThan(20_000);
	});

	it("renders active constraints and open work before old completed history", () => {
		const checkpoint = renderMinimalCompactionCheckpoint(durableState(), 1000);

		expect(checkpoint).toContain("Post-compaction context must stay below 20k");
		expect(checkpoint).toContain("Make durable state authoritative after compaction");
		expect(checkpoint).toContain("Run comprehensive retention and context-budget tests");
		expect(checkpoint).toContain("session_recall");
		expect(checkpoint).not.toContain("Historical completed item 0");
		expect(
			estimateContextTokens([{ role: "compactionSummary", summary: checkpoint, tokensBefore: 64_000, timestamp: 0 }])
				.tokens,
		).toBeLessThan(1200);
	});

	it("keeps durable requirements authoritative when the model summary omits them", async () => {
		const result = await compact(preparation(), model(), "test-key");
		const details = result.details as CompactionDetails;

		expect(result.summary).toContain("Keep a 64k coding session fully functional");
		expect(result.summary).toContain("Post-compaction context must stay below 20k");
		expect(result.summary).toContain("Make durable state authoritative after compaction");
		expect(result.summary).toContain("session_recall");
		expect(details.markdownSummary).toContain("Do something vague");
		expect(details.structuredState?.constraints.map((item) => item.id)).toContain("constraint-budget");
		expect(result.tokensAfter).toBeLessThan(20_000);
	});

	it("preserves goal, constraints, plan, and recall pointers through repeated lossy compactions", async () => {
		let state = durableState();
		let lastSummary = "";
		for (let index = 0; index < 10; index++) {
			const current = preparation(state);
			current.previousSummary = lastSummary || undefined;
			const result = await compact(current, model(), "test-key");
			state = (result.details as CompactionDetails).structuredState!;
			lastSummary = result.summary;
		}

		expect(state.canonicalRequest.current).toContain("Keep a 64k coding session fully functional");
		expect(state.constraints.find((item) => item.id === "constraint-budget")?.status).toBe("active");
		expect(state.plan.find((item) => item.id === "open-state")?.status).toBe("in_progress");
		expect(state.evidence.map((item) => item.id)).toContain("tool-result:large-log");
		expect(lastSummary).toContain("session_recall");
	});

	it("keeps both the original setup and latest outcome when a kept message must shrink", () => {
		const content = [
			"ORIGINAL REQUEST: retain this exact requirement",
			...Array.from({ length: 100 }, (_, index) => `middle ${index} ${"x".repeat(100)}`),
			"LATEST RESULT: retain this exact outcome",
		].join("\n");
		const messages: AgentMessage[] = [{ role: "user", content, timestamp: Date.now() }];

		truncateKeptMessages(messages, { keepRecentTokens: 100, targetContextTokens: 100 });
		const truncated = (messages[0] as { role: "user"; content: string }).content;
		expect(truncated).toContain("ORIGINAL REQUEST");
		expect(truncated).toContain("LATEST RESULT");
		expect(truncated).toContain("session_recall");
	});
});
