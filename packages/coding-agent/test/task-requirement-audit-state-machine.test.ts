import { describe, expect, it } from "vitest";
import {
  auditEvidenceHandle,
  auditVerificationToken,
  beforeAuditTool,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
  recordAuditToolResult,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

function definitions() {
  return [
    {
      type: "behavior",
      text: "The completion gate blocks premature success",
      acceptance_criterion: "finish_work is blocked before the audit passes",
      source_prompt_indexes: [1],
    },
    {
      type: "constraint",
      text: "The completion token is revision-bound",
      acceptance_criterion: "A stale or incorrect token is rejected",
      source_prompt_indexes: [1],
    },
    {
      type: "verification",
      text: "Focused evidence proves the gate behavior",
      acceptance_criterion: "A current focused test evidence handle exists",
      source_prompt_indexes: [1],
    },
  ];
}

async function verdict(
  harness: ReturnType<typeof createRequirementAuditHarness>,
  requirementId: string,
  passed: boolean,
  evidenceRef?: string,
): Promise<string> {
  await nextModelTurn(harness);
  return callRequirementAudit(harness.controller, {
    action: "verdict",
    requirement_id: requirementId,
    passed,
    reason: passed ? `${requirementId} is proven by focused evidence.` : `${requirementId} still lacks implementation.`,
    evidence_refs: evidenceRef ? [evidenceRef] : undefined,
  });
}

describe("requirement-audit state machine", () => {
  it("checks every requirement after failures and issues a token only after a complete passing rerun", async () => {
    const harness = createRequirementAuditHarness();
    const { evidenceRef } = await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    const defined = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: definitions(),
      ignored_source_prompts: [],
    });
    expect(defined).toContain("Verify requirement R1 (1/3)");

    expect(await verdict(harness, "R1", false)).toContain("Verify requirement R2 (2/3)");
    expect(await verdict(harness, "R2", true, evidenceRef)).toContain("Verify requirement R3 (3/3)");
    const failed = await verdict(harness, "R3", false);
    expect(failed).toContain("Requirement audit failed: 2/3");
    expect(failed).toContain("R1: The completion gate blocks premature success");
    expect(failed).toContain("R3: Focused evidence proves the gate behavior");
    expect(failed).not.toContain("verification_token:");
    expect(harness.controller.currentState.requirementAudit.requirements).toHaveLength(3);
    expect((await beforeAuditTool(harness.agent, "finish_work", { status: "success" }))?.block).toBe(true);

    await nextModelTurn(harness);
    const restarted = await callTaskVerification(harness.controller, {
      action: "ready_to_finish",
      acceptance_checks: [{ criterion: "The completion gate is enforced", evidence_refs: [evidenceRef] }],
      unresolved_failures: [],
    });
    expect(restarted).toContain("Reusing the existing 3-item requirement set");
    expect(restarted).toContain("Verify requirement R1 (1/3)");
    expect(harness.controller.currentState.requirementAudit.requirements.every((item) => !item.verdict)).toBe(true);

    await verdict(harness, "R1", true, evidenceRef);
    await verdict(harness, "R2", true, evidenceRef);
    const passed = await verdict(harness, "R3", true, evidenceRef);
    const token = auditVerificationToken(passed);
    const readiness = harness.controller.currentState.readiness;
    expect(readiness).toMatchObject({
      status: "completion_ready",
      token,
      verifiedMutationRevision: 1,
    });
    expect(readiness?.userRequirementsHash).toHaveLength(64);
    expect(readiness?.requirementSetHash).toHaveLength(64);
    expect(readiness?.certificateHash).toHaveLength(64);
    expect(
      (
        await beforeAuditTool(harness.agent, "finish_work", {
          status: "success",
          verification_token: token,
        })
      )?.block,
    ).not.toBe(true);
    expect(
      (
        await beforeAuditTool(harness.agent, "finish_work", {
          status: "success",
          verification_token: "wrong-token",
        })
      )?.block,
    ).toBe(true);
  });

  it("requires every source prompt to be referenced or explicitly ignored", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await sendAuditUserPrompt(harness, "What is the current status?", 200);
    const currentHashInvalidation = await callTaskVerification(harness.controller, { action: "status" });
    expect(currentHashInvalidation).toContain("Requirement audit");

    await nextModelTurn(harness);
    await callTaskVerification(harness.controller, {
      action: "ready_to_finish",
      acceptance_checks: [
        {
          criterion: "The completion gate is enforced",
          evidence_refs: [harness.controller.currentState.final.evidenceRefs[0]],
        },
      ],
      unresolved_failures: [],
    });
    await nextModelTurn(harness);
    const incomplete = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [definitions()[0]],
      ignored_source_prompts: [],
    });
    expect(incomplete).toContain("unclassified indexes: 2");

    await nextModelTurn(harness);
    const complete = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [definitions()[0]],
      ignored_source_prompts: [{ source_prompt_index: 2, reason: "Status question, not a task requirement" }],
    });
    expect(complete).toContain("Defined 1 atomic requirement");
    expect(harness.controller.currentState.requirementAudit.requirements[0]?.id).toBe("R1");
  });

  it("rejects precomputed audit transitions from the same assistant turn", async () => {
    const harness = createRequirementAuditHarness();
    const { evidenceRef } = await reachAuditEvidenceReady(harness);
    const prematureDefinition = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [definitions()[0]],
      ignored_source_prompts: [],
    });
    expect(prematureDefinition).toContain("Only one requirement-audit transition");

    await nextModelTurn(harness);
    const defined = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [definitions()[0]],
      ignored_source_prompts: [],
    });
    expect(defined).toContain("Verify requirement R1");
    const prematureVerdict = await callRequirementAudit(harness.controller, {
      action: "verdict",
      requirement_id: "R1",
      passed: true,
      reason: "Focused evidence passes.",
      evidence_refs: [evidenceRef],
    });
    expect(prematureVerdict).toContain("Only one requirement-audit transition");
    expect(harness.controller.currentState.requirementAudit.requirements[0]?.verdict).toBeUndefined();
  });

  it("enforces controller order and rejects unsupported passed verdicts", async () => {
    const harness = createRequirementAuditHarness();
    const { evidenceRef } = await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: definitions().slice(0, 2),
      ignored_source_prompts: [],
    });

    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, {
        action: "verdict",
        requirement_id: "R2",
        passed: true,
        reason: "Attempted out of order.",
        evidence_refs: [evidenceRef],
      }),
    ).toContain("Expected verdict for R1");

    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, {
        action: "verdict",
        requirement_id: "R1",
        passed: true,
        reason: "No evidence supplied.",
      }),
    ).toContain("requires at least one evidence_refs handle");

    await nextModelTurn(harness);
    const failedRead = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "read",
        { path: "missing-proof.txt" },
        { text: "not found", isError: true },
      ),
    );
    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, {
        action: "verdict",
        requirement_id: "R1",
        passed: true,
        reason: "Failed inspection cannot prove success.",
        evidence_refs: [failedRead],
      }),
    ).toContain("Failed evidence cannot support a passed requirement verdict");

    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, {
        action: "verdict",
        requirement_id: "R1",
        passed: true,
        reason: "Current focused evidence proves the first requirement.",
        evidence_refs: [evidenceRef],
      }),
    ).toContain("Verify requirement R2 (2/2)");
  });

  it("rejects a token when certificate fields or the canonical requirement set are corrupted", async () => {
    const harness = createRequirementAuditHarness();
    const { evidenceRef } = await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [definitions()[0]],
      ignored_source_prompts: [],
    });
    const passed = await verdict(harness, "R1", true, evidenceRef);
    const token = auditVerificationToken(passed);
    const certificateHash = harness.controller.state.readiness?.certificateHash;
    if (!certificateHash) throw new Error("missing completion certificate hash");

    const verdictState = harness.controller.state.requirementAudit.requirements[0]!.verdict;
    harness.controller.state.requirementAudit.requirements[0]!.verdict = undefined;
    expect(
      (
        await beforeAuditTool(harness.agent, "finish_work", {
          status: "success",
          verification_token: token,
        })
      )?.block,
    ).toBe(true);
    harness.controller.state.requirementAudit.requirements[0]!.verdict = verdictState;

    harness.controller.state.readiness!.certificateHash = "corrupted";
    expect(
      (
        await beforeAuditTool(harness.agent, "finish_work", {
          status: "success",
          verification_token: token,
        })
      )?.block,
    ).toBe(true);

    harness.controller.state.readiness!.certificateHash = certificateHash;
    harness.controller.state.requirementAudit.requirements[0]!.acceptanceCriterion = "tampered criterion";
    expect(
      (
        await beforeAuditTool(harness.agent, "finish_work", {
          status: "success",
          verification_token: token,
        })
      )?.block,
    ).toBe(true);
  });
});
