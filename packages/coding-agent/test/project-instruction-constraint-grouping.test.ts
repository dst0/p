import { describe, expect, it } from "vitest";
import { buildProjectInstructionConstraints } from "../src/core/project-instructions/compiler-constraints.ts";
import { materializeProjectInstructionCompilerResult } from "../src/core/project-instructions/compiler-validation.ts";
import { splitInstructionSources } from "../src/core/project-instructions/content.ts";
import { PROJECT_INSTRUCTION_MODULE_MAX_BYTES } from "../src/core/project-instructions/limits.ts";
import type { ProjectInstructionClassifications } from "../src/core/project-instructions/types.ts";

function constraintsFor(content: string) {
  return buildProjectInstructionConstraints([
    {
      id: "module-1",
      link: "rules/module-1.md",
      title: "Safety",
      sourcePath: "/repo/AGENTS.md",
      content,
    },
  ]);
}

describe("project-instruction structural constraint grouping", () => {
  it("keeps a wrapped list exception atomic with its governing rule", () => {
    const constraints = constraintsFor(
      ["# Safety", "- Never delete user data", "  unless the user explicitly confirms.", "- Preserve backups."].join(
        "\n",
      ),
    );

    expect(constraints.map(({ content }) => content)).toEqual([
      "- Never delete user data\n  unless the user explicitly confirms.",
      "- Preserve backups.",
    ]);
    expect(constraints[0]?.headingContext.map(({ content }) => content)).toEqual(["# Safety"]);
    const classifications: ProjectInstructionClassifications = {
      modules: { "module-1": "always-on" as const },
      constraints: Object.fromEntries(
        constraints.map((constraint, index) => [constraint.id, index === 0 ? "always-on" : "routed"]),
      ),
    };
    const materialized = materializeProjectInstructionCompilerResult(
      classifications,
      { "module-1": "backups" },
      constraints,
    );
    expect(materialized.body).toContain("# Safety\n- Never delete user data\n  unless the user explicitly confirms.");
    expect(materialized.body).not.toContain("Preserve backups");
  });

  it("keeps a wrapped paragraph modality clause atomic across languages", () => {
    const constraints = constraintsFor(
      [
        "# Безопасность",
        "Все изменения должны сохранять метаданные",
        "если пользователь явно не запросил замену.",
        "",
        "Следующее отдельное правило.",
      ].join("\n"),
    );

    expect(constraints.map(({ content }) => content)).toEqual([
      "Все изменения должны сохранять метаданные\nесли пользователь явно не запросил замену.",
      "Следующее отдельное правило.",
    ]);
    expect(constraints.every(({ headingContext }) => headingContext[0]?.content === "# Безопасность")).toBe(true);
  });

  it("keeps nested list qualifications with the parent while separating peer rules", () => {
    const constraints = constraintsFor(
      [
        "- Protect production data.",
        "  - except disposable test fixtures",
        "    when the fixture owner approves.",
        "- Run focused checks.",
      ].join("\n"),
    );

    expect(constraints.map(({ content }) => content)).toEqual([
      "- Protect production data.\n  - except disposable test fixtures\n    when the fixture owner approves.",
      "- Run focused checks.",
    ]);
  });

  it("keeps a blank-line-indented exception inside its list rule", () => {
    const constraints = constraintsFor(
      ["- Never publish credentials.", "", "  unless the owner explicitly requests it.", "", "Next paragraph."].join(
        "\n",
      ),
    );

    expect(constraints.map(({ content }) => content)).toEqual([
      "- Never publish credentials.\n\n  unless the owner explicitly requests it.",
      "Next paragraph.",
    ]);
  });

  it("does not interpret ATX-looking lines inside fenced code as headings", () => {
    const constraints = constraintsFor(
      ["# Real rules", "```sh", "# not a heading", "echo safe", "```", "", "Apply the real rule."].join("\n"),
    );

    expect(constraints.map(({ content }) => content)).toEqual([
      "```sh\n# not a heading\necho safe\n```",
      "Apply the real rule.",
    ]);
    expect(
      constraints.every(({ headingContext }) => headingContext.map(({ content }) => content).join() === "# Real rules"),
    ).toBe(true);
  });

  it("keeps indented code out of heading context while recognizing up to three heading spaces", () => {
    const content = "    # four-space code\n\t# tab-indented code\n   ### Real rules\nApply the real rule.\n";
    const modules = splitInstructionSources([{ path: "/repo/AGENTS.md", content }]);
    const constraints = buildProjectInstructionConstraints(modules);

    expect(modules.map((module) => module.content).join("")).toBe(content);
    expect(constraints.map((constraint) => constraint.content)).toEqual([
      "    # four-space code\n\t# tab-indented code",
      "Apply the real rule.",
    ]);
    expect(constraints[0]?.headingContext).toEqual([]);
    expect(constraints[1]?.headingContext.map(({ content: heading }) => heading)).toEqual(["   ### Real rules"]);
  });

  it("uses visual tab columns for a blank-line list continuation", () => {
    const constraints = constraintsFor("  - Never publish credentials.\n\n\tunless the owner explicitly approves.\n");

    expect(constraints.map(({ content }) => content)).toEqual([
      "  - Never publish credentials.\n\n\tunless the owner explicitly approves.",
    ]);
  });

  it("requires blank-line list continuations to reach the marker content column", () => {
    const constraints = constraintsFor(
      [
        "- Root rule.",
        "",
        " one-space peer.",
        "100. Ordered rule.",
        "",
        "    four-space peer.",
        "100. Governed rule.",
        "",
        "     five-space continuation.",
        "- Tab-governed rule.",
        "",
        "\ttab continuation.",
      ].join("\n"),
    );

    expect(constraints.map(({ content }) => content)).toEqual([
      "- Root rule.",
      " one-space peer.",
      "100. Ordered rule.",
      "    four-space peer.",
      "100. Governed rule.\n\n     five-space continuation.",
      "- Tab-governed rule.\n\n\ttab continuation.",
    ]);
  });

  it("recognizes one-, two-, and three-space ATX headings", () => {
    const constraints = constraintsFor(
      " # One-space heading\nFirst rule.\n  ## Two-space heading\nSecond rule.\n   ### Three-space heading\nThird rule.\n",
    );

    expect(constraints.map(({ headingContext }) => headingContext.map(({ content }) => content))).toEqual([
      [" # One-space heading"],
      [" # One-space heading", "  ## Two-space heading"],
      [" # One-space heading", "  ## Two-space heading", "   ### Three-space heading"],
    ]);
  });

  it("does not let indented pseudo-fences suppress following headings", () => {
    const constraints = constraintsFor(
      ["    ```", "    # code sample", "\t~~~", "\t# tab code sample", "## Real heading", "Apply it."].join("\n"),
    );

    expect(constraints.map(({ content }) => content)).toEqual([
      "    ```\n    # code sample\n\t~~~\n\t# tab code sample",
      "Apply it.",
    ]);
    expect(constraints[1]?.headingContext.map(({ content }) => content)).toEqual(["## Real heading"]);
  });

  it("splits large sources only between structural units and reconstructs multibyte source exactly", () => {
    const firstRule = `- First governed rule ${"é".repeat(5_990)}.\n`;
    const secondRule = `- Second governed rule ${"界".repeat(3_990)}.\n`;
    const thirdRule = `- Third governed rule ${"é".repeat(5_990)}.\n`;
    const content = `# Safety\n${firstRule}${secondRule}${thirdRule}`;

    const modules = splitInstructionSources([{ path: "/repo/AGENTS.md", content }]);

    expect(modules.length).toBeGreaterThan(1);
    expect(modules.map((module) => module.content).join("")).toBe(content);
    expect(
      modules.every((module) => Buffer.byteLength(module.content, "utf8") <= PROJECT_INSTRUCTION_MODULE_MAX_BYTES),
    ).toBe(true);
    expect(buildProjectInstructionConstraints(modules).map(({ content: rule }) => rule)).toEqual([
      firstRule.trimEnd(),
      secondRule.trimEnd(),
      thirdRule.trimEnd(),
    ]);
  });

  it("fails closed instead of splitting an oversized atomic rule from its exception", () => {
    const governedRule = [
      "# Safety",
      "- Never publish protected data",
      `  ${"界".repeat(PROJECT_INSTRUCTION_MODULE_MAX_BYTES)}`,
      "  unless its owner explicitly approves.",
    ].join("\n");

    expect(() => splitInstructionSources([{ path: "/repo/AGENTS.md", content: governedRule }])).toThrow(
      /single structural instruction unit of \d+ bytes that exceeds the 24000-byte module limit/u,
    );
  });
});
