import { spawnSync } from "node:child_process";

export type ExecutableConstraintType = "path_block" | "command_required" | "diff_check" | "test_required";
export type ConstraintPhase = "edit" | "bash" | "final";
export type ConstraintSeverity = "info" | "warning" | "critical";

export interface ConstraintResult {
	id: string;
	ok: boolean;
	severity: ConstraintSeverity;
	message: string;
}

export interface ExecutableConstraint {
	id: string;
	sourceRuleId: string;
	type: ExecutableConstraintType;
	runBefore?: ConstraintPhase;
	check(input: GuardrailCheckInput): ConstraintResult;
}

export interface GuardrailCheckInput {
	cwd: string;
	command?: string;
	changedPaths?: string[];
	recentCommands?: string[];
	phase?: ConstraintPhase;
}

export interface GuardrailReport {
	results: ConstraintResult[];
	ok: boolean;
}

export const EXECUTABLE_CONSTRAINTS: readonly ExecutableConstraint[] = [
	{
		id: "block-generated-models",
		sourceRuleId: "agents:no-direct-generated-models",
		type: "path_block",
		check(input) {
			const touched = input.changedPaths ?? [];
			const blocked = touched.filter((path) => path.endsWith("packages/ai/src/models.generated.ts"));
			return result(
				"block-generated-models",
				blocked.length === 0,
				"critical",
				blocked.length === 0
					? "Generated model file not edited directly."
					: "Do not edit packages/ai/src/models.generated.ts directly; update the generator and regenerate.",
			);
		},
	},
	{
		id: "reject-broad-git-add",
		sourceRuleId: "agents:no-git-add-all",
		type: "diff_check",
		runBefore: "bash",
		check(input) {
			const command = input.command ?? "";
			const violates = /\bgit\s+add\s+(-A|--all|\.)\b/.test(command);
			return result(
				"reject-broad-git-add",
				!violates,
				"critical",
				violates
					? "Use explicit git add paths; broad staging can include unrelated work."
					: "Git staging command is scoped.",
			);
		},
	},
	{
		id: "require-check-after-compaction",
		sourceRuleId: "agents:check-after-code-changes",
		type: "test_required",
		runBefore: "final",
		check(input) {
			const touched = input.changedPaths ?? [];
			const changedCompaction = touched.some(
				(path) => path.includes("compaction") || path.endsWith("agent-session.ts"),
			);
			const ranCheck = (input.recentCommands ?? []).some((command) => command.trim() === "npm run check");
			return result(
				"require-check-after-compaction",
				!changedCompaction || ranCheck,
				"warning",
				!changedCompaction || ranCheck
					? "Required check command observed for compaction/session changes."
					: "Run npm run check after compaction/session code changes.",
			);
		},
	},
	{
		id: "public-api-approval",
		sourceRuleId: "agents:ask-before-public-api",
		type: "diff_check",
		runBefore: "final",
		check(input) {
			const touched = input.changedPaths ?? [];
			const publicApi = touched.filter((path) => /packages\/[^/]+\/src\/(index|types)\.ts$/.test(path));
			return result(
				"public-api-approval",
				publicApi.length === 0,
				"warning",
				publicApi.length === 0
					? "No public API entrypoint changes detected."
					: `Public API entrypoint changed: ${publicApi.join(", ")}. Confirm migration/approval before finalizing.`,
			);
		},
	},
	{
		id: "dirty-worktree-final",
		sourceRuleId: "agents:explicit-staging-only",
		type: "diff_check",
		runBefore: "final",
		check(input) {
			const touched = input.changedPaths ?? [];
			return result(
				"dirty-worktree-final",
				true,
				touched.length > 0 ? "warning" : "info",
				touched.length > 0
					? `Worktree has ${touched.length} changed path(s); stage only explicit files owned by this task.`
					: "Worktree has no changed paths.",
			);
		},
	},
];

export function evaluateGuardrails(input: GuardrailCheckInput): GuardrailReport {
	const changedPaths = input.changedPaths ?? getChangedPaths(input.cwd);
	const enriched = { ...input, changedPaths };
	const results = EXECUTABLE_CONSTRAINTS.filter(
		(constraint) => !input.phase || !constraint.runBefore || constraint.runBefore === input.phase,
	).map((constraint) => constraint.check(enriched));
	return { results, ok: results.every((item) => item.ok || item.severity !== "critical") };
}

export function getChangedPaths(cwd: string): string[] {
	const result = spawnSync("git", ["status", "--short", "--untracked-files=all"], { cwd, encoding: "utf8" });
	if (result.status !== 0) return [];
	return result.stdout
		.split("\n")
		.map((line) => line.slice(3).trim())
		.map((line) => (line.includes(" -> ") ? (line.split(" -> ").at(-1)?.trim() ?? line) : line))
		.filter((line) => line.length > 0);
}

function result(id: string, ok: boolean, severity: ConstraintSeverity, message: string): ConstraintResult {
	return { id, ok, severity, message };
}
