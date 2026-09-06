import { describe, expect, it } from "vitest";
import { formatRequirementProofWitnessTemplates } from "../src/core/task-verification/taskverificationcontroller-methods/requirement-audit-prompt.ts";
import type { TaskRequirement } from "../src/core/task-verification/types.ts";

describe("task verification proof witness template boundaries", () => {
  it("distinguishes state and log preservation evidence", () => {
    expect(formatRequirementProofWitnessTemplates(requirement("preserve_state_on_failure"))).toContain(
      '"beforeBase64":"<base64>","afterFailureBase64":"<base64>","failedOutcome":"threw"',
    );
    expect(formatRequirementProofWitnessTemplates(requirement("preserve_log_on_failure"))).toContain(
      '"policy":"preserve_log_on_failure"',
    );
  });

  it.each(["preserve_version_on_failure", "preserve_position_on_failure"] as const)(
    "requires failed and successful outcomes for %s witnesses",
    (policy) => {
      const lines = formatRequirementProofWitnessTemplates(requirement(policy)).split("\n");

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^P_PROOF_V1 /u);
      expect(JSON.parse(lines[0]!.slice("P_PROOF_V1 ".length))).toEqual({
        requirementId: "R1",
        policy,
        facts: {
          before: 4,
          afterFailure: 4,
          afterSuccess: 5,
          failedOutcome: "threw",
          successOutcome: "succeeded",
        },
      });
    },
  );
});

function requirement(policy: NonNullable<TaskRequirement["proofPolicies"]>[number]): TaskRequirement {
  return {
    acceptanceCriterion: "Failed writes preserve durable bytes",
    id: "R1",
    proofPolicies: [policy],
    sourcePromptIndexes: [],
    text: "Preserve durable bytes after failure",
    type: "constraint",
  };
}
