import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRepoMapContext, readRepoMap, updateRepoMap } from "../src/core/repo-map.ts";

const tempDirs: string[] = [];

function createTempProject(): string {
	const cwd = mkdtempSync(join(tmpdir(), "pi-repo-map-"));
	tempDirs.push(cwd);
	return cwd;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("repo map", () => {
	it("indexes language, imports, exports, summaries, and persists state", () => {
		const cwd = createTempProject();
		mkdirSync(join(cwd, "src"), { recursive: true });
		writeFileSync(
			join(cwd, "src/context.ts"),
			[
				'import { readFileSync } from "node:fs";',
				"export interface RuleIndex { files: string[] }",
				"export function buildContextMap(): RuleIndex {",
				"  return { files: [readFileSync.toString()] };",
				"}",
			].join("\n"),
		);

		const map = updateRepoMap(cwd);
		const persisted = readRepoMap(cwd);
		const context = createRepoMapContext(cwd, "buildContextMap RuleIndex");

		expect(map.files[0]).toMatchObject({
			path: "src/context.ts",
			language: "typescript",
			imports: ["node:fs"],
			lastIndexedSha: "unknown",
		});
		expect(map.files[0]?.exports.map((symbol) => symbol.name)).toContain("buildContextMap");
		expect(persisted?.files).toHaveLength(1);
		expect(context?.content).toContain("<repo_map>");
		expect(context?.content).toContain("src/context.ts");
	});

	it("refreshes stale non-git maps when files change", () => {
		const cwd = createTempProject();
		mkdirSync(join(cwd, "src"), { recursive: true });
		writeFileSync(join(cwd, "src/old.ts"), "export function oldHelper(): string { return 'old'; }\n");
		updateRepoMap(cwd);
		writeFileSync(join(cwd, "src/context-helper.ts"), "export function contextHelper(): string { return 'new'; }\n");

		const context = createRepoMapContext(cwd, "contextHelper");

		expect(context?.content).toContain("src/context-helper.ts");
	});

	it("refreshes stale git maps when dirty file contents change", () => {
		const cwd = createTempProject();
		spawnSync("git", ["init"], { cwd });
		mkdirSync(join(cwd, "src"), { recursive: true });
		writeFileSync(join(cwd, "src/context.ts"), "export function oldHelper(): string { return 'old'; }\n");
		updateRepoMap(cwd);
		writeFileSync(join(cwd, "src/context.ts"), "export function changedHelper(): string { return 'new'; }\n");

		const context = createRepoMapContext(cwd, "changedHelper");

		expect(context?.content).toContain("changedHelper");
	});

	it("keeps exported symbols discoverable beyond small repository caps", () => {
		const cwd = createTempProject();
		mkdirSync(join(cwd, "src/a"), { recursive: true });
		mkdirSync(join(cwd, "src/z"), { recursive: true });
		for (let index = 0; index < 450; index++) {
			writeFileSync(
				join(cwd, "src/a", `noise-${index.toString().padStart(3, "0")}.ts`),
				"export const noise = 1;\n",
			);
		}
		writeFileSync(join(cwd, "src/z/system-prompt.ts"), "export interface BuildSystemPromptOptions { cwd: string }\n");
		writeFileSync(
			join(cwd, "src/a/generic-prompt-context.ts"),
			[
				"export interface PromptOptions { prompt: string }",
				"export function answerContextToolRules(): string {",
				"  return 'automatic prompt context tools answer exactly absent';",
				"}",
			].join("\n"),
		);

		const context = createRepoMapContext(
			cwd,
			"For verification only, no tools are available. Based only on automatic prompt context, answer exactly the path of the file that exports BuildSystemPromptOptions. If absent, answer absent.",
		);

		expect(context?.files[0]?.path).toBe("src/z/system-prompt.ts");
		expect(context?.content).toContain("src/z/system-prompt.ts");
		expect(context?.content).toContain("BuildSystemPromptOptions");
	});
});
