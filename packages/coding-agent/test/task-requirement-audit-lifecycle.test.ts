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

function oneRequirement(sourcePromptIndexes: number[] = [1]) {
  return [
    {
      type: "behavior",
      text: "The completion gate enforces the requested behavior",
      acceptance_criterion: "Focused evidence passes and premature finish is blocked",
      source_prompt_indexes: sourcePromptIndexes,
    },
  ];
}

async function defineAndPass(
  harness: ReturnType<typeof createRequirementAuditHarness>,
  evidenceRef: string,
  sourcePromptIndexes: number[] = [1],
): Promise<string> {
  await nextModelTurn(harness);
  await callRequirementAudit(harness.controller, {
    action: "define",
    requirements: oneRequirement(sourcePromptIndexes),
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

describe("requirement-audit lifecycle", () => {
  it("reuses the policy-v1 upfront requirement definition after mutation without redefining it", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(harness, "Add a completion gate backed by focused verification.", 100);
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Add a completion gate backed by focused verification",
    });
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: oneRequirement(),
      ignored_source_prompts: [],
    });
    const definedHash = harness.controller.currentState.requirementAudit.userRequirementsHash;
    const definedSetHash = harness.controller.currentState.requirementAudit.requirementSetHash;
    expect(harness.controller.currentState).toMatchObject({
      mutationRevision: 0,
      requirementDefinitionPolicy: 1,
      requirementAudit: { status: "verifying", nextRequirementIndex: 0 },
    });

    await nextModelTurn(harness);
    await recordAuditToolResult(harness.agent, "edit", {
      path: "src/gate.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
    expect(harness.controller.currentState).toMatchObject({
      mutationRevision: 1,
      final: { status: "pending" },
      readiness: { status: "pending" },
      requirementAudit: { status: "pending", nextRequirementIndex: 0 },
    });
    expect(harness.controller.currentState.requirementAudit.requirements[0]?.id).toBe("R1");
    expect(harness.controller.currentState.requirementAudit.requirements[0]?.verdict).toBeUndefined();
    const freshEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/gate.test.ts" },
        { text: "focused gate tests passed after mutation" },
      ),
    );
    const readiness = await callTaskVerification(harness.controller, {
      action: "ready_to_finish",
      acceptance_checks: [{ criterion: "The completion gate is enforced", evidence_refs: [freshEvidence] }],
      unresolved_failures: [],
    });
    expect(readiness).toContain("Reusing the existing 1-item requirement set");
    expect(readiness).toContain("Verify all 1 requirements");
    expect(harness.controller.currentState.requirementAudit.userRequirementsHash).toBe(definedHash);
    expect(harness.controller.currentState.requirementAudit.requirementSetHash).toBe(definedSetHash);
    expect(harness.controller.currentState.requirementAudit.status).toBe("verifying");
  });

  it("restores the pending batch and clears task-scoped evidence and repair recovery after successful finish", async () => {
    const harness = createRequirementAuditHarness();
    const { evidenceRef } = await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        oneRequirement()[0],
        {
          type: "verification",
          text: "The focused regression remains green",
          acceptance_criterion: "The current focused test evidence passes",
          source_prompt_indexes: [1],
        },
      ],
      ignored_source_prompts: [],
    });
    const restored = createRequirementAuditHarness(harness.sessionManager);
    expect(restored.controller.currentState.requirementAudit).toMatchObject({
      status: "verifying",
      nextRequirementIndex: 0,
    });
    expect(await callTaskVerification(restored.controller, { action: "status" })).toContain(
      "Verify all 2 requirements",
    );
    await nextModelTurn(restored);
    const completed = await callRequirementAudit(restored.controller, {
      action: "verdict",
      verdicts: [
        {
          requirement_id: "R1",
          passed: true,
          reason: "The restored evidence handle proves the gate behavior.",
          evidence_refs: [evidenceRef],
        },
        {
          requirement_id: "R2",
          passed: true,
          reason: "The restored evidence handle proves the focused regression.",
          evidence_refs: [evidenceRef],
        },
      ],
    });
    const token = auditVerificationToken(completed);
    const completedTaskId = restored.controller.currentState.taskId;
    expect(restored.controller.evidence.size).toBeGreaterThan(0);
    restored.controller.rejectedRequirementDefinitionDraft = {
      revision: "stale-recovery",
      diagnostics: "stale diagnostics",
      repairLineageBaselineRequirementCount: 0,
      bestDiagnosticCount: 1,
      unproductiveRepairAttempts: 0,
      consecutiveNonImprovingFreshDefinitions: 0,
      input: { action: "define", requirements: [] },
    };
    await recordAuditToolResult(restored.agent, "finish_work", {
      status: "success",
      summary: "Requirement audit complete",
      verification_token: token,
    });
    expect(restored.controller.currentState.taskId).not.toBe(completedTaskId);
    expect(restored.controller.currentState.mutationRevision).toBe(0);
    expect(restored.controller.currentState.taskPrompts).toEqual([]);
    expect(restored.controller.evidence.size).toBe(0);
    expect(restored.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
    expect(await callTaskVerification(restored.controller, { action: "status" })).not.toContain("stale-recovery");

    const rehydrated = createRequirementAuditHarness(harness.sessionManager);
    expect(rehydrated.controller.currentState.taskId).toBe(restored.controller.currentState.taskId);
    expect(rehydrated.controller.evidence.size).toBe(0);
  });

  it("invalidates a completion certificate when a new user requirement arrives without a file mutation", async () => {
    const harness = createRequirementAuditHarness();
    const { evidenceRef } = await reachAuditEvidenceReady(harness);
    const firstCompletion = await defineAndPass(harness, evidenceRef);
    const firstToken = auditVerificationToken(firstCompletion);
    const firstHash = harness.controller.currentState.readiness?.userRequirementsHash;
    const taskId = harness.controller.currentState.taskId;

    await sendAuditUserPrompt(harness, "Also reject stale certificates after a clarification.", 200);
    expect(harness.controller.currentState.taskId).toBe(taskId);
    expect(harness.controller.currentState.mutationRevision).toBe(1);
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

    const restarted = await callTaskVerification(harness.controller, {
      action: "ready_to_finish",
      acceptance_checks: [
        { criterion: "The completion gate is enforced", evidence_refs: [evidenceRef] },
        { criterion: "Stale certificates are rejected after clarification", evidence_refs: [evidenceRef] },
      ],
      unresolved_failures: [],
    });
    expect(restarted).toContain("Evidence readiness passed");
    const secondCompletion = await defineAndPass(harness, evidenceRef, [1, 2]);
    expect(auditVerificationToken(secondCompletion)).not.toBe(firstToken);
    expect(harness.controller.currentState.readiness?.userRequirementsHash).not.toBe(firstHash);
  });

  it("keeps an active audit usable when focused evidence is collected before the verdict batch", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        oneRequirement()[0],
        {
          type: "verification",
          text: "The focused regression remains green",
          acceptance_criterion: "Fresh focused evidence passes",
          source_prompt_indexes: [1],
        },
      ],
      ignored_source_prompts: [],
    });

    await nextModelTurn(harness);
    const freshEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/gate-during-audit.test.ts" },
        { text: "fresh focused evidence passed" },
      ),
    );
    expect(harness.controller.currentState).toMatchObject({
      readiness: { status: "evidence_ready" },
      requirementAudit: { status: "verifying", nextRequirementIndex: 0 },
    });

    await nextModelTurn(harness);
    const verdict = await callRequirementAudit(harness.controller, {
      action: "verdict",
      verdicts: [
        {
          requirement_id: "R1",
          passed: true,
          reason: "Fresh focused evidence proves the first requirement.",
          evidence_refs: [freshEvidence],
        },
        {
          requirement_id: "R2",
          passed: true,
          reason: "Fresh focused evidence proves the second requirement.",
          evidence_refs: [freshEvidence],
        },
      ],
    });
    expect(verdict).toContain("Requirement audit passed: 2/2");
  });

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
