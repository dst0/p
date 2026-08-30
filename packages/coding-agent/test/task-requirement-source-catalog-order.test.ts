import { describe, expect, it } from "vitest";
import { orderRequirementDefinitionSources } from "../src/core/task-verification/requirement-source-catalog-order.ts";
import type { TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

describe("requirement-source catalog ordering", () => {
  it("uses the same frozen prompt boundaries for reusable and incremental sources", () => {
    const prompts = [prompt("p1"), prompt("p2")];
    const ordered = orderRequirementDefinitionSources(prompts, [
      { promptCount: 1, source: referenced("A") },
      { promptCount: 2, source: referenced("B") },
    ]);

    expect(ordered.map((source) => source.id)).toEqual(["p1", "A", "p2", "B"]);
  });

  it("preserves reference order when sources share one captured boundary", () => {
    const ordered = orderRequirementDefinitionSources(
      [prompt("p1")],
      [
        { promptCount: 1, source: referenced("A") },
        { promptCount: 1, source: referenced("B") },
      ],
    );

    expect(ordered.map((source) => source.id)).toEqual(["p1", "A", "B"]);
  });
});

function prompt(id: string): TaskVerificationSourcePrompt {
  return { id, text: `Direct prompt ${id}` };
}

function referenced(id: string): TaskVerificationSourcePrompt {
  return { id, kind: "referenced_file", path: `${id}.md`, text: `Source ${id}` };
}
