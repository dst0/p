import { describe, expect, it } from "vitest";
import { TASK_VERIFICATION_STATE_CUSTOM_TYPE } from "../src/core/task-verification.ts";
import {
  auditVerificationToken,
  beforeAuditTool,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
} from "./task-requirement-audit-test-harness.ts";

describe("requirement-audit corrupted restoration", () => {
  it("rejects a structurally incomplete latest state without crashing status", async () => {
    const harness = createRequirementAuditHarness();
    harness.sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, {
      version: 2,
      taskId: "corrupted-task",
      mutationRevision: 1,
      baseline: { authorizedTestPaths: [], testSetupChanged: false },
      final: {},
      requirementAudit: { requirements: [] },
    });

    const restored = createRequirementAuditHarness(harness.sessionManager);
    const status = await callTaskVerification(restored.controller, { action: "status" });
    expect(status).toContain("Task: undeclared");
    expect(status).toContain("latest persisted task-verification state is invalid");
    expect(restored.controller.currentState.mutationRevision).toBe(0);
  });

  it("does not fall back to an older completion certificate when the latest state is invalid", async () => {
    const harness = createRequirementAuditHarness();
    const { evidenceRef } = await reachAuditEvidenceReady(harness);
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
    const completion = await callRequirementAudit(harness.controller, {
      action: "verdict",
      requirement_id: "R1",
      passed: true,
      reason: "Current focused evidence proves the complete requirement.",
      evidence_refs: [evidenceRef],
    });
    const staleToken = auditVerificationToken(completion);
    harness.sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, {
      version: 2,
      taskId: "corrupted-latest-state",
    });

    const restored = createRequirementAuditHarness(harness.sessionManager);
    const finish = await beforeAuditTool(restored.agent, "finish_work", {
      status: "success",
      summary: "must not use an older certificate",
      verification_token: staleToken,
    });
    expect(finish?.block).toBe(true);
    expect(finish?.reason).toContain("latest persisted task-verification state is invalid");
    expect(restored.controller.currentState.readiness?.status).toBe("pending");
  });

  it("rejects well-shaped readiness that claims success without evidence", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    const state = harness.controller.currentState;
    harness.sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, {
      ...state,
      final: { ...state.final, evidenceRefs: [] },
      readiness: { ...state.readiness, acceptanceChecks: [] },
    });

    const restored = createRequirementAuditHarness(harness.sessionManager);
    const commit = await beforeAuditTool(restored.agent, "bash", { command: "git commit -m bypass" });
    expect(commit?.block).toBe(true);
    expect(commit?.reason).toContain("latest persisted task-verification state is invalid");
  });

  it("re-resolves persisted baseline evidence before publication", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    const state = harness.controller.currentState;
    harness.sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, {
      ...state,
      baseline: {
        ...state.baseline,
        required: true,
        status: "satisfied",
        hypothesis: "The baseline behavior is observable.",
        conclusion: "The baseline behavior was reproduced.",
        method: "runtime_reproduction",
        evidenceRefs: ["missing-baseline-evidence"],
      },
    });

    const restored = createRequirementAuditHarness(harness.sessionManager);
    const commit = await beforeAuditTool(restored.agent, "bash", { command: "git commit -m bypass" });
    expect(commit?.block).toBe(true);
    expect(commit?.reason).toContain("baseline verification evidence is missing or stale");
  });

  it("re-resolves persisted final evidence before publication", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    const state = harness.controller.currentState;
    harness.sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, {
      ...state,
      final: { ...state.final, evidenceRefs: ["missing-final-evidence"] },
    });

    const restored = createRequirementAuditHarness(harness.sessionManager);
    const commit = await beforeAuditTool(restored.agent, "bash", { command: "git commit -m bypass" });
    expect(commit?.block).toBe(true);
    expect(commit?.reason).toContain("semantic verification evidence is missing, failed, or stale");
  });

  it("re-resolves persisted acceptance evidence before publication", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    const state = harness.controller.currentState;
    const readiness = state.readiness!;
    harness.sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, {
      ...state,
      readiness: {
        ...readiness,
        acceptanceChecks: readiness.acceptanceChecks.map((check, index) =>
          index === 0 ? { ...check, evidenceRefs: ["missing-acceptance-evidence"] } : check,
        ),
      },
    });

    const restored = createRequirementAuditHarness(harness.sessionManager);
    const commit = await beforeAuditTool(restored.agent, "bash", { command: "git commit -m bypass" });
    expect(commit?.block).toBe(true);
    expect(commit?.reason).toContain("acceptance evidence");
    expect(commit?.reason).toContain("missing, failed, or stale");
  });

  it("blocks in-memory readiness tampering without acceptance checks", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    const readiness = harness.controller.state.readiness!;
    harness.controller.state = {
      ...harness.controller.state,
      readiness: { ...readiness, acceptanceChecks: [] },
    };

    const commit = await beforeAuditTool(harness.agent, "bash", { command: "git commit -m bypass" });
    expect(commit?.block).toBe(true);
    expect(commit?.reason).toContain("readiness has no evidence-backed acceptance checks");
  });
});
