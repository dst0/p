import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateGuardrails, getChangedPaths } from "../src/core/guardrails.ts";

const tempDirs: string[] = [];

function createTempProject(): string {
	const cwd = mkdtempSync(join(tmpdir(), "pi-guardrails-"));
	tempDirs.push(cwd);
	return cwd;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("guardrails", () => {
	it("blocks broad git staging commands", () => {
		const report = evaluateGuardrails({ cwd: createTempProject(), phase: "bash", command: "git add -A" });

		expect(report.ok).toBe(false);
		expect(report.results.find((result) => result.id === "reject-broad-git-add")?.ok).toBe(false);
	});

	it("detects generated-file edits and required checks", () => {
		const report = evaluateGuardrails({
			cwd: createTempProject(),
			phase: "final",
			changedPaths: ["packages/ai/src/models.generated.ts", "packages/coding-agent/src/core/agent-session.ts"],
			recentCommands: [],
		});

		expect(report.ok).toBe(false);
		expect(report.results.find((result) => result.id === "block-generated-models")?.ok).toBe(false);
		expect(report.results.find((result) => result.id === "require-check-after-compaction")?.ok).toBe(false);
	});

	it("includes untracked paths in dirty worktree checks", () => {
		const cwd = createTempProject();
		spawnSync("git", ["init"], { cwd, encoding: "utf8" });
		writeFileSync(join(cwd, "new-file.ts"), "export const value = 1;\n");

		expect(getChangedPaths(cwd)).toContain("new-file.ts");
	});
});
