import { describe, expect, it } from "vitest";
import { buildProjectInstructionConstraints } from "../src/core/project-instructions/compiler-constraints.ts";
import { scanProjectInstructionStructuralUnits } from "../src/core/project-instructions/compiler-structural-units.ts";
import { materializeProjectInstructionCompilerResult } from "../src/core/project-instructions/compiler-validation.ts";
import { renderProjectInstructions } from "../src/core/project-instructions/prompt.ts";
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

function classificationsFor(
  constraints: ReturnType<typeof constraintsFor>,
  scopes: Array<"always-on" | "routed">,
): ProjectInstructionClassifications {
  return {
    modules: { "module-1": scopes.includes("always-on") ? "always-on" : "routed" },
    constraints: Object.fromEntries(constraints.map((constraint, index) => [constraint.id, scopes[index]])),
  };
}

describe("project-instruction exact source spans", () => {
  it("partitions headings, separators, duplicate rules, and fences without overlap or loss", () => {
    const source = [
      "# Safety\r\n",
      "\r\n",
      "- Repeat.  \r\n",
      "- Repeat.  \r\n",
      "\r\n",
      "```text\r\n",
      "# code, not heading\r\n",
      "```\r\n",
      "\r\n",
    ].join("");

    const units = scanProjectInstructionStructuralUnits(source).units;
    let expectedStart = 0;
    for (const unit of units) {
      expect(unit.sourceStartOffset).toBe(expectedStart);
      expect(unit.sourceText).toBe(source.slice(unit.sourceStartOffset, unit.sourceEndOffset));
      expect(unit.sourceEndOffset).toBeGreaterThan(unit.sourceStartOffset);
      expectedStart = unit.sourceEndOffset;
    }
    expect(expectedStart).toBe(source.length);
    expect(units.map(({ sourceText }) => sourceText).join("")).toBe(source);
  });

  it("preserves repeated peer occurrences and materializes both in source order", () => {
    const source = "# Safety\n- Always preserve X.\n- Always preserve X.\n";
    const constraints = constraintsFor(source);

    expect(constraints.map(({ content }) => content)).toEqual(["- Always preserve X.", "- Always preserve X."]);
    const materialized = materializeProjectInstructionCompilerResult(
      classificationsFor(constraints, ["always-on", "always-on"]),
      {},
      constraints,
    );
    expect(materialized.body).toBe(source.trimEnd());
    expect(Object.values(materialized.alwaysOn).join("")).toBe(source);
  });

  it("preserves source gaps and trailing whitespace while normalizing line endings", () => {
    const content =
      "# Exact source\r\n\r\nKeep this hard break.  \r\n\tcode value\t\r\n\r\n- Keep the second rule.\r\n";
    const constraints = constraintsFor(content);
    const materialized = materializeProjectInstructionCompilerResult(
      classificationsFor(
        constraints,
        constraints.map(() => "always-on"),
      ),
      {},
      constraints,
    );

    expect(materialized.body).toBe(
      "# Exact source\n\nKeep this hard break.  \n\tcode value\t\n\n- Keep the second rule.",
    );
    expect(Object.values(materialized.alwaysOn).join("")).toBe(
      "# Exact source\n\nKeep this hard break.  \n\tcode value\t\n\n- Keep the second rule.\n",
    );
  });

  it("projects CRLF separators deterministically across mixed sibling scopes", () => {
    const source = "# Safety\r\nRouted first.\r\n\r\nAlways second.\r\n";
    const constraints = constraintsFor(source);

    const routedFirst = materializeProjectInstructionCompilerResult(
      classificationsFor(constraints, ["routed", "always-on"]),
      { "module-1": "Routed" },
      constraints,
    );
    expect(routedFirst.body).toBe("# Safety\n\nAlways second.");
    expect(routedFirst.alwaysOn).toEqual({ "constraint-2": "# Safety\n\nAlways second.\n" });

    const alwaysFirst = materializeProjectInstructionCompilerResult(
      classificationsFor(constraints, ["always-on", "routed"]),
      { "module-1": "Routed" },
      constraints,
    );
    expect(alwaysFirst.body).toBe("# Safety\nRouted first.");
    expect(alwaysFirst.alwaysOn).toEqual({ "constraint-1": "# Safety\nRouted first.\n" });
  });

  it("partitions and classifies bare-CR sources before normalizing their line endings", () => {
    const source = "# Safety\rRouted first.\r\rAlways second.\r";
    const scan = scanProjectInstructionStructuralUnits(source);
    const constraints = constraintsFor(source);

    expect(scan.units.map(({ sourceText }) => sourceText).join("")).toBe(source);
    expect(constraints.map(({ content }) => content)).toEqual(["Routed first.", "Always second."]);
    const materialized = materializeProjectInstructionCompilerResult(
      classificationsFor(constraints, ["routed", "always-on"]),
      { "module-1": "Routed" },
      constraints,
    );
    expect(materialized.body).toBe("# Safety\n\nAlways second.");
  });

  it("preserves final-line hard-break spaces in the injected compiled block", () => {
    const prompt = renderProjectInstructions({
      agentsHash: "a".repeat(64),
      inputHash: "b".repeat(64),
      cacheDir: "/repo/.pdev/instructions",
      mode: "compiled",
      body: "Always preserve this hard break.  ",
      sources: [],
      rules: [],
      skills: [],
    });

    expect(prompt).toContain("Always preserve this hard break.  \n");
  });
});
