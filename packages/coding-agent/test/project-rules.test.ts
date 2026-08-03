import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
});

describe("project rules conflict detection unit", () => {
  it("detects false conflict path", () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, ".pdev/rules"), { recursive: true });
    writeFileSync(
      join(cwd, ".pdev/rules/local.md"),
      ["# Local", "- This rule should not conflict", "- Another rule with completely different wording entirely"].join(
        "\\n",
      ),
    );
    const result = lintProjectRules(cwd);
    expect(result.issues.map((issue) => issue.code)).not.toContain("conflicting_rule");
  });
});

describe("project rules conflict detection branch coverage", () => {
  it("covers same-condition early return false paths", () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, ".pdev/rules"), { recursive: true });
    writeFileSync(
      join(cwd, ".pdev/rules/local.md"),
      [
        "# Local",
        "- You must always do A and B and C and D",
        "- You must always do A and B and C and D too", // isAlways === isAlways => true
        "- Do not ever ever ever do A and B and C and D",
        "- Do not ever ever ever do A and B and C and D either", // isNever === isNever => true
        "- This rule just exists",
        "- This rule just exists too", // neither => true
      ].join("\\n"),
    );
    // This will hit `if (a.isNever === b.isNever || a.isAlways === b.isAlways) return false;` heavily
    const result = lintProjectRules(cwd);
    expect(result.issues.map(i => i.code)).not.toContain("conflicting_rule"); // none conflict because they are same polarity
  });
});

describe("project rules conflict detection branch coverage", () => {
  it("covers terms overlap false path (overlap < 3)", () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, ".pdev/rules"), { recursive: true });
    writeFileSync(
      join(cwd, ".pdev/rules/local.md"),
      [
        "# Local",
        "- You must always test testing tested tests",
        "- You must never test testing tested something else entirely",
      ].join("\\n"),
    );
    // overlap=2 (test, testing) or so, which is < 3
    const result = lintProjectRules(cwd);
    expect(result.issues.map(i => i.code)).not.toContain("conflicting_rule");
  });
});
