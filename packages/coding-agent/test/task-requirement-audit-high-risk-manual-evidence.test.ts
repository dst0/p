import { describe, expect, it } from "vitest";
import {
  auditEvidenceHandle,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  recordAuditToolResult,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

async function completeManualEvidenceAudit(command: string): Promise<string> {
  const harness = createRequirementAuditHarness();
  await sendAuditUserPrompt(harness, "Ensure daemon restart preserves transaction integrity.", 100);
  await callTaskVerification(harness.controller, {
    action: "declare_task",
    task_kind: "feature",
    task_summary: "Preserve transaction integrity across daemon restart",
  });
  await recordAuditToolResult(harness.agent, "edit", {
    path: "src/recovery.ts",
    edits: [{ oldText: "old", newText: "new" }],
  });
  const reproduction = auditEvidenceHandle(
    await recordAuditToolResult(harness.agent, "bash", { command }, { text: "claimed restart result" }),
  );
  await callTaskVerification(harness.controller, {
    action: "record_final",
    final_method: "manual_reproduction",
    final_status: "passed",
    evidence_refs: [reproduction],
    unresolved_failures: [],
  });
  await callTaskVerification(harness.controller, {
    action: "ready_to_finish",
    acceptance_checks: [{ criterion: "Restart preserves transaction integrity", evidence_refs: [reproduction] }],
    unresolved_failures: [],
  });
  await nextModelTurn(harness);
  await callRequirementAudit(harness.controller, {
    action: "define",
    requirements: [
      {
        type: "behavior",
        text: "Daemon restart preserves transaction integrity",
        acceptance_criterion: "The targeted restart reproduction preserves the transaction",
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
        reason: "The current final evidence is claimed as a restart reproduction.",
        evidence_refs: [reproduction],
      },
    ],
  });
}

describe("high-risk manual requirement evidence", () => {
  it("rejects manual evidence even when its command claims the exact invariant", async () => {
    for (const command of [
      "echo ok",
      "true",
      "node scripts/noop.js",
      "uname -a",
      "node scripts/reproduce-daemon-restart-transaction-integrity.js",
    ]) {
      expect(await completeManualEvidenceAudit(command)).toContain("requires focused executable evidence");
    }
  });
});
