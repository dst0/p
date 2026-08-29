import { describe, expect, it } from "vitest";
import {
  clauseRequirementRelevanceError,
  directPromptSupersedesClause,
} from "../src/core/task-verification/requirement-clause-semantics.ts";
import type { RequirementSourceClause } from "../src/core/task-verification/requirement-source-clauses.ts";

describe("referenced requirement clause polarity", () => {
  it.each([
    ["Any truncated log must be rejected.", "Accept truncated logs", "The parser allows truncated log input"],
    [
      "Retries preserve the original command ID.",
      "Replace the command ID during retry",
      "Every retry uses a different command ID",
    ],
    [
      "The export must include a terminal newline.",
      "Omit the terminal newline",
      "The export is written without a final newline",
    ],
  ])("rejects a requirement that reverses source semantics: %s", (source, text, criterion) => {
    expect(clauseRequirementRelevanceError(clause(source), text, criterion)).toMatch(/reverses|conflict|polarity/iu);
  });

  it("does not classify a same-polarity clarification as supersession", () => {
    expect(
      directPromptSupersedesClause(
        "Do not accept truncated logs; keep rejecting truncated logs.",
        clause("Reject every truncated log."),
      ),
    ).toBe(false);
  });

  it.each([
    ["Do not reject truncated logs; accept them.", "Reject every truncated log."],
    [
      "Logs no longer need a terminal newline; allow a missing terminal newline.",
      "Every log must include a terminal newline.",
    ],
    ["Render the greeting in uppercase instead of lowercase.", "Render the greeting in lowercase."],
  ])("accepts a genuinely conflicting direct clarification: %s", (prompt, source) => {
    expect(directPromptSupersedesClause(prompt, clause(source))).toBe(true);
  });

  it("rejects an unrelated conflict phrase despite sharing a generic word", () => {
    expect(
      directPromptSupersedesClause("Do not reveal log access tokens.", clause("Reject every truncated log.")),
    ).toBe(false);
  });
});

function clause(text: string): RequirementSourceClause {
  return { id: "S1-C1", sourcePromptIndex: 1, kind: "prose", text, normativeHint: true };
}
