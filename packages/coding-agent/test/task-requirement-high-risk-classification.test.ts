import { describe, expect, it } from "vitest";
import { isHighRiskRequirement } from "../src/core/task-verification/taskverificationcontroller-methods/requirement-verdict-validation.ts";

describe("high-risk requirement classification", () => {
  it("does not confuse authorized prose with an authentication invariant", () => {
    expect(
      isHighRiskRequirement({
        id: "R1",
        type: "behavior",
        text: "The exact regression remains fixed",
        acceptanceCriterion: "The authorized exact replay passes",
        sourcePromptIndexes: [1],
      }),
    ).toBe(false);
  });

  it.each([
    "Authenticated users can access admin settings",
    "Unauthenticated requests are denied",
    "Authorize access before reading records",
    "Access control blocks guests",
    "Authorized access requires permission checks",
  ])("recognizes common access-control wording as high risk: %s", (text) => {
    expect(
      isHighRiskRequirement({
        id: "R1",
        type: "constraint",
        text,
        acceptanceCriterion: "A targeted access-control test proves the invariant",
        sourcePromptIndexes: [1],
      }),
    ).toBe(true);
  });
});
