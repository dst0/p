import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInitialStructuredSessionState } from "../src/core/compaction/index.ts";
import type { ContextUsage } from "../src/core/extensions/types.ts";
import {
	createProjectMemoryContext,
	diffProjectMemorySnapshot,
	forgetProjectMemory,
	initProjectMemory,
	PROJECT_MEMORY_STATE_FILE,
	pinProjectMemory,
	searchProjectMemory,
	updateProjectMemorySnapshot,
} from "../src/core/project-memory.ts";

const tempDirs: string[] = [];

function createTempProject(): string {
	const cwd = mkdtempSync(join(tmpdir(), "pi-project-memory-"));
	tempDirs.push(cwd);
	return cwd;
}

function createContextUsage(): ContextUsage {
	return {
		tokens: 12_000,
		contextWindow: 64_000,
		percent: 18.75,
		staticTokens: 1_000,
		triggerThreshold: 48_000,
		triggerReserveTokens: 12_000,
		triggerRatio: 0.75,
		targetContextTokens: 12_000,
		remainingTokens: 52_000,
		shouldCompact: false,
		toolRawTokens: 10_000,
		toolStubTokens: 500,
		toolStubSavings: 9_500,
		stubbedToolResults: ["tool-result:old-read"],
	};
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("project memory", () => {
	it("initializes durable memory folders and files", () => {
		const cwd = createTempProject();

		const result = initProjectMemory(cwd);

		expect(result.created).toContain(".pdev/memory");
		expect(existsSync(join(cwd, ".pdev/memory/active-context.md"))).toBe(true);
		expect(existsSync(join(cwd, ".pdev/state"))).toBe(true);
	});

	it("automatically writes a snapshot and managed memory blocks", () => {
		const cwd = createTempProject();
		const state = createInitialStructuredSessionState("session-1");
		state.canonicalRequest.current = "Fix compaction loops";
		state.progress.current.push("Validate high-64 manual path");
		state.progress.next.push("Run npm run check");
		state.decisions.push({
			id: "decision-1",
			decision: "Use structured state",
			rationale: "Markdown summaries drift across repeated compactions.",
			evidencePointers: [],
			status: "active",
		});

		const result = updateProjectMemorySnapshot({
			cwd,
			sessionId: "session-1",
			checkpoint: "Goal: Fix compaction loops\nNext action: Run npm run check",
			state,
			contextUsage: createContextUsage(),
		});

		expect(result.created).toBe(true);
		expect(result.managedFiles).toContain(".pdev/memory/active-context.md");
		expect(existsSync(join(cwd, PROJECT_MEMORY_STATE_FILE))).toBe(true);
		expect(readFileSync(join(cwd, ".pdev/memory/active-context.md"), "utf8")).toContain("Fix compaction loops");
		expect(readFileSync(join(cwd, ".pdev/memory/decisions.md"), "utf8")).toContain("Use structured state");
	});

	it("searches scoped memory and renders bounded context automatically", () => {
		const cwd = createTempProject();
		const state = createInitialStructuredSessionState("session-1");
		state.canonicalRequest.current = "Fix compaction loops";
		updateProjectMemorySnapshot({
			cwd,
			sessionId: "session-1",
			checkpoint: "Goal: Fix compaction loops",
			state,
			contextUsage: createContextUsage(),
		});

		const search = searchProjectMemory(cwd, "compaction");
		const context = createProjectMemoryContext(cwd, "compaction", 100);

		expect(search.hits.length).toBeGreaterThan(0);
		expect(context?.content).toContain("<project_memory>");
		expect(context?.content).toContain("Fix compaction loops");
	});

	it("diffs snapshots and supports pin/forget controls", () => {
		const cwd = createTempProject();
		const state = createInitialStructuredSessionState("session-1");
		state.canonicalRequest.current = "Fix compaction loops";
		updateProjectMemorySnapshot({
			cwd,
			sessionId: "session-1",
			checkpoint: "Goal: Fix compaction loops",
			state,
			contextUsage: createContextUsage(),
		});

		const same = diffProjectMemorySnapshot({
			cwd,
			sessionId: "session-1",
			checkpoint: "Goal: Fix compaction loops",
			state,
			contextUsage: createContextUsage(),
		});
		const pin = pinProjectMemory(cwd, "Never lose active constraints");
		const forget = forgetProjectMemory(cwd, pin.id);

		expect(same.status).toBe("same");
		expect(pin.id).toMatch(/^pin-/);
		expect(forget.removed).toBeGreaterThan(0);
	});
});
