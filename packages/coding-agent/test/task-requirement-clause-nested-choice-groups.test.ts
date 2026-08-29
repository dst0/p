import { describe, expect, it } from "vitest";
import { choiceGroupConstraintErrors } from "../src/core/task-verification/requirement-clause-context.ts";
import type { RequirementSourceClause } from "../src/core/task-verification/requirement-source-clauses.ts";

describe("nested requirement-source choice groups", () => {
  it("includes every terminal descendant in the coordinated-choice diagnostic", () => {
    const clauses = [
      { id: "S1-C1", sourcePromptIndex: 1, kind: "prose", text: "Choose exactly one of:" },
      {
        id: "S1-C2",
        sourcePromptIndex: 1,
        kind: "prose",
        text: "Grouped alternatives:",
        introducedByClauseId: "S1-C1",
      },
      {
        id: "S1-C3",
        sourcePromptIndex: 1,
        kind: "prose",
        text: "Use alpha mode.",
        introducedByClauseId: "S1-C2",
      },
      {
        id: "S1-C4",
        sourcePromptIndex: 1,
        kind: "prose",
        text: "Use beta mode.",
        introducedByClauseId: "S1-C2",
      },
      {
        id: "S1-C5",
        sourcePromptIndex: 1,
        kind: "prose",
        text: "Use gamma mode.",
        introducedByClauseId: "S1-C1",
      },
    ] satisfies RequirementSourceClause[];

    const errors = choiceGroupConstraintErrors(clauses, [], new Set());

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("active alternatives (S1-C3, S1-C4, S1-C5)");
  });
});
