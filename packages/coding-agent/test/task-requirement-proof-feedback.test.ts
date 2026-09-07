import { describe, expect, it } from "vitest";
import { formatProofWitnessEvidenceFeedback } from "../src/core/task-verification/proof-witness-evidence-feedback.ts";
import { analyzeProofWitnesses } from "../src/core/task-verification/requirement-proof-witnesses.ts";
import type { RequirementProofPolicy, TaskRequirement } from "../src/core/task-verification/types.ts";
import {
  auditEvidenceHandle,
  createRequirementAuditHarness,
  recordAuditToolResult,
} from "./task-requirement-audit-test-harness.ts";

describe("proof witness evidence feedback", () => {
  it("requires one evidence handle to contain every policy for a requirement", async () => {
    const requirement = proofRequirement(["change_artifact_bytes", "remove_exact_final_byte"]);
    const harness = configuredHarness([requirement]);
    const changed = proofLine(requirement.id, "change_artifact_bytes", validFacts("change_artifact_bytes"));
    const invalidTruncation = proofLine(requirement.id, "remove_exact_final_byte", {
      originalBase64: bytes("artifact}"),
      candidateBase64: bytes("artifact"),
      outcome: "threw",
    });

    const partial = await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "vitest --run test/integrity.test.ts" },
      { text: `${changed}\n${invalidTruncation}` },
    );
    expect(partial).toContain("Accepted 1 of 2 P_PROOF_V1 frames; rejected 1");
    expect(partial).toContain('Proof for requirementId "R1" is incomplete on this evidence handle');
    expect(partial).toContain("Rerun the same focused test with every controller-required frame together");
    expect(partial).not.toContain("do not regenerate it");

    const complete = await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "vitest --run test/integrity.test.ts" },
      {
        text: `${changed}\n${proofLine(requirement.id, "remove_exact_final_byte", validFacts("remove_exact_final_byte"))}`,
      },
    );
    const stored = harness.controller.evidence.get(auditEvidenceHandle(complete));
    expect(complete).toContain("Accepted 2 of 2 P_PROOF_V1 frames");
    expect(complete).toContain('Complete proof for requirementId "R1" is stored on this evidence handle');
    expect(complete).toContain("do not regenerate it");
    expect(stored?.proofWitnesses).toHaveLength(2);
  });

  it("keeps complete and incomplete guidance isolated by requirement", async () => {
    const completeRequirement = proofRequirement(["change_artifact_bytes"], "R1");
    const incompleteRequirement = proofRequirement(["change_artifact_bytes", "remove_exact_final_byte"], "R2");
    const harness = configuredHarness([completeRequirement, incompleteRequirement]);
    const result = await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "vitest --run test/integrity.test.ts" },
      {
        text: [
          proofLine("R1", "change_artifact_bytes", validFacts("change_artifact_bytes")),
          proofLine("R2", "change_artifact_bytes", validFacts("change_artifact_bytes")),
          proofLine("R2", "remove_exact_final_byte", { outcome: "threw" }),
        ].join("\n"),
      },
    );

    expect(result).toContain('Complete proof for requirementId "R1" is stored on this evidence handle');
    expect(result).toContain('Proof for requirementId "R2" is incomplete on this evidence handle');
  });

  it("never repeats secrets from rejected requirement IDs or policies", async () => {
    const requirement = proofRequirement(["change_artifact_bytes"]);
    const harness = configuredHarness([requirement]);
    const secretId = "private-proof-id-do-not-return";
    const secretPolicy = "private-proof-policy-do-not-return";

    const result = await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "vitest --run test/integrity.test.ts" },
      {
        text: [
          proofLine(secretId, "change_artifact_bytes", validFacts("change_artifact_bytes")),
          proofLine(requirement.id, secretPolicy, {}),
        ].join("\n"),
      },
    );
    expect(result).not.toContain(secretId);
    expect(result).not.toContain(secretPolicy);
    expect(result).toContain('unknown requirementId; authoritative expected ID: "R1"');
    expect(result).toContain('unknown policy; authoritative expected policy: "change_artifact_bytes"');
  });

  it("bounds accepted and rejected summaries independently", () => {
    const requirements = Array.from({ length: 6 }, (_, index) =>
      proofRequirement(["change_artifact_bytes"], `R${index + 1}`),
    );
    const validFrames = requirements.map((requirement) =>
      proofLine(requirement.id, "change_artifact_bytes", validFacts("change_artifact_bytes")),
    );
    const rejectedFrames = Array.from({ length: 10 }, (_, index) =>
      proofLine(`untrusted-${index}`, "change_artifact_bytes", validFacts("change_artifact_bytes")),
    );
    const analysis = analyzeProofWitnesses(
      [{ type: "text", text: [...validFrames, ...rejectedFrames].join("\n") }],
      requirements,
      "proof-set",
      3,
    );
    const feedback = formatProofWitnessEvidenceFeedback(analysis, requirements);

    expect(analysis.rejectionDetails).toHaveLength(8);
    expect(feedback).toContain("Accepted 6 of 16 P_PROOF_V1 frames; rejected 10");
    expect(feedback).toContain("2 additional accepted frames omitted");
    expect(feedback).toContain("2 additional accepted requirement guidance entries omitted");
    expect(feedback).toContain("2 additional rejection reasons omitted");
    expect(feedback).not.toContain("untrusted-0");
  });

  it("diagnoses duplicate, empty, oversized, and inactive-set frames", () => {
    const requirement = proofRequirement(["change_artifact_bytes"]);
    const valid = proofLine(requirement.id, "change_artifact_bytes", validFacts("change_artifact_bytes"));
    const duplicate = analyzeProofWitnesses([{ type: "text", text: `${valid}\n${valid}` }], [requirement], "set", 0);
    const empty = analyzeProofWitnesses([{ type: "text", text: "P_PROOF_V1 " }], [requirement], "set", 0);
    const oversized = analyzeProofWitnesses(
      [{ type: "text", text: `P_PROOF_V1 ${"x".repeat(12_289)}` }],
      [requirement],
      "set",
      0,
    );
    const inactive = analyzeProofWitnesses([{ type: "text", text: valid }], [requirement], undefined, 0);

    expect(duplicate.rejectionDetails).toEqual([
      'Frame 2 rejected: duplicate requirementId "R1" with policy "change_artifact_bytes"',
    ]);
    expect(empty.rejectionDetails).toEqual(["Frame 1 rejected: the JSON payload is empty"]);
    expect(oversized.rejectionDetails).toEqual(["Frame 1 rejected: the JSON payload exceeds 12288 bytes"]);
    expect(inactive.rejectionDetails).toEqual(["Frame 1 rejected: the controller has no active proof requirement set"]);
  });
});

function configuredHarness(requirements: TaskRequirement[]) {
  const harness = createRequirementAuditHarness();
  harness.controller.state.requirementAudit = {
    status: "verifying",
    requirements,
    ignoredSourcePrompts: [],
    nextRequirementIndex: 0,
    userRequirementsHash: "user-set",
    requirementSetHash: "proof-set",
  };
  return harness;
}

function proofRequirement(policies: RequirementProofPolicy[], id = "R1"): TaskRequirement {
  return {
    id,
    type: "constraint",
    text: "Preserve the integrity invariant",
    acceptanceCriterion: "Focused evidence proves the invariant",
    sourcePromptIndexes: [1],
    proofPolicies: policies,
  };
}

function proofLine(requirementId: string, policy: string, facts: Record<string, unknown>): string {
  return `P_PROOF_V1 ${JSON.stringify({ requirementId, policy, facts })}`;
}

function validFacts(policy: RequirementProofPolicy): Record<string, unknown> {
  if (policy === "remove_exact_final_byte") {
    return { originalBase64: bytes("artifact\n"), candidateBase64: bytes("artifact"), outcome: "threw" };
  }
  return { originalBase64: bytes("artifact"), candidateBase64: bytes("changed") };
}

function bytes(value: string): string {
  return Buffer.from(value).toString("base64");
}
