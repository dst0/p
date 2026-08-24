import { describe, expect, it } from "vitest";
import {
  auditEvidenceHandle,
  auditVerificationToken,
  callRequirementAudit,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
  recordAuditToolResult,
} from "./task-requirement-audit-test-harness.ts";

function definitions() {
  return [
    {
      type: "behavior",
      text: "The completion gate blocks premature success",
      acceptance_criterion: "A focused test proves the completion gate",
      source_prompt_indexes: [1],
    },
    {
      type: "constraint",
      text: "The completion token is revision-bound",
      acceptance_criterion: "A focused test proves stale tokens are rejected",
      source_prompt_indexes: [1],
    },
    {
      type: "verification",
      text: "Focused evidence proves the requested behavior",
      acceptance_criterion: "Current focused test evidence is recorded",
      source_prompt_indexes: [1],
    },
  ];
}

function passingVerdicts(evidenceRef: string) {
  return definitions().map((_requirement, index) => ({
    requirement_id: `R${index + 1}`,
    passed: true,
    reason: `Focused evidence proves R${index + 1}.`,
    evidence_refs: [evidenceRef],
  }));
}

async function defineRequirements(
  harness: ReturnType<typeof createRequirementAuditHarness>,
  requirements: ReturnType<typeof definitions> = definitions(),
): Promise<void> {
  await nextModelTurn(harness);
  await callRequirementAudit(harness.controller, {
    action: "define",
    requirements,
    ignored_source_prompts: [],
  });
}

describe("batched requirement-audit verdicts", () => {
  it("instructs the model to submit one complete verdict batch", () => {
    const harness = createRequirementAuditHarness();
    const guidance = harness.controller.toolDefinition.promptGuidelines?.join("\n") ?? "";

    expect(guidance).toContain("one complete evidence-backed verdict batch");
    expect(guidance).not.toContain("one evidence-backed verdict per model turn");
    expect(guidance).toContain("Complete all requested file deliverables before final verification");
  });

  it("records every verdict and issues one certificate in a single atomic transition", async () => {
    const harness = createRequirementAuditHarness();
    const { evidenceRef } = await reachAuditEvidenceReady(harness);
    await defineRequirements(harness);

    await nextModelTurn(harness);
    const result = await callRequirementAudit(harness.controller, {
      action: "verdict",
      verdicts: passingVerdicts(evidenceRef),
    });

    expect(result).toContain("Requirement audit passed: 3/3");
    expect(auditVerificationToken(result)).toBe(harness.controller.currentState.readiness?.token);
    expect(harness.controller.currentState.requirementAudit.requirements.every((item) => item.verdict?.passed)).toBe(
      true,
    );
  });

  it("rejects an incomplete or invalid batch without recording any verdict", async () => {
    const harness = createRequirementAuditHarness();
    const { evidenceRef } = await reachAuditEvidenceReady(harness);
    await defineRequirements(harness, definitions().slice(0, 2));

    await nextModelTurn(harness);
    const unexpected = await callRequirementAudit(harness.controller, {
      action: "verdict",
      verdicts: [
        {
          requirement_id: "R3",
          passed: true,
          reason: "Unexpected requirement.",
          evidence_refs: [evidenceRef],
        },
      ],
    });
    expect(unexpected).toContain("Unexpected verdicts: R3");

    await nextModelTurn(harness);
    const duplicate = await callRequirementAudit(harness.controller, {
      action: "verdict",
      verdicts: [passingVerdicts(evidenceRef)[0], passingVerdicts(evidenceRef)[0], passingVerdicts(evidenceRef)[1]],
    });
    expect(duplicate).toContain("Duplicate verdicts: R1");

    await nextModelTurn(harness);
    const incomplete = await callRequirementAudit(harness.controller, {
      action: "verdict",
      verdicts: passingVerdicts(evidenceRef).slice(0, 1),
    });
    expect(incomplete).toContain("Missing verdicts: R2");
    expect(harness.controller.currentState.requirementAudit.requirements.every((item) => !item.verdict)).toBe(true);

    await nextModelTurn(harness);
    const legacyShape = await callRequirementAudit(harness.controller, {
      action: "verdict",
      requirement_id: "R1",
      passed: true,
      reason: "Legacy single-verdict input must fail closed.",
      evidence_refs: [evidenceRef],
    });
    expect(legacyShape).toContain(
      "verdict does not accept field(s): requirement_id, passed, reason, evidence_refs.",
    );

    await nextModelTurn(harness);
    const unsupportedPass = await callRequirementAudit(harness.controller, {
      action: "verdict",
      verdicts: [
        { requirement_id: "R1", passed: true, reason: "No evidence supplied." },
        passingVerdicts(evidenceRef)[1],
      ],
    });
    expect(unsupportedPass).toContain("R1: a passed verdict requires at least one evidence_refs handle");
    expect(unsupportedPass).toContain("To inspect the complete durable verification state");

    await nextModelTurn(harness);
    const invalidEvidence = await callRequirementAudit(harness.controller, {
      action: "verdict",
      verdicts: [
        passingVerdicts(evidenceRef)[0],
        {
          ...passingVerdicts(evidenceRef)[1],
          evidence_refs: ["verification-evidence-missing"],
        },
      ],
    });
    expect(invalidEvidence).toContain("Unknown evidence handle");
    expect(harness.controller.currentState.requirementAudit.requirements.every((item) => !item.verdict)).toBe(true);

    const failedRead = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "read",
        { path: "missing-proof.txt" },
        { text: "not found", isError: true },
      ),
    );
    await nextModelTurn(harness);
    const failedEvidence = await callRequirementAudit(harness.controller, {
      action: "verdict",
      verdicts: [
        {
          ...passingVerdicts(evidenceRef)[0],
          evidence_refs: [failedRead],
        },
        passingVerdicts(evidenceRef)[1],
      ],
    });
    expect(failedEvidence).toContain("R1: failed evidence cannot support a passed requirement verdict");
    expect(harness.controller.currentState.requirementAudit.requirements.every((item) => !item.verdict)).toBe(true);

    const staleEvidence = auditEvidenceHandle(
      await recordAuditToolResult(harness.agent, "read", { path: "stale-proof.txt" }, { text: "old proof" }),
    );
    harness.controller.evidence.get(staleEvidence)!.mutationRevision = 0;
    await nextModelTurn(harness);
    const mixedStaleBatch = await callRequirementAudit(harness.controller, {
      action: "verdict",
      verdicts: [passingVerdicts(evidenceRef)[0], passingVerdicts(staleEvidence)[1]],
    });
    expect(mixedStaleBatch).toContain("R2: verdict evidence must come from mutation revision 1");
    expect(harness.controller.currentState.requirementAudit.requirements.every((item) => !item.verdict)).toBe(true);

    harness.controller.evidence.get(evidenceRef)!.mutationRevision = 0;
    await nextModelTurn(harness);
    const allStaleBatch = await callRequirementAudit(harness.controller, {
      action: "verdict",
      verdicts: passingVerdicts(staleEvidence).slice(0, 2),
    });
    expect(allStaleBatch).toContain("R1: verdict evidence must come from mutation revision 1");
    expect(allStaleBatch).toContain("R2: verdict evidence must come from mutation revision 1");
    expect(allStaleBatch).toContain("resubmit one complete verdict batch");
    expect(harness.controller.currentState.requirementAudit.requirements.every((item) => !item.verdict)).toBe(true);
  });
});
