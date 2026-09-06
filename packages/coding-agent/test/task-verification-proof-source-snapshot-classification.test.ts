import { describe, expect, it } from "vitest";
import { analyzeProofWitnesses } from "../src/core/task-verification/requirement-proof-witnesses.ts";
import {
  ignoredRequirementSourceIsValid,
  requirementSourceRefsAreValid,
  sourceIdentitiesAreUnique,
} from "../src/core/task-verification/requirement-source-state-validation.ts";
import type {
  RequirementProofPolicy,
  TaskRequirement,
  TaskVerificationRequirementSourceRef,
} from "../src/core/task-verification/types.ts";

describe("proof source and witness classification", () => {
  it("rejects proof frames without an active set and enforces the frame bound", () => {
    const requirements = Array.from({ length: 33 }, (_, index) =>
      proofRequirement(`R${index + 1}`, "change_artifact_bytes"),
    );
    const frames = requirements.map((requirement) => proofLine(requirement, validFacts("change_artifact_bytes")));

    const inactive = analyzeProofWitnesses([{ type: "text", text: frames[0]! }], requirements, undefined, 0);
    expect(inactive.rejectedFrameCount).toBe(1);
    expect(inactive.rejectionDetails[0]).toContain("no active proof requirement set");

    const bounded = analyzeProofWitnesses([{ type: "text", text: frames.join("\n") }], requirements, "set-a", 4);
    expect(bounded.frameCount).toBe(33);
    expect(bounded.witnesses).toHaveLength(32);
    expect(bounded.rejectedFrameCount).toBe(1);
    expect(bounded.rejectionDetails.at(-1)).toContain("32-frame acceptance limit");
  });

  it("reports malformed requirement identities and authoritative policy expectations", () => {
    const requirement = proofRequirement("R1", "preserve_state_on_failure");
    const missingId = JSON.stringify({ policy: requirement.proofPolicies![0], facts: {} });
    const wrongPolicy = proofLine(requirement, { policy: "change_artifact_bytes", facts: {} }, true);
    const result = analyzeProofWitnesses(
      [{ type: "text", text: `P_PROOF_V1 ${missingId}\n${wrongPolicy}` }],
      [requirement],
      "set-a",
      0,
    );

    expect(result.rejectedFrameCount).toBe(2);
    expect(result.rejectionDetails[0]).toContain("requirementId must be a non-empty string");
    expect(result.rejectionDetails[1]).toContain('authoritative expected policy: "preserve_state_on_failure"');
  });

  it("rejects duplicate immutable source identities while accepting distinct ignored sources", () => {
    const reference = sourceReference("source-1", "spec.md", "snapshot-1");
    expect(requirementSourceRefsAreValid([reference], 2)).toBe(true);
    expect(requirementSourceRefsAreValid([{ ...reference, definitionSourcePromptCount: 3 }], 2)).toBe(false);
    expect(sourceIdentitiesAreUnique([reference, reference], [])).toBe(false);
    expect(
      sourceIdentitiesAreUnique(
        [reference],
        [
          { path: "notes.md", reason: "informational" },
          { path: "examples.md", reason: "example", deauthorizedByPromptId: "prompt-2" },
        ],
      ),
    ).toBe(true);
    expect(sourceIdentitiesAreUnique([reference], [{ path: "spec.md", reason: "duplicate" }])).toBe(false);
    expect(ignoredRequirementSourceIsValid({ path: "notes.md", reason: "informational" })).toBe(true);
    expect(ignoredRequirementSourceIsValid({ path: "notes.md", reason: "" })).toBe(false);
  });
});

function proofRequirement(id: string, policy: RequirementProofPolicy): TaskRequirement {
  return {
    id,
    type: "constraint",
    text: "Preserve the proof invariant",
    acceptanceCriterion: "Focused evidence proves the invariant",
    sourcePromptIndexes: [1],
    proofPolicies: [policy],
  };
}

function proofLine(requirement: TaskRequirement, facts: Record<string, unknown>, overridePolicy = false): string {
  return `P_PROOF_V1 ${JSON.stringify({
    requirementId: requirement.id,
    policy: overridePolicy ? "change_artifact_bytes" : requirement.proofPolicies?.[0],
    facts,
  })}`;
}

function validFacts(policy: RequirementProofPolicy): Record<string, unknown> {
  if (policy === "change_artifact_bytes") {
    return { originalBase64: bytes("before"), candidateBase64: bytes("after") };
  }
  return {};
}

function sourceReference(id: string, path: string, snapshotEntryId: string): TaskVerificationRequirementSourceRef {
  return {
    id,
    path,
    sha256: "a".repeat(64),
    byteLength: 10,
    snapshotEntryId,
    referencedByPromptIds: ["prompt-1"],
    definitionSourcePromptCount: 1,
    capturedAtMutationRevision: 0,
    origin: "requirement_audit.prepare_definition",
    policyVersion: 1,
  };
}

function bytes(value: string): string {
  return Buffer.from(value).toString("base64");
}
