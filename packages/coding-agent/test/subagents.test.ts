import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	BUILTIN_SUBAGENT_PROFILES,
	createSubagentDigestContext,
	createSubagentProfilesPrompt,
	persistSubagentDigest,
	readSubagentDigests,
} from "../src/core/subagents.ts";

const tempDirs: string[] = [];

function createTempProject(): string {
	const cwd = mkdtempSync(join(tmpdir(), "pi-subagents-"));
	tempDirs.push(cwd);
	return cwd;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("subagent profiles and digests", () => {
	it("defines read-only built-in profiles and hides compact from parent prompt", () => {
		const prompt = createSubagentProfilesPrompt();

		expect(
			BUILTIN_SUBAGENT_PROFILES.filter((profile) => !profile.hidden).every(
				(profile) => profile.permissions.edit === "deny",
			),
		).toBe(true);
		expect(prompt).toContain("explore");
		expect(prompt).not.toContain("compact");
	});

	it("persists bounded digests for later recall instead of raw transcripts", () => {
		const cwd = createTempProject();
		const digest = persistSubagentDigest(cwd, {
			profile: "explore",
			query: "rules resolver",
			summary: "Found AGENTS.md and .pdev/rules precedence.",
			evidencePointers: ["file:AGENTS.md"],
		});
		const context = createSubagentDigestContext(cwd, "rules precedence");

		expect(readSubagentDigests(cwd)).toEqual([digest]);
		expect(context).toContain(digest.id);
		expect(context).toContain("file:AGENTS.md");
	});
});
