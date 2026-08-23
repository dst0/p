import { describe, expect, it } from "vitest";
import { deriveRequirementProofPolicies } from "../src/core/task-verification/requirement-derived-boundaries.ts";
import type { TaskRequirement, TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

describe("requirement proof-policy source domains", () => {
  it("derives exact final-byte proof from a mapped direct universal truncation prompt", () => {
    const sources: TaskVerificationSourcePrompt[] = [
      {
        id: "user",
        kind: "user_prompt",
        text: "Export every log as newline-terminated JSONL. Any log truncation must throw ValidationError.",
      },
    ];
    const result = deriveRequirementProofPolicies(sources, [truncationRequirement("log", [1])]);

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toContain("remove_exact_final_byte");
  });

  it.each(["transaction", "journal", "stream", "history", "packet", "trace", "entry", "entries"])(
    "derives exact final-byte proof for a referenced newline-terminated %s",
    (domain) => {
      const sources: TaskVerificationSourcePrompt[] = [
        {
          id: "spec",
          kind: "referenced_file",
          text: `Each ${domain} is newline-terminated.\nAny ${domain} truncation must throw.`,
        },
      ];
      const requirement = { ...truncationRequirement(domain, [1]), sourceClauseIds: ["S1-C2"] };
      const result = deriveRequirementProofPolicies(sources, [requirement]);

      expect(typeof result).not.toBe("string");
      expect((result as TaskRequirement[])[0]?.proofPolicies).toContain("remove_exact_final_byte");
    },
  );

  it("does not join newline serialization and truncation across artifact domains", () => {
    const sources: TaskVerificationSourcePrompt[] = [
      {
        id: "spec",
        kind: "referenced_file",
        text: "Persist each journal as newline-terminated serialized data.\nAny packet truncation must throw.",
      },
    ];
    const requirement = { ...truncationRequirement("packet", [1]), sourceClauseIds: ["S1-C2"] };
    const result = deriveRequirementProofPolicies(sources, [requirement]);

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toBeUndefined();
  });

  it("does not join direct-prompt serialization and truncation across artifact domains", () => {
    const sources: TaskVerificationSourcePrompt[] = [
      {
        id: "user",
        kind: "user_prompt",
        text: "Persist each journal as newline-terminated serialized data. Any packet truncation must throw.",
      },
    ];
    const result = deriveRequirementProofPolicies(sources, [truncationRequirement("packet", [1])]);

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toBeUndefined();
  });
});

function truncationRequirement(domain: string, sourcePromptIndexes: number[]): TaskRequirement {
  return {
    id: "R1",
    type: "constraint",
    text: `Reject any ${domain} truncation including exact final-byte removal`,
    acceptanceCriterion: "Removing the exact terminal newline final byte is rejected as one case of any truncation",
    sourcePromptIndexes,
  };
}
