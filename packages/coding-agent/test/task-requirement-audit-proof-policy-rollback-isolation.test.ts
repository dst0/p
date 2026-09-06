import { describe, expect, it } from "vitest";
import { deriveRequirementProofPolicies } from "../src/core/task-verification/requirement-derived-boundaries.ts";
import type { TaskRequirement, TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

describe("rollback proof-policy semantic isolation", () => {
  it("does not derive failed-operation proofs from a static rollback field", () => {
    const result = deriveRequirementProofPolicies(
      [
        {
          id: "handoff",
          kind: "referenced_file",
          path: "OPERATIONS.md",
          text: "Rollback: Restore state on error; never alter audit history.",
        },
      ],
      [
        {
          ...requirement(
            "Set the rollback field to the reversible state boundary",
            "The rollback key includes: Restore state on error",
          ),
          id: "R1",
          sourceClauseIds: ["S1-C1"],
        },
        {
          ...requirement(
            "Set the rollback field to the audit history boundary",
            "The rollback key includes: never alter audit history",
          ),
          id: "R2",
          sourceClauseIds: ["S1-C2"],
        },
      ],
    );

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[]).map((item) => item.proofPolicies)).toEqual([undefined, undefined]);
  });

  it.each([
    'JSON contains "rollback": "restore state on error"',
    'JSON contains "rollback": "after rollback, state remains unchanged"',
    'rollback: "after rollback, state remains unchanged"',
    "rollback: after rollback state remains unchanged",
  ])("does not execute a static rollback property containing a %s", (criterion) => {
    const result = deriveRequirementProofPolicies(
      [directSource(criterion)],
      [requirement("Emit the configured JSON member", criterion)],
    );

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toBeUndefined();
  });

  it.each([
    ["After rollback, state remains unchanged", "Preserve state after rollback"],
    ["Upon rollback, state remains unchanged", "Preserve state upon rollback"],
    ["The transaction invokes rollback and state remains unchanged", "Preserve state when rollback is invoked"],
    ["Execute the rollback value; after rollback, state remains unchanged", "Execute the rollback value safely"],
    ["Once rollback has been performed, state remains unchanged", "Preserve state after rollback completes"],
    ["A rollback leaves state unchanged", "Preserve state through rollback"],
  ])("recognizes an action-shaped rollback event: %s", (acceptanceCriterion, text) => {
    const result = deriveRequirementProofPolicies(
      [directSource(acceptanceCriterion)],
      [requirement(text, acceptanceCriterion)],
    );

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toContain("preserve_state_on_failure");
  });
});

function directSource(text: string): TaskVerificationSourcePrompt {
  return { id: "user", kind: "user_prompt", text };
}

function requirement(text: string, acceptanceCriterion: string): TaskRequirement {
  return {
    id: "R1",
    type: "constraint",
    text,
    acceptanceCriterion,
    sourcePromptIndexes: [1],
  };
}
