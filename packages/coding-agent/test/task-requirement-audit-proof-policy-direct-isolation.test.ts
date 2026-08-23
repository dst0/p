import { describe, expect, it } from "vitest";
import { deriveRequirementProofPolicies } from "../src/core/task-verification/requirement-derived-boundaries.ts";
import type { TaskRequirement, TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

describe("direct-prompt proof-policy isolation", () => {
  it("does not join corruption semantics to an unrelated changed status requirement", () => {
    const result = deriveRequirementProofPolicies(
      [directSource("Reject corrupted payloads. Display changed status labels.")],
      [requirement("Display the changed status label", "The changed label is visible")],
    );

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toBeUndefined();
  });

  it("does not join failure preservation to an unrelated state display requirement", () => {
    const result = deriveRequirementProofPolicies(
      [directSource("Failed writes preserve state. Display state in the status panel.")],
      [requirement("Display state in the status panel", "Current state is visible")],
    );

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toBeUndefined();
  });

  it("rejects an indicator requirement that does not enforce truncation failure", () => {
    const result = deriveRequirementProofPolicies(
      [
        directSource(
          "Export every log as newline-terminated JSONL. Any log truncation must throw. Display an indicator for any exact final-byte truncation.",
        ),
      ],
      [
        requirement(
          "Display any exact final-byte log truncation indicator",
          "The terminal newline indicator is visible for all logs",
        ),
      ],
    );

    expect(result).toMatch(/requires one complete truncation requirement/iu);
  });

  it("retains direct rollback proof when failure and preservation are in the requirement", () => {
    const result = deriveRequirementProofPolicies(
      [directSource("Failed writes preserve state. Display state in the status panel.")],
      [requirement("Preserve state on failed writes", "State remains unchanged after a failed write")],
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
