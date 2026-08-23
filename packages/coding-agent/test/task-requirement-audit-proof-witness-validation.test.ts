import { describe, expect, it } from "vitest";
import {
  collectProofWitnesses,
  evidenceHasProofWitnesses,
  redactProofFrames,
} from "../src/core/task-verification/requirement-proof-witnesses.ts";
import type {
  RequirementProofPolicy,
  TaskRequirement,
  TaskVerificationEvidence,
} from "../src/core/task-verification/types.ts";
import {
  auditEvidenceHandle,
  createRequirementAuditHarness,
  recordAuditToolResult,
} from "./task-requirement-audit-test-harness.ts";

describe("requirement proof witness validation", () => {
  it("accepts changed rejected artifacts and rejects no-op corruption", () => {
    const requirement = proofRequirement("change_artifact_bytes");
    expect(
      witnesses(requirement, {
        originalBase64: bytes("artifact"),
        candidateBase64: bytes("artifact"),
        outcome: "threw",
      }),
    ).toBeUndefined();
    expect(
      witnesses(requirement, {
        originalBase64: bytes("artifact"),
        candidateBase64: bytes("artifacX"),
        outcome: "threw",
      }),
    ).toHaveLength(1);
  });

  it("requires a failed operation and equal snapshots for rollback", () => {
    const requirement = proofRequirement("preserve_log_on_failure");
    expect(
      witnesses(requirement, {
        beforeBase64: bytes("event\n"),
        afterFailureBase64: bytes("event\n"),
      }),
    ).toBeUndefined();
    expect(
      witnesses(requirement, {
        beforeBase64: bytes("event\n"),
        afterFailureBase64: bytes("changed\n"),
        failedOutcome: "threw",
      }),
    ).toBeUndefined();
    expect(
      witnesses(requirement, {
        beforeBase64: bytes(""),
        afterFailureBase64: bytes(""),
        failedOutcome: "threw",
      }),
    ).toHaveLength(1);
  });

  it("requires failure, successful retry, and an exact one-step counter transition", () => {
    const requirement = proofRequirement("preserve_version_on_failure");
    expect(witnesses(requirement, { before: 4, afterFailure: 4, afterSuccess: 5 })).toBeUndefined();
    expect(
      witnesses(requirement, {
        before: 4,
        afterFailure: 5,
        afterSuccess: 6,
        failedOutcome: "threw",
        successOutcome: "succeeded",
      }),
    ).toBeUndefined();
    expect(
      witnesses(requirement, {
        before: 4,
        afterFailure: 4,
        afterSuccess: 6,
        failedOutcome: "threw",
        successOutcome: "succeeded",
      }),
    ).toBeUndefined();
    expect(
      witnesses(requirement, {
        before: 4,
        afterFailure: 4,
        afterSuccess: 5,
        failedOutcome: "threw",
        successOutcome: "succeeded",
      }),
    ).toHaveLength(1);
  });

  it("requires the same command identity to fail and then succeed", () => {
    const requirement = proofRequirement("preserve_command_identity_on_failure");
    expect(
      witnesses(requirement, {
        failedIdentity: "command-a",
        retryIdentity: "command-b",
        failedOutcome: "threw",
        retryOutcome: "succeeded",
      }),
    ).toBeUndefined();
    expect(
      witnesses(requirement, {
        failedIdentity: "command-a",
        retryIdentity: "command-a",
        failedOutcome: "threw",
        retryOutcome: "succeeded",
      }),
    ).toHaveLength(1);
  });

  it("binds witnesses to the current requirement set and mutation revision", () => {
    const requirement = proofRequirement("change_artifact_bytes");
    const proofWitnesses = witnesses(
      requirement,
      {
        originalBase64: bytes("artifact"),
        candidateBase64: bytes("changed"),
        outcome: "threw",
      },
      "set-a",
      3,
    );
    const current = evidence(proofWitnesses, 3);

    expect(evidenceHasProofWitnesses(current, requirement, "set-a")).toBe(true);
    expect(evidenceHasProofWitnesses(current, requirement, "set-b")).toBe(false);
    expect(evidenceHasProofWitnesses(evidence(proofWitnesses, 4), requirement, "set-a")).toBe(false);
  });

  it("redacts proof payloads before evidence is stored or returned to the model", async () => {
    const harness = createRequirementAuditHarness();
    const requirement = proofRequirement("change_artifact_bytes");
    harness.controller.state.requirementAudit = {
      status: "verifying",
      requirements: [requirement],
      ignoredSourcePrompts: [],
      nextRequirementIndex: 0,
      userRequirementsHash: "user-set",
      requirementSetHash: "proof-set",
    };
    const secretValue = "private-proof-payload";
    const frame = proofLine(requirement, {
      originalBase64: bytes(secretValue),
      candidateBase64: bytes("changed-proof-payload"),
      outcome: "threw",
    });

    const result = await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "vitest --run test/integrity.test.ts" },
      { text: `Tests 1 passed\n${frame}` },
    );
    const ref = auditEvidenceHandle(result);
    const stored = harness.controller.evidence.get(ref);

    expect(result).not.toContain(secretValue);
    expect(result).not.toContain(frame);
    expect(result).toContain("[proof witness payload omitted]");
    expect(stored?.outputSummary).not.toContain(secretValue);
    expect(stored?.proofWitnesses).toHaveLength(1);
  });

  it("redacts every proof-bearing text line without changing unrelated output", () => {
    const redacted = redactProofFrames([
      { type: "text", text: `before\n${proofLine(proofRequirement("change_artifact_bytes"), {})}\nafter` },
    ]);
    expect(redacted).toEqual([{ type: "text", text: "before\n[proof witness payload omitted]\nafter" }]);
  });

  it("reports a rejected proof frame immediately instead of waiting for the verdict", async () => {
    const harness = createRequirementAuditHarness();
    const requirement = proofRequirement("remove_exact_final_byte");
    harness.controller.state.requirementAudit = {
      status: "verifying",
      requirements: [requirement],
      ignoredSourcePrompts: [],
      nextRequirementIndex: 0,
      userRequirementsHash: "user-set",
      requirementSetHash: "proof-set",
    };
    const invalidFrame = proofLine(requirement, {
      originalBase64: bytes("malformed}"),
      candidateBase64: bytes("malformed"),
      outcome: "threw",
    });

    const result = await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "vitest --run test/integrity.test.ts" },
      { text: `Tests 1 passed\n${invalidFrame}` },
    );
    const stored = harness.controller.evidence.get(auditEvidenceHandle(result));

    expect(result).toContain("Recorded 0 of 1 P_PROOF_V1 frames");
    expect(result).toContain("rejected or duplicate");
    expect(stored?.proofWitnesses).toBeUndefined();
  });
});

function proofRequirement(policy: RequirementProofPolicy): TaskRequirement {
  return {
    id: "R1",
    type: "constraint",
    text: "Preserve the integrity invariant",
    acceptanceCriterion: "Focused evidence proves the invariant",
    sourcePromptIndexes: [1],
    proofPolicies: [policy],
  };
}

function witnesses(
  requirement: TaskRequirement,
  facts: Record<string, unknown>,
  requirementSetHash = "proof-set",
  mutationRevision = 0,
) {
  return collectProofWitnesses(
    [{ type: "text", text: proofLine(requirement, facts) }],
    [requirement],
    requirementSetHash,
    mutationRevision,
  );
}

function proofLine(requirement: TaskRequirement, facts: Record<string, unknown>): string {
  return `P_PROOF_V1 ${JSON.stringify({
    requirementId: requirement.id,
    policy: requirement.proofPolicies?.[0],
    facts,
  })}`;
}

function bytes(value: string): string {
  return Buffer.from(value).toString("base64");
}

function evidence(
  proofWitnesses: TaskVerificationEvidence["proofWitnesses"],
  mutationRevision: number,
): TaskVerificationEvidence {
  return {
    version: 2,
    taskId: "task",
    ref: "verification-evidence-1",
    toolCallId: "bash-1",
    toolName: "bash",
    descriptor: "vitest --run test/integrity.test.ts",
    outputSummary: "Tests 1 passed",
    proofWitnesses,
    isError: false,
    mutationRevision,
    timestamp: "2026-08-23T00:00:00.000Z",
  };
}
