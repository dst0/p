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
		triggerThreshold: 52_000,
		triggerReserveTokens: 2_000,
		triggerRatio: 1.0,
		targetContextTokens: 12_000,
		remainingTokens: 52_000,
		shouldCompact: false,
		toolRawTokens: 10_000,
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
		state.plan.push(
			{
				id: "plan-validate",
				text: "Validate high-64 manual path",
				status: "in_progress",
				evidenceEntryIds: [],
			},
			{
				id: "plan-check",
				text: "Run npm run check",
				status: "not_started",
				evidenceEntryIds: [],
			},
		);
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
			checkpoint: "Goal: Fix compaction loops\nPlan:\n⏳ Validate high-64 manual path\n• Run npm run check",
			state,
			contextUsage: createContextUsage(),
		});

		expect(result.created).toBe(true);
		expect(result.managedFiles).toContain(".pdev/memory/active-context.md");
		expect(existsSync(join(cwd, PROJECT_MEMORY_STATE_FILE))).toBe(true);
		expect(readFileSync(join(cwd, ".pdev/memory/active-context.md"), "utf8")).toContain("Fix compaction loops");
		const progress = readFileSync(join(cwd, ".pdev/memory/progress.md"), "utf8");
		expect(progress).toContain("# Plan");
		expect(progress).toContain("⏳ Validate high-64 manual path");
		expect(progress).toContain("• Run npm run check");
		expect(progress).not.toContain("## Progress");
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

	it("keeps auto-managed active context bounded when checkpoint and goal are huge", () => {
		const cwd = createTempProject();
		const state = createInitialStructuredSessionState("session-1");
		state.canonicalRequest.current = `Fix compaction loops ${"and preserve every original request ".repeat(300)}`;
		const checkpoint = `<session_checkpoint>\nGoal: ${state.canonicalRequest.current}\n${"detail\n".repeat(2000)}</session_checkpoint>`;

		updateProjectMemorySnapshot({
			cwd,
			sessionId: "session-1",
			checkpoint,
			state,
			contextUsage: createContextUsage(),
		});

		const activeContext = readFileSync(join(cwd, ".pdev/memory/active-context.md"), "utf8");
		expect(activeContext.length).toBeLessThan(5_000);
		expect(activeContext).toContain("[truncated]");
		expect(activeContext).not.toContain("detail\ndetail\ndetail\ndetail\ndetail\ndetail");
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

	it("capLine clamps goal to at most 360 chars when there are no word breaks", () => {
		const cwd = createTempProject();
		const state = createInitialStructuredSessionState("session-1");
		// A goal with no spaces that exceeds the 360-char cap.
		state.canonicalRequest.current = "A".repeat(500);

		updateProjectMemorySnapshot({
			cwd,
			sessionId: "session-1",
			checkpoint: "Goal: overflow test",
			state,
		});

		const activeContext = readFileSync(join(cwd, ".pdev/memory/active-context.md"), "utf8");
		// The goal line should be capped; extract just the Goal: line.
		const goalLine = activeContext.split("\n").find((line) => line.startsWith("Goal:")) ?? "";
		// "Goal: " prefix is 6 chars; value must be <= 360.
		expect(goalLine.length).toBeLessThanOrEqual("Goal: ".length + 360);
	});

	it("capLine clamps goal to at most 360 chars when there are late word breaks", () => {
		const cwd = createTempProject();
		const state = createInitialStructuredSessionState("session-1");
		// A goal where the only space is well past the cap boundary.
		state.canonicalRequest.current = `Fix ${"x".repeat(400)}`;

		updateProjectMemorySnapshot({
			cwd,
			sessionId: "session-1",
			checkpoint: "Goal: overflow test",
			state,
		});

		const activeContext = readFileSync(join(cwd, ".pdev/memory/active-context.md"), "utf8");
		const goalLine = activeContext.split("\n").find((line) => line.startsWith("Goal:")) ?? "";
		// The value portion after "Goal: " must not exceed 360 chars.
		const goalValue = goalLine.slice("Goal: ".length);
		expect(goalValue.length).toBeLessThanOrEqual(360);
		expect(goalValue.endsWith("...")).toBe(true);
	});
});
