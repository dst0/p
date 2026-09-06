import { describe, expect, it } from "vitest";
import { ignoredClauseClassificationError } from "../src/core/task-verification/requirement-clause-semantics.ts";
import { requirementSourceClauses } from "../src/core/task-verification/requirement-source-clauses.ts";

describe("referenced requirement list semantics", () => {
  it("treats standalone colon labels as headings without weakening normative colon prose", () => {
    const clauses = requirementSourceClauses([
      {
        id: "spec",
        kind: "referenced_file",
        path: "SPEC.md",
        text: ["Requirements:", "Guarantee: exports must remain deterministic.", "- Reject truncated exports."].join(
          "\n",
        ),
      },
    ]);

    expect(clauses[0]).toMatchObject({ kind: "heading", text: "Requirements" });
    expect(ignoredClauseClassificationError(clauses[0]!, "informational")).toBeUndefined();
    expect(clauses[1]).toMatchObject({ kind: "prose", text: "Guarantee: exports must remain deterministic." });
    expect(ignoredClauseClassificationError(clauses[1]!, "informational")).toContain("normative");
    expect(clauses[2]?.normativeHint).toBe(true);
  });

  it.each([
    "Reject invalid input:",
    "Preserve final byte:",
    "No data loss:",
    "Foobar:",
    "requirements:",
    "REQUIREMENTS:",
    "Requirements :",
  ])("keeps non-allowlisted standalone colon prose normative: %s", (text) => {
    const clauses = requirementSourceClauses([{ id: "spec", kind: "referenced_file", path: "SPEC.md", text }]);

    expect(clauses).toEqual([{ id: "S1-C1", sourcePromptIndex: 1, kind: "prose", text }]);
    expect(ignoredClauseClassificationError(clauses[0]!, "informational")).toBeDefined();
  });

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
