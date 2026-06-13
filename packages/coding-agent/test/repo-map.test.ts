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
});
