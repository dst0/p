import { describe, expect, it } from "vitest";
import {
  auditVerificationToken,
  beforeAuditTool,
  callRequirementAudit,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
  recordAuditToolResult,
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

describe("requirement-audit failed-verification invalidation", () => {
  it("invalidates an issued token when a later focused verification fails", async () => {
    const harness = createRequirementAuditHarness();
    const { evidenceRef } = await reachAuditEvidenceReady(harness);
    const token = auditVerificationToken(await defineAndPass(harness, evidenceRef));

    await nextModelTurn(harness);
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "vitest --run test/gate.test.ts" },
      { text: "focused gate regression failed", isError: true },
    );

    expect(harness.controller.currentState).toMatchObject({
      readiness: { status: "pending" },
      requirementAudit: { status: "pending", nextRequirementIndex: 0 },
    });
    expect(harness.controller.currentState.requirementAudit.requirements[0]?.verdict).toBeUndefined();
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
