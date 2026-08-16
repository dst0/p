import { describe, expect, it } from "vitest";
import {
  auditEvidenceHandle,
  auditVerificationToken,
  beforeAuditTool,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  recordAuditToolResult,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("requirement-audit non-code mutations", () => {
  it("requires the completion certificate for a documentation mutation", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(
      harness,
      "Clarify the verification documentation without losing any requested detail.",
      100,
    );
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "docs",
      task_summary: "Clarify verification documentation",
    });
    await recordAuditToolResult(harness.agent, "edit", {
      path: "docs/verification.md",
      edits: [{ oldText: "old", newText: "new" }],
    });
    const first = auditEvidenceHandle(
      await recordAuditToolResult(harness.agent, "read", { path: "docs/verification.md" }),
    );
    const second = auditEvidenceHandle(await recordAuditToolResult(harness.agent, "read", { path: "README.md" }));
    await callTaskVerification(harness.controller, {
      action: "record_final",
      final_method: "static_review",
      final_status: "passed",
      expected_behavior: "The documentation accurately describes verification recovery",
      observed_behavior: "Both relevant documents were inspected after the edit",
      evidence_refs: [first, second],
      unresolved_failures: [],
    });

    expect((await beforeAuditTool(harness.agent, "finish_work", { status: "success" }))?.block).toBe(true);
    const readiness = await callTaskVerification(harness.controller, {
      action: "ready_to_finish",
      acceptance_checks: [
        {
          criterion: "The verification documentation preserves every requested detail",
          evidence_refs: [first, second],
        },
      ],
      unresolved_failures: [],
    });
    expect(readiness).toContain("REQUIREMENT AUDIT");

    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "deliverable",
          text: "Clarify the verification documentation without losing requested detail",
          acceptance_criterion: "The edited documentation remains complete and accurate",
          source_prompt_indexes: [1],
        },
      ],
      ignored_source_prompts: [],
    });
    await nextModelTurn(harness);
    const completed = await callRequirementAudit(harness.controller, {
      action: "verdict",
      requirement_id: "R1",
      passed: true,
      reason: "Two current static inspections prove the documentation is complete and consistent.",
      evidence_refs: [first, second],
    });
    const token = auditVerificationToken(completed);
    expect(
      (
        await beforeAuditTool(harness.agent, "finish_work", {
          status: "success",
          verification_token: token,
        })
      )?.block,
    ).not.toBe(true);
  });
});
