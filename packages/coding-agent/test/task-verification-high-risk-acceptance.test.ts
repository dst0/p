import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { TASK_VERIFICATION_STATE_CUSTOM_TYPE } from "../src/core/task-verification.ts";
import {
  callTaskVerification,
  createRequirementAuditHarness,
  recordAuditToolResult,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("task verification high-risk acceptance guidance", () => {
  it("uses a later user clarification when deciding whether broad tests need an acceptance audit", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(harness, "Add export result validation.", 100);
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Add export result validation",
    });
    await sendAuditUserPrompt(harness, "It must reject every partial write after a crash.", 200);
    await recordAuditToolResult(harness.agent, "edit", {
      path: "src/export-result.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });

    const broadOutput = await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "npm run test:unit" },
      { text: "all unit tests passed" },
    );

    expect(broadOutput).toContain("HIGH-RISK ACCEPTANCE AUDIT REQUIRED");
    expect(broadOutput).toContain("Add and run one focused test at a time");
    expect(broadOutput).toContain("Fix a failing focused test before creating another test file");
    expect(broadOutput).toContain("Defer optional test breadth until requested final checks are green");
  });

  it("preserves legacy task context for high-risk guidance after restoration", async () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, {
      version: 2,
      taskId: "restored-high-risk-task",
      taskKind: "feature",
      taskSummary: "Add export result validation",
      taskContext: "Reject partial writes after a crash and preserve transactional recovery",
      mutationRevision: 1,
      baseline: {
        required: false,
        status: "not_required",
        evidenceRefs: [],
        authorizedTestPaths: [],
        testSetupChanged: false,
      },
      final: { status: "pending", evidenceRefs: [], unresolvedFailures: [] },
      requirementAudit: {
        status: "pending",
        requirements: [],
        ignoredSourcePrompts: [],
        nextRequirementIndex: 0,
      },
      updatedAt: new Date().toISOString(),
    });
    const harness = createRequirementAuditHarness(sessionManager);

    const broadOutput = await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "npm run test:unit" },
      { text: "all unit tests passed" },
    );

    expect(broadOutput).toContain("HIGH-RISK ACCEPTANCE AUDIT REQUIRED");
  });
});
