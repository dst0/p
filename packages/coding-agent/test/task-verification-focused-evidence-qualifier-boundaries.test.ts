import { describe, expect, it } from "vitest";
import { evidenceMatchesRequirement } from "../src/core/task-verification/taskverificationcontroller-methods/focused-evidence-relevance.ts";
import type { TaskRequirement } from "../src/core/task-verification/types.ts";

describe("task verification focused evidence qualifier boundaries", () => {
  it("allows rejection evidence to satisfy validation only for the same unsafe qualifier", () => {
    const requirement = focusedRequirement(
      "Authorization validates invalid completion tokens",
      "Validation catches an invalid completion token",
    );

    expect(evidenceMatchesRequirement(requirement, ["rejects invalid authorization completion token"])).toBe(true);
    expect(evidenceMatchesRequirement(requirement, ["rejects valid authorization completion token"])).toBe(false);
  });

  it("resolves qualifier negation across grammatical bridge terms", () => {
    const requirement = focusedRequirement(
      "Authorization accepts completion tokens not considered invalid",
      "Authorization accepts a completion token not considered invalid",
    );

    expect(
      evidenceMatchesRequirement(requirement, ["authorization accepts completion token not considered invalid"]),
    ).toBe(true);
    expect(evidenceMatchesRequirement(requirement, ["authorization accepts invalid completion token"])).toBe(false);
  });
});

function focusedRequirement(text: string, acceptanceCriterion: string): TaskRequirement {
  return {
    acceptanceCriterion,
    id: "R1",
    sourcePromptIndexes: [],
    text,
    type: "constraint",
  };
}
