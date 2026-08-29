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
  it("rejects unsafe or unbounded persisted test-authoring debt", () => {
    const harness = createRequirementAuditHarness();
    const state = harness.controller.currentState;
    harness.sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, {
      ...state,
      unverifiedTestPaths: ["../outside.test.ts"],
    });

    const restored = createRequirementAuditHarness(harness.sessionManager);
    expect(restored.controller.restoreError).toContain("latest persisted task-verification state is invalid");

    const oversized = createRequirementAuditHarness();
    oversized.sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, {
      ...oversized.controller.currentState,
      unverifiedTestPaths: ["test/a.test.ts", "test/b.test.ts", "test/c.test.ts", "test/d.test.ts"],
    });
    expect(createRequirementAuditHarness(oversized.sessionManager).controller.restoreError).toContain(
      "latest persisted task-verification state is invalid",
    );
  });

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

  it("rejects a legacy partial-verdict cursor because batched audits persist atomically", async () => {
    const harness = createRequirementAuditHarness();
    const { evidenceRef } = await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "The first behavior is complete",
          acceptance_criterion: "Focused evidence proves the first behavior",
          source_prompt_indexes: [1],
        },
        {
          type: "verification",
          text: "The second behavior is complete",
          acceptance_criterion: "Focused evidence proves the second behavior",
          source_prompt_indexes: [1],
        },
      ],
      ignored_source_prompts: [],
    });
    const state = harness.controller.currentState;
    state.requirementAudit.nextRequirementIndex = 1;
    state.requirementAudit.requirements[0]!.verdict = {
      passed: true,
      reason: "Legacy partial verdict",
      evidenceRefs: [evidenceRef],
      mutationRevision: state.mutationRevision,
    };
    harness.sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, state);

    const restored = createRequirementAuditHarness(harness.sessionManager);
    expect(await callTaskVerification(restored.controller, { action: "status" })).toContain(
      "latest persisted task-verification state is invalid",
    );
    expect(restored.controller.currentState.requirementAudit.status).toBe("pending");
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
      verdicts: [
        {
          requirement_id: "R1",
          passed: true,
          reason: "Current focused evidence proves the complete requirement.",
          evidence_refs: [evidenceRef],
        },
      ],
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
