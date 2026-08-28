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
