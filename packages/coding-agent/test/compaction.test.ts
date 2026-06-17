import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai";
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type CompactionPreparation,
	type CompactionPreparationResult,
	type CompactionSettings,
	calculateContextTokens,
	compact,
	createContextBudgetReport,
	createInitialStructuredSessionState,
	createLiveStructuredSessionState,
	createStructuredSessionState,
	DEFAULT_COMPACTION_SETTINGS,
	estimateContextTokens,
	findCutPoint,
	getLastAssistantUsage,
	mergeStructuredSessionState,
	prepareCompaction,
	renderStructuredSessionCheckpoint,
	selectKeepRecentTokens,
	shouldCompact,
	stubToolResultsForPrompt,
} from "../src/core/compaction/index.ts";
import {
	buildSessionContext,
	type CompactionEntry,
	type ModelChangeEntry,
	migrateSessionEntries,
	parseSessionEntries,
	type SessionEntry,
	type SessionMessageEntry,
	type ThinkingLevelChangeEntry,
} from "../src/core/session-manager.ts";

// ============================================================================
// Test fixtures
// ============================================================================

function loadLargeSessionEntries(): SessionEntry[] {
	const sessionPath = join(__dirname, "fixtures/large-session.jsonl");
	const content = readFileSync(sessionPath, "utf-8");
	const entries = parseSessionEntries(content);
	migrateSessionEntries(entries); // Add id/parentId for v1 fixtures
	return entries.filter((e): e is SessionEntry => e.type !== "session");
}

function createMockUsage(input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createUserMessage(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

function createAssistantMessage(text: string, usage?: Usage): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		usage: usage || createMockUsage(100, 50),
		stopReason: "stop",
		timestamp: Date.now(),
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
	};
}

function createToolResultMessage(
	toolCallId: string,
	toolName: string,
	text: string,
	options?: { isError?: boolean; details?: Record<string, unknown> },
): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text }],
		details: options?.details,
		isError: options?.isError ?? false,
		timestamp: Date.now(),
	};
}

let entryCounter = 0;
let lastId: string | null = null;

function resetEntryCounter() {
	entryCounter = 0;
	lastId = null;
}

// Reset counter before each test to get predictable IDs
beforeEach(() => {
	resetEntryCounter();
});

function createMessageEntry(message: AgentMessage): SessionMessageEntry {
	const id = `test-id-${entryCounter++}`;
	const entry: SessionMessageEntry = {
		type: "message",
		id,
		parentId: lastId,
		timestamp: new Date().toISOString(),
		message,
	};
	lastId = id;
	return entry;
}

function createCompactionEntry(summary: string, firstKeptEntryId: string): CompactionEntry {
	const id = `test-id-${entryCounter++}`;
	const entry: CompactionEntry = {
		type: "compaction",
		id,
		parentId: lastId,
		timestamp: new Date().toISOString(),
		summary,
		firstKeptEntryId,
		tokensBefore: 10000,
	};
	lastId = id;
	return entry;
}

function createModelChangeEntry(provider: string, modelId: string): ModelChangeEntry {
	const id = `test-id-${entryCounter++}`;
	const entry: ModelChangeEntry = {
		type: "model_change",
		id,
		parentId: lastId,
		timestamp: new Date().toISOString(),
		provider,
		modelId,
	};
	lastId = id;
	return entry;
}

function createThinkingLevelEntry(thinkingLevel: string): ThinkingLevelChangeEntry {
	const id = `test-id-${entryCounter++}`;
	const entry: ThinkingLevelChangeEntry = {
		type: "thinking_level_change",
		id,
		parentId: lastId,
		timestamp: new Date().toISOString(),
		thinkingLevel,
	};
	lastId = id;
	return entry;
}

function extractText(messages: AgentMessage[]): string {
	return messages
		.map((message) => {
			switch (message.role) {
				case "user":
					return typeof message.content === "string"
						? message.content
						: message.content
								.filter((block): block is { type: "text"; text: string } => block.type === "text")
								.map((block) => block.text)
								.join(" ");
				case "assistant":
					return message.content
						.filter((block): block is { type: "text"; text: string } => block.type === "text")
						.map((block) => block.text)
						.join(" ");
				case "branchSummary":
				case "compactionSummary":
					return message.summary;
				case "custom":
				case "toolResult":
					return typeof message.content === "string"
						? message.content
						: message.content
								.filter((block): block is { type: "text"; text: string } => block.type === "text")
								.map((block) => block.text)
								.join(" ");
				case "bashExecution":
					return `${message.command}\n${message.output}`;
				default:
					return "";
			}
		})
		.join("\n");
}

function expectPrepared(result: CompactionPreparationResult): CompactionPreparation {
	if (!result.ok) {
		throw new Error(result.message);
	}
	expect(result.ok).toBe(true);
	return result.preparation;
}

// ============================================================================
// Unit tests
// ============================================================================

describe("Token calculation", () => {
	it("should calculate total context tokens from usage", () => {
		const usage = createMockUsage(1000, 500, 200, 100);
		expect(calculateContextTokens(usage)).toBe(1800);
	});

	it("should handle zero values", () => {
		const usage = createMockUsage(0, 0, 0, 0);
		expect(calculateContextTokens(usage)).toBe(0);
	});
});

describe("tool result stubbing", () => {
	it("stubs old oversized tool results while preserving raw source messages", () => {
		const hugeOutput = Array.from({ length: 1200 }, (_, index) => `line ${index}: ${"x".repeat(120)}`).join("\n");
		const oldToolResult = createToolResultMessage("call-old", "bash", hugeOutput, {
			details: { exitCode: 0 },
		});
		const recentToolResult = createToolResultMessage("call-recent", "read", "recent output");
		const messages: AgentMessage[] = [
			createUserMessage("run tests"),
			oldToolResult,
			createAssistantMessage("next"),
			recentToolResult,
		];

		const result = stubToolResultsForPrompt(messages, {
			...DEFAULT_COMPACTION_SETTINGS,
			toolResultClearThresholdTokens: 1000,
			toolResultKeepRecentCount: 1,
		});

		expect(result.stubs).toHaveLength(1);
		expect(result.stubs[0].toolCallId).toBe("call-old");
		expect(result.stubs[0].rawPointer.id).toBe("tool-result:call-old");
		expect(result.tokenSavingsEstimate).toBeGreaterThan(1000);
		expect(result.messages).not.toBe(messages);
		expect(result.messages[1]).not.toBe(oldToolResult);
		expect(result.messages[3]).toBe(recentToolResult);
		expect(oldToolResult.content[0]).toEqual({ type: "text", text: hugeOutput });
		const stubbedText = extractText([result.messages[1]]);
		expect(stubbedText).toContain("[Tool result stubbed");
		expect(stubbedText).toContain("session_recall");
	});

	it("keeps pinned and small failed tool results raw", () => {
		const pinned = createToolResultMessage("call-pinned", "read", `[pin-context]\n${"x".repeat(5000)}`);
		const failed = createToolResultMessage("call-failed", "bash", "stderr: failed quickly", {
			isError: true,
			details: { exitCode: 1 },
		});
		const messages: AgentMessage[] = [pinned, failed, createToolResultMessage("call-recent", "read", "recent")];

		const result = stubToolResultsForPrompt(messages, {
			...DEFAULT_COMPACTION_SETTINGS,
			toolResultClearThresholdTokens: 100,
			toolResultKeepRecentCount: 1,
		});

		expect(result.stubs).toHaveLength(0);
		expect(result.messages).toBe(messages);
	});

	it("stubs older medium tool results when cumulative prompt budget is exceeded", () => {
		const messages: AgentMessage[] = Array.from({ length: 8 }, (_, index) =>
			createToolResultMessage(`call-${index}`, "read", `chunk ${index}\n${"x".repeat(5000)}`),
		);

		const result = stubToolResultsForPrompt(messages, {
			...DEFAULT_COMPACTION_SETTINGS,
			toolResultClearThresholdTokens: 10_000,
			toolResultKeepRecentCount: 0,
			toolResultPromptBudgetTokens: 2_000,
		});

		expect(result.stubs.length).toBeGreaterThan(0);
		expect(result.toolStubTokens).toBeLessThan(result.toolRawTokens);
		expect(result.tokenSavingsEstimate).toBeGreaterThan(0);
	});

	it("uses a tool-result context extract when building prompt stubs", () => {
		const messages: AgentMessage[] = [
			createToolResultMessage("call-large", "bash", `raw noise\n${"x".repeat(10_000)}`, {
				details: {
					contextExtract: {
						summary: "npm run check failed with one TypeScript error",
						relevantLines: ["packages/coding-agent/src/core/agent-session.ts:123 error TS2322"],
					},
				},
			}),
		];

		const result = stubToolResultsForPrompt(messages, {
			...DEFAULT_COMPACTION_SETTINGS,
			toolResultClearThresholdTokens: 100,
			toolResultKeepRecentCount: 0,
		});

		expect(result.stubs).toHaveLength(1);
		const stubbedText = extractText(result.messages);
		expect(stubbedText).toContain("npm run check failed with one TypeScript error");
		expect(stubbedText).toContain("packages/coding-agent/src/core/agent-session.ts:123 error TS2322");
		expect(stubbedText).not.toContain("raw noise");
	});
});

describe("structured session state", () => {
	it("renders a bounded checkpoint from structured state", () => {
		const state = mergeStructuredSessionState(createInitialStructuredSessionState("session-1"), {
			canonicalRequest: {
				current: "Fix compaction loop",
				sourceEntryIds: ["entry-1"],
			},
			plan: {
				add: [
					{
						id: "plan-1",
						text: "Inspect prompt budget",
						status: "done",
						evidenceEntryIds: ["entry-2"],
					},
				],
			},
			progress: {
				next: ["Run high-64 manual smoke"],
			},
			codebase: {
				touchedFiles: [
					{
						path: "packages/coding-agent/src/core/compaction/compaction.ts",
						status: "modified",
						summary: "Split compaction budgets.",
					},
				],
				relevantSymbols: [],
			},
		});

		const checkpoint = renderStructuredSessionCheckpoint(state, 120);

		expect(checkpoint).toContain("<session_checkpoint>");
		expect(checkpoint).toContain("Goal: Fix compaction loop");
		expect(checkpoint).toContain("- [done] Inspect prompt budget");
		expect(checkpoint.length).toBeLessThanOrEqual(120 * 4 + 120);
	});

	it("does not supersede active constraints or mark plan done without evidence", () => {
		const state = mergeStructuredSessionState(createInitialStructuredSessionState("session-1"), {
			constraints: {
				add: [
					{
						id: "constraint-1",
						text: "Do not force push",
						source: "user",
						status: "active",
						enforceability: "manual",
					},
				],
			},
			plan: {
				add: [
					{
						id: "plan-1",
						text: "Verify with tests",
						status: "in_progress",
						evidenceEntryIds: [],
					},
				],
			},
		});

		const next = mergeStructuredSessionState(state, {
			constraints: {
				update: [{ id: "constraint-1", patch: { status: "superseded" } }],
			},
			plan: {
				update: [{ id: "plan-1", status: "done", evidenceEntryIds: [] }],
			},
		});

		expect(next.constraints[0].status).toBe("active");
		expect(next.plan[0].status).toBe("in_progress");
	});

	it("keeps original user requests lossless while rendering a bounded consolidated goal", () => {
		const hugePlan = [
			"Implement the structured context and memory subsystem properly.",
			"",
			"## Detailed Plan",
			...Array.from({ length: 200 }, (_, index) => `- Requirement ${index}: preserve this original request detail.`),
		].join("\n");
		const correction = "Actually, also make project memory automatic and keep raw requests outside prompt context.";
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage(hugePlan)),
			createMessageEntry(createAssistantMessage("working", createMockUsage(1000, 100))),
			createMessageEntry(createUserMessage(correction)),
		];

		const state = createStructuredSessionState({
			sessionId: "session-requests",
			summary: `## Goal\n${hugePlan}\n## Plan & Progress\n- [ ] Continue implementation.`,
			entries,
		});
		const checkpoint = renderStructuredSessionCheckpoint(state, 180);

		expect(state.canonicalRequest.originalRequests).toHaveLength(2);
		expect(state.canonicalRequest.originalRequests[0].text).toBe(hugePlan);
		expect(state.canonicalRequest.current.length).toBeLessThan(520);
		expect(state.canonicalRequest.current).toContain("project memory automatic");
		expect(checkpoint).toContain("Original requests stored: 2");
		expect(checkpoint).not.toContain("Requirement 199");
		expect(checkpoint.length).toBeLessThan(180 * 4 + 120);
	});

	it("falls back to preserved user intent when compaction emits a placeholder goal", () => {
		const request =
			"Read the repository context, inspect package.json and packages layout, then identify the repo and verification command.";
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage(request)),
			createMessageEntry(
				createAssistantMessage("Completed the repository context probe.", createMockUsage(1000, 100)),
			),
		];

		const state = createStructuredSessionState({
			sessionId: "session-placeholder-goal",
			summary: [
				"## Goal",
				"Awaiting initial user prompt to define the goal.",
				"## Progress",
				"### Done",
				"- Completed the repository context probe.",
			].join("\n"),
			entries,
		});

		expect(state.canonicalRequest.current).toContain("Read the repository context");
		expect(state.canonicalRequest.current).not.toContain("Awaiting initial user prompt");
		expect(state.canonicalRequest.originalRequests[0].text).toBe(request);
	});

	it("builds live state from current conversation plan and next steps before compaction", () => {
		const request = "Review and improve the durable session state command.";
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage(request)),
			createMessageEntry(
				createAssistantMessage(
					[
						"I found the issue.",
						"",
						"Plan:",
						"1. Reproduce /state manually.",
						"2. Patch live structured state.",
						"3. Verify with tests.",
						"",
						"Next Steps:",
						"1. Run targeted regression tests.",
						"2. Re-run the tmux smoke.",
					].join("\n"),
					createMockUsage(1000, 100),
				),
			),
		];

		const state = createLiveStructuredSessionState({
			sessionId: "session-live",
			entries,
		});
		const checkpoint = renderStructuredSessionCheckpoint(state, 220);

		expect(state.canonicalRequest.current).toBe(request);
		expect(state.plan.map((item) => item.text)).toEqual([
			"Reproduce /state manually.",
			"Patch live structured state.",
			"Verify with tests.",
		]);
		expect(state.progress.next).toEqual(["Run targeted regression tests.", "Re-run the tmux smoke."]);
		expect(checkpoint).toContain("Run targeted regression tests.");
	});

	it("preserves live progress when a later summary omits progress sections", () => {
		const previous = mergeStructuredSessionState(createInitialStructuredSessionState("session-progress"), {
			progress: {
				current: ["Patch live structured state."],
				next: ["Run targeted regression tests."],
			},
		});

		const state = createStructuredSessionState({
			sessionId: "session-progress",
			previous,
			summary:
				"## Goal\nImprove durable session state.\n\n## Key Decisions\n- Keep structured state outside prompt context.",
			entries: [createMessageEntry(createUserMessage("Improve durable session state."))],
		});

		expect(state.progress.current).toEqual(["Patch live structured state."]);
		expect(state.progress.next).toEqual(["Run targeted regression tests."]);
	});
});

describe("getLastAssistantUsage", () => {
	it("should find the last non-aborted assistant message usage", () => {
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("Hello")),
			createMessageEntry(createAssistantMessage("Hi", createMockUsage(100, 50))),
			createMessageEntry(createUserMessage("How are you?")),
			createMessageEntry(createAssistantMessage("Good", createMockUsage(200, 100))),
		];

		const usage = getLastAssistantUsage(entries);
		expect(usage).not.toBeNull();
		expect(usage!.input).toBe(200);
	});

	it("should skip aborted messages", () => {
		const abortedMsg: AssistantMessage = {
			...createAssistantMessage("Aborted", createMockUsage(300, 150)),
			stopReason: "aborted",
		};

		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("Hello")),
			createMessageEntry(createAssistantMessage("Hi", createMockUsage(100, 50))),
			createMessageEntry(createUserMessage("How are you?")),
			createMessageEntry(abortedMsg),
		];

		const usage = getLastAssistantUsage(entries);
		expect(usage).not.toBeNull();
		expect(usage!.input).toBe(100);
	});

	it("should return undefined if no assistant messages", () => {
		const entries: SessionEntry[] = [createMessageEntry(createUserMessage("Hello"))];
		expect(getLastAssistantUsage(entries)).toBeUndefined();
	});
});

describe("estimateContextTokens", () => {
	it("should ignore assistant messages generated before the latest compaction summary", () => {
		// An assistant message generated before compaction with old usage (60,000 tokens)
		const assistantMsgBeforeCompaction: AgentMessage = {
			role: "assistant" as const,
			api: "openai-completions",
			provider: "openai",
			model: "gpt-4o",
			stopReason: "stop",
			content: [{ type: "text" as const, text: "Some output" }],
			usage: {
				input: 40000,
				output: 20000,
				totalTokens: 60000,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: 500,
		};

		const compactionSummaryMsg: AgentMessage = {
			role: "compactionSummary" as const,
			summary: "Goal preserved. Plan preserved.",
			tokensBefore: 60000,
			timestamp: 1000,
		};

		// An assistant message generated after compaction with new usage (2,000 tokens)
		const assistantMsgAfterCompaction: AgentMessage = {
			role: "assistant" as const,
			api: "openai-completions",
			provider: "openai",
			model: "gpt-4o",
			stopReason: "stop",
			content: [{ type: "text" as const, text: "New output" }],
			usage: {
				input: 1500,
				output: 500,
				totalTokens: 2000,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: 1500,
		};

		const messages1 = [compactionSummaryMsg, assistantMsgBeforeCompaction];

		// Case 1: Only pre-compaction assistant message exists after compaction.
		// Since assistantMsgBeforeCompaction has timestamp 500 <= 1000 (compaction timestamp),
		// its usage should be IGNORED, and we should fall back to heuristic estimation.
		const estimate1 = estimateContextTokens(messages1);
		// Compaction summary length is ~31 chars, assistantMsgBeforeCompaction is ~11 chars.
		// Total chars = 42. Chars / 4 ~ 11 tokens.
		// Crucially, it must NOT use the 60,000 tokens from the old usage!
		expect(estimate1.tokens).toBeLessThan(100);

		// Case 2: Post-compaction assistant message also exists.
		// Since assistantMsgAfterCompaction has timestamp 1500 > 1000, its usage (2,000 tokens) should be used!
		const messages2 = [compactionSummaryMsg, assistantMsgBeforeCompaction, assistantMsgAfterCompaction];
		const estimate2 = estimateContextTokens(messages2);
		expect(estimate2.tokens).toBe(2000);
	});
});

describe("shouldCompact", () => {
	it("should return true when context exceeds threshold", () => {
		const settings: CompactionSettings = {
			enabled: true,
			reserveTokens: 10000,
			keepRecentTokens: 20000,
		};

		expect(shouldCompact(95000, 100000, settings)).toBe(true);
		expect(shouldCompact(89000, 100000, settings)).toBe(false);
	});

	it("should apply ratio trigger and budget report for canonical settings", () => {
		const settings: CompactionSettings = {
			enabled: true,
			triggerReserveTokens: 12000,
			triggerRatio: 0.75,
			targetContextTokens: 12000,
		};

		const report = createContextBudgetReport(49000, 64000, settings);

		expect(report.triggerThreshold).toBe(48000);
		expect(report.remainingTokens).toBe(15000);
		expect(report.shouldCompact).toBe(true);
		expect(shouldCompact(47000, 64000, settings)).toBe(false);
	});

	it("should select an adaptive recent suffix budget", () => {
		const settings: CompactionSettings = {
			enabled: true,
			keepRecentMinTokens: 2000,
			keepRecentMaxTokens: 8000,
			targetContextTokens: 12000,
		};

		expect(selectKeepRecentTokens(12000, settings)).toBe(8000);
		expect(selectKeepRecentTokens(120000, settings)).toBe(2000);
		expect(selectKeepRecentTokens(72000, settings)).toBe(5000);
	});

	it("should return false when disabled", () => {
		const settings: CompactionSettings = {
			enabled: false,
			reserveTokens: 10000,
			keepRecentTokens: 20000,
		};

		expect(shouldCompact(95000, 100000, settings)).toBe(false);
	});
});

describe("findCutPoint", () => {
	it("should find cut point based on actual token differences", () => {
		// Create entries with cumulative token counts
		const entries: SessionEntry[] = [];
		for (let i = 0; i < 10; i++) {
			entries.push(createMessageEntry(createUserMessage(`User ${i}`)));
			entries.push(
				createMessageEntry(createAssistantMessage(`Assistant ${i}`, createMockUsage(0, 100, (i + 1) * 1000, 0))),
			);
		}

		// 20 entries, last assistant has 10000 tokens
		// keepRecentTokens = 2500: keep entries where diff < 2500
		const result = findCutPoint(entries, 0, entries.length, 2500);

		// Should cut at a valid cut point (user or assistant message)
		expect(entries[result.firstKeptEntryIndex].type).toBe("message");
		const role = (entries[result.firstKeptEntryIndex] as SessionMessageEntry).message.role;
		expect(role === "user" || role === "assistant").toBe(true);
	});

	it("should return startIndex if no valid cut points in range", () => {
		const entries: SessionEntry[] = [createMessageEntry(createAssistantMessage("a"))];
		const result = findCutPoint(entries, 0, entries.length, 1000);
		expect(result.firstKeptEntryIndex).toBe(0);
	});

	it("should keep everything if all messages fit within budget", () => {
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("1")),
			createMessageEntry(createAssistantMessage("a", createMockUsage(0, 50, 500, 0))),
			createMessageEntry(createUserMessage("2")),
			createMessageEntry(createAssistantMessage("b", createMockUsage(0, 50, 1000, 0))),
		];

		const result = findCutPoint(entries, 0, entries.length, 50000);
		expect(result.firstKeptEntryIndex).toBe(0);
	});

	it("should indicate split turn when cutting at assistant message", () => {
		// Create a scenario where we cut at an assistant message mid-turn
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("Turn 1")),
			createMessageEntry(createAssistantMessage("A1", createMockUsage(0, 100, 1000, 0))),
			createMessageEntry(createUserMessage("Turn 2")), // index 2
			createMessageEntry(createAssistantMessage("A2-1", createMockUsage(0, 100, 5000, 0))), // index 3
			createMessageEntry(createAssistantMessage("A2-2", createMockUsage(0, 100, 8000, 0))), // index 4
			createMessageEntry(createAssistantMessage("A2-3", createMockUsage(0, 100, 10000, 0))), // index 5
		];

		// With keepRecentTokens = 3000, should cut somewhere in Turn 2
		const result = findCutPoint(entries, 0, entries.length, 3000);

		// If cut at assistant message (not user), should indicate split turn
		const cutEntry = entries[result.firstKeptEntryIndex] as SessionMessageEntry;
		if (cutEntry.message.role === "assistant") {
			expect(result.isSplitTurn).toBe(true);
			expect(result.turnStartIndex).toBe(2); // Turn 2 starts at index 2
		}
	});
});

describe("buildSessionContext", () => {
	it("should load all messages when no compaction", () => {
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("1")),
			createMessageEntry(createAssistantMessage("a")),
			createMessageEntry(createUserMessage("2")),
			createMessageEntry(createAssistantMessage("b")),
		];

		const loaded = buildSessionContext(entries);
		expect(loaded.messages.length).toBe(4);
		expect(loaded.thinkingLevel).toBe("off");
		expect(loaded.model).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-5" });
	});

	it("should handle single compaction", () => {
		// IDs: u1=test-id-0, a1=test-id-1, u2=test-id-2, a2=test-id-3, compaction=test-id-4, u3=test-id-5, a3=test-id-6
		const u1 = createMessageEntry(createUserMessage("1"));
		const a1 = createMessageEntry(createAssistantMessage("a"));
		const u2 = createMessageEntry(createUserMessage("2"));
		const a2 = createMessageEntry(createAssistantMessage("b"));
		const compaction = createCompactionEntry("Summary of 1,a,2,b", u2.id); // keep from u2 onwards
		const u3 = createMessageEntry(createUserMessage("3"));
		const a3 = createMessageEntry(createAssistantMessage("c"));

		const entries: SessionEntry[] = [u1, a1, u2, a2, compaction, u3, a3];

		const loaded = buildSessionContext(entries);
		// summary + kept (u2, a2) + after (u3, a3) = 5
		expect(loaded.messages.length).toBe(5);
		expect(loaded.messages[0].role).toBe("compactionSummary");
		expect((loaded.messages[0] as any).summary).toContain("Summary of 1,a,2,b");
	});

	it("should handle multiple compactions (only latest matters)", () => {
		// First batch
		const u1 = createMessageEntry(createUserMessage("1"));
		const a1 = createMessageEntry(createAssistantMessage("a"));
		const compact1 = createCompactionEntry("First summary", u1.id);
		// Second batch
		const u2 = createMessageEntry(createUserMessage("2"));
		const b = createMessageEntry(createAssistantMessage("b"));
		const u3 = createMessageEntry(createUserMessage("3"));
		const c = createMessageEntry(createAssistantMessage("c"));
		const compact2 = createCompactionEntry("Second summary", u3.id); // keep from u3 onwards
		// After second compaction
		const u4 = createMessageEntry(createUserMessage("4"));
		const d = createMessageEntry(createAssistantMessage("d"));

		const entries: SessionEntry[] = [u1, a1, compact1, u2, b, u3, c, compact2, u4, d];

		const loaded = buildSessionContext(entries);
		// summary + kept from u3 (u3, c) + after (u4, d) = 5
		expect(loaded.messages.length).toBe(5);
		expect((loaded.messages[0] as any).summary).toContain("Second summary");
	});

	it("should keep all messages when firstKeptEntryId is first entry", () => {
		const u1 = createMessageEntry(createUserMessage("1"));
		const a1 = createMessageEntry(createAssistantMessage("a"));
		const compact1 = createCompactionEntry("First summary", u1.id); // keep from first entry
		const u2 = createMessageEntry(createUserMessage("2"));
		const b = createMessageEntry(createAssistantMessage("b"));

		const entries: SessionEntry[] = [u1, a1, compact1, u2, b];

		const loaded = buildSessionContext(entries);
		// summary + all messages (u1, a1, u2, b) = 5
		expect(loaded.messages.length).toBe(5);
	});

	it("should track model and thinking level changes", () => {
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("1")),
			createModelChangeEntry("openai", "gpt-4"),
			createMessageEntry(createAssistantMessage("a")),
			createThinkingLevelEntry("high"),
		];

		const loaded = buildSessionContext(entries);
		// model_change is later overwritten by assistant message's model info
		expect(loaded.model).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-5" });
		expect(loaded.thinkingLevel).toBe("high");
	});
});

describe("prepareCompaction with previous compaction", () => {
	it("should preserve kept messages across repeated compactions when they still fit", () => {
		const u1 = createMessageEntry(createUserMessage("user msg 1 (summarized by compaction1)"));
		const a1 = createMessageEntry(createAssistantMessage("assistant msg 1"));
		const u2 = createMessageEntry(createUserMessage("user msg 2 - kept by compaction1"));
		const a2 = createMessageEntry(createAssistantMessage("assistant msg 2"));
		const u3 = createMessageEntry(createUserMessage("user msg 3 - kept by compaction1"));
		const a3 = createMessageEntry(createAssistantMessage("assistant msg 3", createMockUsage(5000, 1000)));
		const compaction1 = createCompactionEntry("First summary", u2.id);
		const u4 = createMessageEntry(createUserMessage("user msg 4 (new after compaction1)"));
		const a4 = createMessageEntry(createAssistantMessage("assistant msg 4", createMockUsage(8000, 2000)));
		a4.message.timestamp = new Date(compaction1.timestamp).getTime() + 1000;

		const pathEntries = [u1, a1, u2, a2, u3, a3, compaction1, u4, a4];
		const contextBefore = buildSessionContext(pathEntries);
		const preparation = expectPrepared(
			prepareCompaction(pathEntries, { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 4000 }),
		);

		expect(preparation.firstKeptEntryId).toBe(u2.id);
		expect(preparation.previousSummary).toBe("First summary");
		expect(extractText(preparation.messagesToSummarize)).not.toContain("First summary");
		expect(preparation.tokensBefore).toBe(estimateContextTokens(contextBefore.messages).tokens);

		const compaction2: CompactionEntry = {
			type: "compaction",
			id: "compaction2-id",
			parentId: a4.id,
			timestamp: new Date().toISOString(),
			summary: "Second summary",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
		};
		const contextAfter = buildSessionContext([...pathEntries, compaction2]);
		const contextAfterText = extractText(contextAfter.messages);

		expect(contextAfterText).toContain("user msg 2 - kept by compaction1");
		expect(contextAfterText).toContain("user msg 3 - kept by compaction1");
	});

	it("should re-summarize previously kept messages when the recent window moves past them", () => {
		const u1 = createMessageEntry(createUserMessage("user msg 1 (summarized by compaction1)".repeat(4)));
		const a1 = createMessageEntry(createAssistantMessage("assistant msg 1".repeat(4)));
		const u2 = createMessageEntry(createUserMessage("user msg 2 - kept by compaction1 ".repeat(12)));
		const a2 = createMessageEntry(createAssistantMessage("assistant msg 2 ".repeat(12)));
		const u3 = createMessageEntry(createUserMessage("user msg 3 - kept by compaction1 ".repeat(12)));
		const a3 = createMessageEntry(createAssistantMessage("assistant msg 3 ".repeat(12), createMockUsage(5000, 1000)));
		const compaction1 = createCompactionEntry("First summary", u2.id);
		const u4 = createMessageEntry(createUserMessage("user msg 4 (new after compaction1) ".repeat(12)));
		const a4 = createMessageEntry(createAssistantMessage("assistant msg 4 ".repeat(12), createMockUsage(8000, 2000)));

		const settings: CompactionSettings = {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 100,
		};
		const preparation = expectPrepared(prepareCompaction([u1, a1, u2, a2, u3, a3, compaction1, u4, a4], settings));

		const summarizedText = extractText(preparation.messagesToSummarize);
		expect(summarizedText).toContain("user msg 2 - kept by compaction1");
		expect(summarizedText).toContain("user msg 3 - kept by compaction1");
		expect(summarizedText).not.toContain("First summary");
		expect(preparation.previousSummary).toBe("First summary");
	});
});

describe("prepareCompaction failure reasons", () => {
	it("reports when the latest entry is already a compaction", () => {
		const u1 = createMessageEntry(createUserMessage("user msg"));
		const compaction = createCompactionEntry("Summary", u1.id);

		const result = prepareCompaction([u1, compaction], DEFAULT_COMPACTION_SETTINGS);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("already_compacted");
			expect(result.message).toContain("latest session entry is a compaction boundary");
		}
	});

	it("reports when the branch has no entries", () => {
		const result = prepareCompaction([], DEFAULT_COMPACTION_SETTINGS);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("empty_session");
			expect(result.message).toContain("session branch has no entries");
		}
	});

	it("reports when no user request exists in the branch", () => {
		const entries: SessionEntry[] = [
			createMessageEntry(createAssistantMessage("assistant-only history ".repeat(200), createMockUsage(5000, 1000))),
			createMessageEntry(createToolResultMessage("tool-1", "bash", "tool-only output ".repeat(200))),
		];

		const result = prepareCompaction(entries, {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 10,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("no_user_request");
			expect(result.message).toContain("no user request");
		}
	});

	it("reports when too little history would be summarized", () => {
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("short user message")),
			createMessageEntry(createAssistantMessage("short assistant message")),
		];

		const result = prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("too_little_history");
			expect(result.tokensToSummarize).toBeLessThan(500);
			expect(result.message).toContain("only");
		}
	});

	it("reports when the selected kept entry has no id", () => {
		const entryWithoutId = {
			type: "message",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: createUserMessage("message without id"),
		} as unknown as SessionEntry;

		const result = prepareCompaction([entryWithoutId], {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 1,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("missing_kept_entry_id");
			expect(result.message).toContain("session likely needs migration");
		}
	});
});

// ============================================================================
// Integration tests with real session data
// ============================================================================

describe("Large session fixture", () => {
	it("should parse the large session", () => {
		const entries = loadLargeSessionEntries();
		expect(entries.length).toBeGreaterThan(100);

		const messageCount = entries.filter((e) => e.type === "message").length;
		expect(messageCount).toBeGreaterThan(100);
	});

	it("should find cut point in large session", () => {
		const entries = loadLargeSessionEntries();
		const result = findCutPoint(entries, 0, entries.length, DEFAULT_COMPACTION_SETTINGS.keepRecentMaxTokens!);

		// Cut point should be at a message entry (user or assistant)
		expect(entries[result.firstKeptEntryIndex].type).toBe("message");
		const role = (entries[result.firstKeptEntryIndex] as SessionMessageEntry).message.role;
		expect(role === "user" || role === "assistant").toBe(true);
	});

	it("should load session correctly", () => {
		const entries = loadLargeSessionEntries();
		const loaded = buildSessionContext(entries);

		expect(loaded.messages.length).toBeGreaterThan(100);
		expect(loaded.model).not.toBeNull();
	});
});

// ============================================================================
// LLM integration tests (skipped without API key)
// ============================================================================

describe.skipIf(!process.env.ANTHROPIC_OAUTH_TOKEN)("LLM summarization", () => {
	it("should generate a compaction result for the large session", async () => {
		const entries = loadLargeSessionEntries();
		const model = getModel("anthropic", "claude-sonnet-4-5")!;

		const preparation = expectPrepared(prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS));

		const compactionResult = await compact(preparation, model, process.env.ANTHROPIC_OAUTH_TOKEN!);

		expect(compactionResult.summary.length).toBeGreaterThan(100);
		expect(compactionResult.firstKeptEntryId).toBeTruthy();
		expect(compactionResult.tokensBefore).toBeGreaterThan(0);

		console.log("Summary length:", compactionResult.summary.length);
		console.log("First kept entry ID:", compactionResult.firstKeptEntryId);
		console.log("Tokens before:", compactionResult.tokensBefore);
		console.log("\n--- SUMMARY ---\n");
		console.log(compactionResult.summary);
	}, 60000);

	it("should produce valid session after compaction", async () => {
		const entries = loadLargeSessionEntries();
		const loaded = buildSessionContext(entries);
		const model = getModel("anthropic", "claude-sonnet-4-5")!;

		const preparation = expectPrepared(prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS));

		const compactionResult = await compact(preparation, model, process.env.ANTHROPIC_OAUTH_TOKEN!);

		// Simulate appending compaction to entries by creating a proper entry
		const lastEntry = entries[entries.length - 1];
		const parentId = lastEntry.id;
		const compactionEntry: CompactionEntry = {
			type: "compaction",
			id: "compaction-test-id",
			parentId,
			timestamp: new Date().toISOString(),
			...compactionResult,
		};
		const newEntries = [...entries, compactionEntry];
		const reloaded = buildSessionContext(newEntries);

		// Should have summary + kept messages
		expect(reloaded.messages.length).toBeLessThan(loaded.messages.length);
		expect(reloaded.messages[0].role).toBe("compactionSummary");
		expect((reloaded.messages[0] as any).summary).toContain(compactionResult.summary);

		console.log("Original messages:", loaded.messages.length);
		console.log("After compaction:", reloaded.messages.length);
	}, 60000);
});
