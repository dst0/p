import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { TASK_VERIFICATION_STATE_CUSTOM_TYPE } from "../src/core/task-verification.ts";
import {
  beforeAuditTool,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  recordAuditToolResult,
} from "./task-requirement-audit-test-harness.ts";

describe("restored task-context requirement policy", () => {
  it("defines restored requirements before preserving high-risk baseline guidance", async () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, {
      version: 2,
      taskId: "restored-task",
      taskKind: "bug_fix",
      taskSummary: "Fix the reported issue",
      taskContext: "The daemon restart loses persisted indexing state and recovery repeats work",
      mutationRevision: 0,
      baseline: {
        required: true,
        status: "pending",
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

    const blocked = await beforeAuditTool(harness.agent, "edit", {
      path: "src/daemon.ts",
      edits: [{ oldText: "recover()", newText: "recoverPersistedState()" }],
    });
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain("accepted complete requirement definition");

    const defined = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "The daemon restart preserves persisted indexing state without repeated recovery work",
          acceptance_criterion: "Restart recovery preserves indexing state and does not repeat completed work",
          source_prompt_indexes: [1],
        },
      ],
      ignored_source_prompts: [],
    });
    expect(defined).toContain("Defined 1 atomic requirement");
    await recordAuditToolResult(harness.agent, "read", { path: "src/daemon.ts" });
    await recordAuditToolResult(harness.agent, "read", { path: "src/manifest.ts" });

    const status = await callTaskVerification(harness.controller, { action: "status" });
    expect(status).toContain("lifecycle/durability task");
    expect(status).not.toContain('"baseline_method":"static_trace"');
  });
});
