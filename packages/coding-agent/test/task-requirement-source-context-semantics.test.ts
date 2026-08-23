import { describe, expect, it } from "vitest";
import {
  ignoredClauseClassificationError,
  isNormativeSourceClause,
} from "../src/core/task-verification/requirement-clause-semantics.ts";
import type { RequirementSourceClause } from "../src/core/task-verification/requirement-source-clauses.ts";

describe("referenced requirement context semantics", () => {
  it.each([
    { text: "Execution context: cwd and environment", normativeHint: true },
    { text: "The security context must remain isolated" },
    { text: "Preserve trace context across retries" },
    { text: "Context: callers must preserve authorization headers" },
    { text: "Do not pass context across security boundaries" },
  ])("keeps normative context clause '$text'", ({ text, normativeHint }) => {
    const clause: RequirementSourceClause = {
      id: "S1-C1",
      sourcePromptIndex: 1,
      kind: "prose",
      text,
      ...(normativeHint === true ? { normativeHint: true } : {}),
    };

    expect(isNormativeSourceClause(clause)).toBe(true);
    expect(ignoredClauseClassificationError(clause, "informational")).toBe(
      "Source clause S1-C1 is normative and cannot be ignored as informational.",
    );
  });

  it.each([
    "Context:",
    "Background:",
    "Overview",
    "The supporting details are below",
    "This paragraph is background context.",
  ])("keeps informational label or introduction '$text'", (text) => {
    const clause: RequirementSourceClause = {
      id: "S1-C1",
      sourcePromptIndex: 1,
      kind: "prose",
      text,
    };

    expect(isNormativeSourceClause(clause)).toBe(false);
    expect(ignoredClauseClassificationError(clause, "informational")).toBeUndefined();
  });
});
