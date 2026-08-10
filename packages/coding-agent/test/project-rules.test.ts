import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifySeverity, severityScore, sourceRank } from "../src/core/project-rule-text-analysis.ts";
import type { RuleSource } from "../src/core/project-rules.ts";
import {
  buildRuleIndex,
  createRulesContext,
  explainProjectRules,
  lintProjectRules,
} from "../src/core/project-rules.ts";

const tempDirs: string[] = [];

function createTempProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-project-rules-"));
  tempDirs.push(cwd);
  return cwd;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("project rules resolver", () => {
  it("ranks every rule severity and source", () => {
    expect(["optional note", "should verify", "must verify"].map(classifySeverity).map(severityScore)).toEqual([
      1, 2, 3,
    ]);
    const sources: RuleSource[] = ["pdev", "nearest_agents", "repo_agents", "global", "compatibility"];
    expect(sources.map(sourceRank)).toEqual([0, 1, 2, 3, 4]);
  });

  it("indexes scoped rules in precedence order and renders bounded context", () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, ".pdev/rules"), { recursive: true });
    writeFileSync(join(cwd, ".pdev/rules/local.md"), "# Local\n- Must run npm run check after code changes.\n");
    writeFileSync(join(cwd, "AGENTS.md"), "# Repo\n- Do not use git add -A.\n");

    const index = buildRuleIndex(cwd);
    const context = createRulesContext(cwd, "check git");
    const explanation = explainProjectRules(cwd, "git");

    expect(index.files.map((file) => file.source)).toEqual(["pdev", "nearest_agents"]);
    expect(context).toContain("<project_rules>");
    expect(context).toContain("npm run check");
    expect(explanation.content).toContain("git add -A");
  });

  it("lints duplicate rules, conflicts, and guardrail candidates", () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, ".pdev/rules"), { recursive: true });
    writeFileSync(
      join(cwd, ".pdev/rules/local.md"),
      [
        "# Local",
        "- Must run npm run check after code changes.",
        "- Must run npm run check after code changes.",
        "- Do not run npm run check after code changes.",
      ].join("\n"),
    );

    const result = lintProjectRules(cwd);
    const codes = result.issues.map((issue) => issue.code);

    expect(codes).toContain("duplicate_rule");
    expect(codes).toContain("conflicting_rule");
    expect(codes).toContain("guardrail_candidate");
  });

  it("does not flag style-only rules as executable guardrail candidates", () => {
    const cwd = createTempProject();
    writeFileSync(join(cwd, "AGENTS.md"), "# Style\n- Keep answers short and concise.\n- No cheerful filler text.\n");

    const result = lintProjectRules(cwd);

    expect(result.issues.map((issue) => issue.code)).not.toContain("guardrail_candidate");
  });

  it("preserves repeated-term conflict detection after precomputation", () => {
    const cwd = createTempProject();
    writeFileSync(
      join(cwd, "AGENTS.md"),
      [
        "# Rules",
        "- Must always preserve alpha beta gamma delta.",
        "- Never discard alpha alpha alpha elsewhere.",
      ].join("\n"),
    );

    const result = lintProjectRules(cwd);

    expect(result.issues.map((issue) => issue.code)).toContain("conflicting_rule");
  });

  it("does not report a conflict below the three-term overlap threshold", () => {
    const cwd = createTempProject();
    writeFileSync(
      join(cwd, "AGENTS.md"),
      ["# Rules", "- Must always preserve alpha beta gamma delta.", "- Never discard alpha beta elsewhere."].join("\n"),
    );

    const result = lintProjectRules(cwd);

    expect(result.issues.map((issue) => issue.code)).not.toContain("conflicting_rule");
  });
});
