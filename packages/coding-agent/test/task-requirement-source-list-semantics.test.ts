import { describe, expect, it } from "vitest";
import { ignoredClauseClassificationError } from "../src/core/task-verification/requirement-clause-semantics.ts";
import { requirementSourceClauses } from "../src/core/task-verification/requirement-source-clauses.ts";

describe("referenced requirement list semantics", () => {
  it("retains normative semantics for saga-style API and property bullets", () => {
    const clauses = requirementSourceClauses([
      {
        id: "spec",
        kind: "referenced_file",
        path: "SPEC.md",
        text: [
          "- `claim(commandId)`: lease acquisition and duplicate suppression",
          "* `heartbeat(commandId)`: lease renewal",
          "+ `complete(commandId)`: result publication",
          "1. `cancel(commandId)`: cancellation transition",
          "2) `state`: current snapshot",
          "- `history`: immutable events",
          "- `fromLog(events)`: reconstructed aggregate",
        ].join("\n"),
      },
    ]);

    expect(clauses).toHaveLength(7);
    expect(clauses.every((clause) => clause.normativeHint === true)).toBe(true);
    for (const clause of clauses) {
      expect(ignoredClauseClassificationError(clause, "informational")).toBe(
        `Source clause ${clause.id} is normative and cannot be ignored as informational.`,
      );
    }
  });
});
