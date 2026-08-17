import { describe, expect, it } from "vitest";
import {
  auditEvidenceHandle,
  auditVerificationToken,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  recordAuditToolResult,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("requirement-audit exact baseline replay", () => {
  it("preserves an active audit when the exact regression is replayed again", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(harness, "Fix the exact replay regression and preserve its completion audit.", 100);
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix the exact replay regression and preserve its completion audit",
    });
    await callTaskVerification(harness.controller, {
      action: "authorize_baseline_test",
      test_paths: ["test/exact-replay.test.ts"],
    });
    await recordAuditToolResult(harness.agent, "edit", {
      path: "test/exact-replay.test.ts",
      edits: [{ oldText: "old", newText: "failing regression" }],
    });
    const command = "vitest --run test/exact-replay.test.ts";
    const baselineEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command },
        { isError: true, text: "expected baseline failure" },
      ),
    );
    await callTaskVerification(harness.controller, {
      action: "record_baseline",
      baseline_method: "failing_regression_test",
      hypothesis: "The current implementation violates the replay contract",
      conclusion: "The focused regression reproduces the defect",
      evidence_refs: [baselineEvidence],
      unresolved_assumptions: [],
    });
    await recordAuditToolResult(harness.agent, "edit", {
      path: "src/exact-replay.ts",
      edits: [{ oldText: "old", newText: "fixed" }],
    });
    const finalEvidence = auditEvidenceHandle(
      await recordAuditToolResult(harness.agent, "bash", { command }, { text: "exact replay passed" }),
    );
    await callTaskVerification(harness.controller, {
      action: "ready_to_finish",
      acceptance_checks: [{ criterion: "The exact regression passes", evidence_refs: [finalEvidence] }],
      unresolved_failures: [],
    });
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "The exact regression remains fixed",
          acceptance_criterion: "The authorized exact replay passes",
          source_prompt_indexes: [1],
        },
      ],
      ignored_source_prompts: [],
    });

    await nextModelTurn(harness);
    const replay = await recordAuditToolResult(
      harness.agent,
      "bash",
      { command },
      { text: "exact replay still passes" },
    );
    expect(replay).toContain("active requirement audit remains valid");
    expect(harness.controller.currentState).toMatchObject({
      readiness: { status: "evidence_ready" },
      requirementAudit: { status: "verifying", nextRequirementIndex: 0 },
    });

    await nextModelTurn(harness);
    const verdict = await callRequirementAudit(harness.controller, {
      action: "verdict",
      requirement_id: "R1",
      passed: true,
      reason: "The repeated exact replay proves the regression remains fixed.",
      evidence_refs: [finalEvidence],
    });
    expect(auditVerificationToken(verdict)).toBeTruthy();
  });
});
