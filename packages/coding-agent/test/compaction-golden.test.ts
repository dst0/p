import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import {
	createInitialStructuredSessionState,
	createStructuredSessionState,
	DEFAULT_COMPACTION_SETTINGS,
	estimateContextTokens,
	mergeStructuredSessionState,
	renderStructuredSessionCheckpoint,
	stubToolResultsForPrompt,
} from "../src/core/compaction/index.ts";
import { migrateSessionEntries, parseSessionEntries, type SessionEntry } from "../src/core/session-manager.ts";

const FIXTURE_DIR = join(__dirname, "fixtures/compaction-golden");

const GOLDEN_SUMMARY = `## Goal
Build the structured context subsystem.

## Plan & Progress
- [x] Preserve canonical request across compaction.
- [ ] Add golden regression fixtures.

## Progress
### Done
- P0 structured state exists.
### In Progress
- Hardening compaction regressions.
### Blocked
- TypeScript failure in compaction.ts must be fixed before final.

## Key Decisions
- Structured JSON checkpoint: avoid markdown-only drift.

## Next Steps
1. Run targeted regression tests.
2. Run npm run check.`;

function loadFixture(name: string): SessionEntry[] {
	const content = readFileSync(join(FIXTURE_DIR, name), "utf8");
	const entries = parseSessionEntries(content);
	migrateSessionEntries(entries);
	return entries.filter((entry): entry is SessionEntry => entry.type !== "session");
}

function messagesFrom(entries: SessionEntry[]): AgentMessage[] {
	return entries.flatMap((entry) => (entry.type === "message" ? [entry.message] : []));
}

function expandHugeToolOutput(messages: AgentMessage[]): AgentMessage[] {
	return messages.map((message) => {
		if (message.role !== "toolResult") return message;
		return {
			...message,
			content: message.content.map((block) =>
				block.type === "text" && block.text === "[HUGE_OUTPUT]"
					? {
							...block,
							text: Array.from({ length: 1600 }, (_, index) => `line ${index}: ${"x".repeat(120)}`).join("\n"),
						}
					: block,
			),
		};
	});
}

describe("compaction golden fixtures", () => {
	it("preserves canonical request, blockers, decisions, touched files, and evidence pointers", () => {
		const entries = [
			...loadFixture("long-chat.jsonl"),
			...loadFixture("split-tool-turns.jsonl"),
			...loadFixture("coding-failures.jsonl"),
		];

		const state = createStructuredSessionState({
			sessionId: "golden",
			summary: GOLDEN_SUMMARY,
			entries,
			readFiles: ["packages/coding-agent/src/core/agent-session.ts"],
			modifiedFiles: ["packages/coding-agent/src/core/compaction/structured-state.ts"],
			audit: {
				beforeTokens: 64_000,
				afterTokens: 8_000,
				savedTokens: 56_000,
				summaryTokens: 1_200,
				renderedStateTokens: 900,
				recentRawTokens: 2_000,
				toolRawTokens: 12_000,
				toolStubTokens: 500,
				droppedEntries: [],
				stubbedToolResults: ["tool-result:call-read"],
				risks: ["TypeScript failure in compaction.ts must be fixed before final."],
			},
		});
		const checkpoint = renderStructuredSessionCheckpoint(state, 300);

		expect(state.canonicalRequest.current).toContain("structured context subsystem");
		expect(state.progress.blocked).toContain("TypeScript failure in compaction.ts must be fixed before final.");
		expect(state.decisions.map((decision) => decision.decision)).toContain("Structured JSON checkpoint");
		expect(state.codebase.touchedFiles.map((file) => file.path)).toContain(
			"packages/coding-agent/src/core/compaction/structured-state.ts",
		);
		expect(state.evidence.map((pointer) => pointer.id)).toContain("tool-result:call-read");
		expect(state.evidence.map((pointer) => pointer.kind)).toContain("bash");
		expect(
			estimateContextTokens([
				{ role: "compactionSummary", summary: checkpoint, tokensBefore: 64_000, timestamp: Date.now() },
			]).tokens,
		).toBeLessThan(1_000);
	});

	it("lets the latest explicit user correction win over stale summary goal text", () => {
		const entries = loadFixture("changed-goal.jsonl");
		const state = createStructuredSessionState({
			sessionId: "golden",
			summary: "## Goal\nImprove markdown compaction prompts.",
			entries,
		});

		expect(state.canonicalRequest.current).toContain("structured context and memory subsystem");
	});

	it("stubs huge tool results while preserving retrieval evidence", () => {
		const messages = expandHugeToolOutput(messagesFrom(loadFixture("huge-tool-results.jsonl")));
		const result = stubToolResultsForPrompt(messages, {
			...DEFAULT_COMPACTION_SETTINGS,
			toolResultClearThresholdTokens: 200,
			toolResultKeepRecentCount: 0,
		});

		expect(result.stubs).toHaveLength(1);
		expect(result.stubs[0].rawPointer.id).toBe("tool-result:call-huge");
		expect(result.tokenSavingsEstimate).toBeGreaterThan(10_000);
		expect(JSON.stringify(result.messages)).toContain("session_recall");
	});

	it("keeps active constraints across contradictory and repeated compactions", () => {
		const entries = [
			...loadFixture("contradictory-constraints.jsonl"),
			...loadFixture("repeated-10x-compaction.jsonl"),
		];
		let state = mergeStructuredSessionState(createInitialStructuredSessionState("golden"), {
			constraints: {
				add: [
					{
						id: "constraint-orc0",
						text: "Use only mini-pc-orc-0/high-64. Do not use orc1 or orc2.",
						source: "user",
						status: "active",
						enforceability: "runtime_check",
					},
				],
			},
		});

		for (let index = 0; index < 10; index++) {
			state = createStructuredSessionState({
				sessionId: "golden",
				previous: state,
				summary: GOLDEN_SUMMARY,
				entries,
				timestamp: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
			});
			state = mergeStructuredSessionState(state, {
				constraints: {
					update: [{ id: "constraint-orc0", patch: { status: "superseded" } }],
				},
			});
		}

		expect(state.audit.compactionCount).toBe(10);
		expect(state.canonicalRequest.current).toContain("structured context subsystem");
		expect(state.constraints.find((constraint) => constraint.id === "constraint-orc0")?.status).toBe("active");
		expect(renderStructuredSessionCheckpoint(state, 300)).toContain("Use only mini-pc-orc-0/high-64");
	});
});
