import { describe, expect, it } from "vitest";
import {
  auditVerificationToken,
  beforeAuditTool,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
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

async function verdictBatch(
  harness: ReturnType<typeof createRequirementAuditHarness>,
  outcomes: Array<{ passed: boolean; evidenceRef?: string }>,
): Promise<string> {
  await nextModelTurn(harness);
  return callRequirementAudit(harness.controller, {
    action: "verdict",
    verdicts: outcomes.map((outcome, index) => ({
      requirement_id: `R${index + 1}`,
      passed: outcome.passed,
      reason: outcome.passed
        ? `R${index + 1} is proven by focused evidence.`
        : `R${index + 1} still lacks implementation.`,
      evidence_refs: outcome.evidenceRef ? [outcome.evidenceRef] : undefined,
    })),
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
    expect(defined).toContain("Verify all 3 requirements");

    const failed = await verdictBatch(harness, [{ passed: false }, { passed: true, evidenceRef }, { passed: false }]);
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
    expect(restarted).toContain("Verify all 3 requirements");
    expect(harness.controller.currentState.requirementAudit.requirements.every((item) => !item.verdict)).toBe(true);

    const passed = await verdictBatch(harness, [
      { passed: true, evidenceRef },
      { passed: true, evidenceRef },
      { passed: true, evidenceRef },
    ]);
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
    expect(defined).toContain("Verify all 1 requirements");
    const prematureVerdict = await callRequirementAudit(harness.controller, {
      action: "verdict",
      verdicts: [
        {
          requirement_id: "R1",
          passed: true,
          reason: "Focused evidence passes.",
          evidence_refs: [evidenceRef],
        },
      ],
    });
    expect(prematureVerdict).toContain("Only one requirement-audit transition");
    expect(harness.controller.currentState.requirementAudit.requirements[0]?.verdict).toBeUndefined();
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
    const passed = await verdictBatch(harness, [{ passed: true, evidenceRef }]);
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
