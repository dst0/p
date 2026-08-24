import { describe, expect, it } from "vitest";
import { deriveRequirementProofPolicies } from "../src/core/task-verification/requirement-derived-boundaries.ts";
import { formatRequirementProofPlan } from "../src/core/task-verification/taskverificationcontroller-methods/requirement-audit-prompt.ts";
import type { TaskRequirement, TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

describe("proof-policy semantic isolation", () => {
  it("tells the model to run the named proof case through a test selector", () => {
    const plan = formatRequirementProofPlan([
      {
        ...requirement(
          "Return false for a tampered candidate whose bytes differ from the original",
          "isAuthentic returns false when candidate bytes differ from original bytes",
        ),
        proofPolicies: ["change_artifact_bytes"],
      },
    ]);

    expect(plan).toContain("test runner's case selector");
    expect(plan).toContain("--test-name-pattern");
    expect(plan).toContain("The selector itself must name the observable outcome");
    expect(plan).toContain("isAuthentic returns false when candidate bytes differ from original bytes");
    expect(plan).toContain("A shorter prefix is insufficient");
    expect(plan).toContain("inside that exact named test case before the first focused run");
    expect(plan).toContain("A standalone proof script or separate command is invalid");
  });

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

  it("does not treat a read-only snapshot as corrupted-artifact rejection", () => {
    const result = deriveRequirementProofPolicies(
      [
        {
          id: "spec",
          kind: "referenced_file",
          path: "README.md",
          text: "Counter.snapshot() returns the current integer value without mutating it.",
        },
      ],
      [
        {
          ...requirement(
            "Counter.snapshot() returns the current integer value without mutating it",
            "Calling Counter.snapshot() returns the current integer value without mutating it",
          ),
          sourceClauseIds: ["S1-C1"],
        },
      ],
    );

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toBeUndefined();
  });

  it("retains changed-artifact proof for a rejected mutated payload", () => {
    const result = deriveRequirementProofPolicies(
      [directSource("Reject a mutated payload.")],
      [requirement("Reject a mutated payload", "A mutated payload is rejected")],
    );

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toContain("change_artifact_bytes");
  });

  it("retains changed-artifact proof for a non-throwing tamper detector", () => {
    const result = deriveRequirementProofPolicies(
      [directSource("Detect a tampered payload and return false.")],
      [requirement("Detect a tampered payload", "A tampered payload returns false")],
    );

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toContain("change_artifact_bytes");
  });

  it("does not reverse an instruction that forbids payload mutation", () => {
    const result = deriveRequirementProofPolicies(
      [directSource("Do not mutate the payload.")],
      [requirement("Do not mutate the payload", "The payload remains byte-identical")],
    );

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toBeUndefined();
  });

  it("retains corruption proof when an unrelated state mutation is forbidden", () => {
    const result = deriveRequirementProofPolicies(
      [directSource("Reject corrupted payloads without mutating state.")],
      [
        requirement(
          "Reject a corrupted payload without mutating state",
          "A corrupted payload is rejected and state remains unchanged",
        ),
      ],
    );

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toContain("change_artifact_bytes");
  });

  it("does not reverse passive payload-corruption prevention", () => {
    const result = deriveRequirementProofPolicies(
      [directSource("Ensure the payload is not corrupted after round-trip.")],
      [requirement("Ensure the payload is not corrupted", "The round-trip payload remains byte-identical")],
    );

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toBeUndefined();
  });

  it("retains changed-artifact proof for a modified referenced payload", () => {
    const result = deriveRequirementProofPolicies(
      [{ id: "spec", kind: "referenced_file", path: "SPEC.md", text: "Reject a modified payload." }],
      [
        {
          ...requirement("Reject a modified payload", "A modified payload is rejected"),
          sourceClauseIds: ["S1-C1"],
        },
      ],
    );

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toContain("change_artifact_bytes");
  });

  it.each([
    "Payloads must not be corrupted or tampered.",
    "Do not corrupt or tamper with payloads.",
    "Ensure no corruption or tampering occurs.",
    "Avoid corrupting the payload.",
    "Prevent payload corruption.",
    "Avoid payload corruption.",
    "Payloads must not be corrupted, altered, or tampered.",
    "Do not corrupt, alter, or tamper with payloads.",
    "Ensure no corruption, modification, or tampering occurs.",
    "Payloads may not be corrupted.",
    "Avoid data corruption when loading files.",
    "Prevent payload corruption and return the original bytes.",
    "Corruption must be prevented when data is loaded.",
    "Files remain free of corruption after parsing.",
    "Ensure corruption does not occur when data is returned.",
    "Return the snapshot before mutating the payload.",
    "Report success before the payload is corrupted.",
    "Validate state before changing payload bytes.",
  ])("does not reverse coordinated or governed corruption prevention: %s", (instruction) => {
    const result = deriveRequirementProofPolicies(
      [directSource(instruction)],
      [requirement(instruction, "The payload remains byte-identical")],
    );

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toBeUndefined();
  });

  it.each([
    "Quarantine corrupted payloads.",
    "Report a corrupted record.",
    "Flag tampered data while parsing it.",
    "Reject a payload after changing one byte.",
    "Return false if a payload is corrupted.",
    "A payload is rejected when corrupted.",
    "Reject a bit-flipped payload.",
    "Reject a bit flipped payload.",
  ])("retains proof for observable corruption handling: %s", (instruction) => {
    const result = deriveRequirementProofPolicies(
      [directSource(instruction)],
      [requirement(instruction, `${instruction} after changing the candidate bytes`)],
    );

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toContain("change_artifact_bytes");
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
