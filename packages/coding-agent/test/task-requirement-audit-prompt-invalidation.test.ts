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

async function defineAndPass(
  harness: ReturnType<typeof createRequirementAuditHarness>,
  evidenceRef: string,
): Promise<string> {
  await nextModelTurn(harness);
  await callRequirementAudit(harness.controller, {
    action: "define",
    requirements: [
      {
        type: "behavior",
        text: "The completion gate enforces the requested behavior",
        acceptance_criterion: "Focused evidence passes and premature finish is blocked",
        source_prompt_indexes: [1],
      },
    ],
    ignored_source_prompts: [],
  });
  await nextModelTurn(harness);
  return callRequirementAudit(harness.controller, {
    action: "verdict",
    verdicts: [
      {
        requirement_id: "R1",
        passed: true,
        reason: "Current focused evidence proves the complete requirement.",
        evidence_refs: [evidenceRef],
      },
    ],
  });
}

describe("requirement-audit prompt invalidation", () => {
  it("requires fresh verification when a new user requirement arrives without a file mutation", async () => {
    const harness = createRequirementAuditHarness();
    const { evidenceRef } = await reachAuditEvidenceReady(harness);
    const firstCompletion = await defineAndPass(harness, evidenceRef);
    const firstToken = auditVerificationToken(firstCompletion);
    const firstHash = harness.controller.currentState.readiness?.userRequirementsHash;
    const taskId = harness.controller.currentState.taskId;

    await sendAuditUserPrompt(harness, "Also reject stale certificates after a clarification.", 200);
    expect(harness.controller.currentState.taskId).toBe(taskId);
    expect(harness.controller.currentState.mutationRevision).toBe(1);
    expect(harness.controller.currentState.final.status).toBe("pending");
    expect(harness.controller.currentState.readiness?.status).toBe("pending");
    expect(harness.controller.currentState.requirementAudit.requirements).toEqual([]);
    expect(
      (
        await beforeAuditTool(harness.agent, "finish_work", {
          status: "success",
          verification_token: firstToken,
        })
      )?.block,
    ).toBe(true);

    await nextModelTurn(harness);
    const clarificationEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/stale-certificate.test.ts" },
        { text: "focused stale-certificate rejection passed" },
      ),
    );
    const reverified = await callTaskVerification(harness.controller, {
      action: "record_final",
      final_method: "manual_reproduction",
      final_status: "passed",
      expected_behavior: "The clarified completion gate rejects stale certificates",
      observed_behavior: "Focused evidence proves the clarified behavior",
      evidence_refs: [evidenceRef, clarificationEvidence],
      unresolved_failures: [],
    });
    expect(reverified).toContain("Final semantic verification passed");
    const restarted = await callTaskVerification(harness.controller, {
      action: "ready_to_finish",
      acceptance_checks: [
        { criterion: "The completion gate is enforced", evidence_refs: [evidenceRef] },
        {
          criterion: "Stale certificates are rejected after clarification",
          evidence_refs: [clarificationEvidence],
        },
      ],
      unresolved_failures: [],
    });
    expect(restarted).toContain("Evidence readiness passed");

    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "The completion gate enforces the requested behavior",
          acceptance_criterion: "Focused evidence passes and premature finish is blocked",
          source_prompt_indexes: [1],
        },
        {
          type: "behavior",
          text: "The completion gate rejects certificates issued before a user clarification",
          acceptance_criterion: "A certificate issued before the clarification cannot finish the clarified task",
          source_prompt_indexes: [2],
        },
      ],
      ignored_source_prompts: [],
    });
    await nextModelTurn(harness);
    const secondCompletion = await callRequirementAudit(harness.controller, {
      action: "verdict",
      verdicts: [
        {
          requirement_id: "R1",
          passed: true,
          reason: "Current focused evidence proves the original completion gate.",
          evidence_refs: [evidenceRef],
        },
        {
          requirement_id: "R2",
          passed: true,
          reason: "Fresh focused evidence proves stale-certificate rejection after clarification.",
          evidence_refs: [clarificationEvidence],
        },
      ],
    });
    expect(auditVerificationToken(secondCompletion)).not.toBe(firstToken);
    expect(harness.controller.currentState.readiness?.userRequirementsHash).not.toBe(firstHash);
  });
});
