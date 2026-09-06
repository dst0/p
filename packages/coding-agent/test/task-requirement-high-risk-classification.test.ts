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

  it.each([
    [
      "Create handoff.json with exactly the keys decision, owner, and rollback in that order",
      "The JSON key order is decision, owner, rollback",
    ],
    [
      "Rollback must declare: Restore only contract-declared reversible state",
      "The rollback value contains the exact declared text",
    ],
    ["Rollback must declare: never alter audit history", "The rollback value preserves the exact declared text"],
  ])("does not classify a static rollback field as a transactional invariant", (text, acceptanceCriterion) => {
    expect(
      isHighRiskRequirement({
        id: "R1",
        type: "constraint",
        text,
        acceptanceCriterion,
        sourcePromptIndexes: [1],
      }),
    ).toBe(false);
  });

  it("retains high-risk classification for an active rollback invariant", () => {
    expect(
      isHighRiskRequirement({
        id: "R1",
        type: "constraint",
        text: "A rollback leaves state unchanged",
        acceptanceCriterion: "After rollback, state matches its pre-operation snapshot",
        sourcePromptIndexes: [1],
      }),
    ).toBe(true);
  });
});
