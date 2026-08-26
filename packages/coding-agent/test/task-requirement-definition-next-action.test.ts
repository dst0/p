import { describe, expect, it, vi } from "vitest";
import { formatRequirementDefinitionPrompt } from "../src/core/task-verification/requirement-definition-prompt.ts";
import { rejectedDraftFreshDefinitionReason } from "../src/core/task-verification/requirement-definition-repair.ts";
import type { TaskVerificationController } from "../src/core/task-verification/taskverificationcontroller.ts";
import type { RequirementAuditInput } from "../src/core/task-verification/types.ts";
import {
  beforeAuditTool,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  type RequirementAuditHarness,
  reachAuditEvidenceReady,
} from "./task-requirement-audit-test-harness.ts";

describe("rejected requirement definition next-action authorization", () => {
  it("keeps fresh define blocked after aggregate overflow while allowing bounded repair", async () => {
    const harness = await preparedHarness();
    const apply = rejectingApplySpy(harness, [3, 2]);
    await callRequirementAudit(harness.controller, definition(39));
    const original = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);
    expect(original).toBeDefined();
    expect(apply).toHaveBeenCalledTimes(1);
    await nextModelTurn(harness);

    const aggregateOverflow = await callRequirementAudit(harness.controller, repair(original!.revision, [16, 17]));
    expect(aggregateOverflow).toContain("33 total replacements");
    expect(aggregateOverflow).toContain("next_required_action: repair_definition");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual({
      ...original,
      unproductiveRepairAttempts: 1,
    });
    const afterOverflow = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);
    expect(apply).toHaveBeenCalledTimes(1);

    expect(await callRequirementAudit(harness.controller, { action: "prepare_definition" })).toContain(
      "next_required_action: repair_definition",
    );
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(afterOverflow);
    expect(apply).toHaveBeenCalledTimes(1);

    expect(await callRequirementAudit(harness.controller, definition(3))).toContain("fresh define is not authorized");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(afterOverflow);
    expect(apply).toHaveBeenCalledTimes(1);
    const aggregateStatus = await callTaskVerification(harness.controller, { action: "status" });
    expect(aggregateStatus).toContain("next_required_action: repair_definition");
    expect(await callRequirementAudit(harness.controller, definition(3))).toContain("fresh define is not authorized");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(afterOverflow);
    expect(apply).toHaveBeenCalledTimes(1);

    await callRequirementAudit(harness.controller, repair(original!.revision, [1]));
    const rotated = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);
    expect(rotated?.revision).not.toBe(original?.revision);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(await callRequirementAudit(harness.controller, definition(4))).toContain("fresh define is not authorized");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(rotated);
    expect(apply).toHaveBeenCalledTimes(2);
    await callTaskVerification(harness.controller, { action: "status" });
    expect(await callRequirementAudit(harness.controller, definition(4))).toContain("fresh define is not authorized");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(rotated);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("keeps non-improving fresh definitions define-only after repeated non-improving lineage overflow", async () => {
    const harness = await preparedHarness();
    const apply = rejectingApplySpy(harness, [5, 4, 3, 3, 3]);
    await callRequirementAudit(harness.controller, definition(10));
    await nextModelTurn(harness);

    await callRequirementAudit(harness.controller, repair(currentRevision(harness.controller), [16]));
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input.requirements).toHaveLength(25);
    expect(apply).toHaveBeenCalledTimes(2);
    await callTaskVerification(harness.controller, { action: "status" });
    await nextModelTurn(harness);

    await callRequirementAudit(harness.controller, repair(currentRevision(harness.controller), [2]));
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input.requirements).toHaveLength(26);
    expect(apply).toHaveBeenCalledTimes(3);
    await callTaskVerification(harness.controller, { action: "status" });
    await nextModelTurn(harness);

    const overflowDraft = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);
    let lineageOverflow = await callRequirementAudit(
      harness.controller,
      repair(currentRevision(harness.controller), [2]),
    );
    expect(lineageOverflow).toContain("Repair was not adopted");
    expect(lineageOverflow).toContain("next_required_action: repair_definition");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual({
      ...overflowDraft,
      unproductiveRepairAttempts: 1,
    });
    expect(apply).toHaveBeenCalledTimes(4);
    for (let attempt = 2; attempt <= 3; attempt++) {
      await nextModelTurn(harness);
      lineageOverflow = await callRequirementAudit(
        harness.controller,
        repair(currentRevision(harness.controller), [2]),
      );
    }
    expect(lineageOverflow).toContain("next_required_action: define");
    expect(rejectedDraftFreshDefinitionReason(harness.controller.rejectedRequirementDefinitionDraft)).toBe(
      "stagnant_repair",
    );
    const authorizedDraft = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);

    expect(await callRequirementAudit(harness.controller, { action: "prepare_definition" })).toContain(
      "next_required_action: define",
    );

    expect(await callRequirementAudit(harness.controller, repair(currentRevision(harness.controller), [1]))).toContain(
      "fresh define is required",
    );

    const lineageStatus = await callTaskVerification(harness.controller, { action: "status" });
    expect(lineageStatus).toContain("next_required_action: define");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(authorizedDraft);

    expect(await callRequirementAudit(harness.controller, definition(3))).toContain("definition_revision");
    expect(apply).toHaveBeenCalledTimes(7);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input.requirements).toHaveLength(3);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.revision).not.toBe(overflowDraft?.revision);
    expect(lineageBaseline(harness.controller)).toBe(3);
    expect(await callRequirementAudit(harness.controller, definition(4))).toContain("next_required_action: define");
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input.requirements).toHaveLength(4);
    expect(lineageBaseline(harness.controller)).toBe(4);
    expect(apply).toHaveBeenCalledTimes(8);
    expect(await callRequirementAudit(harness.controller, repair(currentRevision(harness.controller), [1]))).toContain(
      "No sparse-repair budget was reopened",
    );
  });

  it("blocks task redeclaration while a rejected definition has a required next action", async () => {
    const harness = await preparedHarness();
    const apply = rejectingApplySpy(harness);
    await callRequirementAudit(harness.controller, definition(3));
    const rejectedDraft = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);
    const priorState = structuredClone(harness.controller.currentState);
    expect(apply).toHaveBeenCalledTimes(1);

    expect(
      await callTaskVerification(harness.controller, {
        action: "declare_task",
        task_kind: "bug_fix",
        task_summary: "Try to replace the active audit.",
      }),
    ).toContain("next_required_action: repair_definition");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(rejectedDraft);
    expect(harness.controller.currentState).toEqual(priorState);

    expect(
      await callTaskVerification(harness.controller, {
        action: "ready_to_finish",
        acceptance_checks: [
          { criterion: "The active rejected definition is preserved.", evidence_refs: ["verification-evidence-1"] },
        ],
        unresolved_failures: [],
      }),
    ).toContain("next_required_action: repair_definition");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(rejectedDraft);
    expect(harness.controller.currentState).toEqual(priorState);
  });

  it("keeps an equally rejected full retry define-only after an empty batch", async () => {
    const harness = await preparedHarness();
    const apply = rejectingApplySpy(harness);
    await callRequirementAudit(harness.controller, definition(0));
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input.requirements).toEqual([]);
    await nextModelTurn(harness);

    expect(await callRequirementAudit(harness.controller, definition(3))).toContain("next_required_action: define");
    expect(rejectedDraftFreshDefinitionReason(harness.controller.rejectedRequirementDefinitionDraft)).toBe(
      "non_improving_fresh_definition",
    );
    expect(apply).toHaveBeenCalledTimes(2);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input.requirements).toHaveLength(3);
  });

  it("rejects a repair that deletes the complete draft instead of authorizing a restart", async () => {
    const harness = await preparedHarness();
    const apply = rejectingApplySpy(harness);
    await callRequirementAudit(harness.controller, definition(3));
    const original = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);
    await nextModelTurn(harness);

    expect(
      await callRequirementAudit(harness.controller, repair(currentRevision(harness.controller), [0, 0, 0])),
    ).toContain("cannot remove every requirement");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual({
      ...original,
      unproductiveRepairAttempts: 1,
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(await callRequirementAudit(harness.controller, definition(2))).toContain("fresh define is not authorized");
  });

  it("blocks workspace mutation while a rejected definition has a required next action", async () => {
    const harness = await preparedHarness();
    rejectingApplySpy(harness);
    await callRequirementAudit(harness.controller, definition(3));
    const rejectedDraft = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);

    const gate = await beforeAuditTool(harness.agent, "edit", {
      path: "src/inventory.ts",
      oldText: "before",
      newText: "after",
    });

    expect(gate?.block).toBe(true);
    expect(gate?.reason).toContain("next_required_action: repair_definition");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(rejectedDraft);
  });

  it("keeps an equally rejected recovery retry define-only", async () => {
    const harness = await preparedHarness();
    const apply = rejectingApplySpy(harness);
    const oversized = definition(96);
    for (const item of oversized.requirements ?? []) {
      item.text += ` ${"x".repeat(180)}`;
      item.acceptance_criterion += ` ${"y".repeat(180)}`;
    }
    await callRequirementAudit(harness.controller, oversized);
    const draft = harness.controller.rejectedRequirementDefinitionDraft;
    expect(draft).toBeDefined();

    const recovery = formatRequirementDefinitionPrompt([{ id: "prompt-1", text: "Preserve inventory." }], draft);
    expect(recovery).toContain("next_required_action: define");
    expect(rejectedDraftFreshDefinitionReason(draft)).toBe("recovery_prompt_limit");
    await nextModelTurn(harness);

    expect(await callRequirementAudit(harness.controller, repair(currentRevision(harness.controller), [1]))).toContain(
      "recovery prompt limit",
    );
    expect(await callRequirementAudit(harness.controller, definition(3))).toContain("next_required_action: define");
    expect(rejectedDraftFreshDefinitionReason(harness.controller.rejectedRequirementDefinitionDraft)).toBe(
      "non_improving_fresh_definition",
    );
    expect(apply).toHaveBeenCalledTimes(2);
  });
});

async function preparedHarness(): Promise<RequirementAuditHarness> {
  const harness = createRequirementAuditHarness();
  await reachAuditEvidenceReady(harness);
  await nextModelTurn(harness);
  return harness;
}

function rejectingApplySpy(harness: RequirementAuditHarness, diagnosticCounts: number[] = [1]) {
  let rejectionIndex = 0;
  return vi.spyOn(harness.controller, "applyRequirementAudit").mockImplementation(() => {
    const diagnosticCount = diagnosticCounts[rejectionIndex++] ?? diagnosticCounts.at(-1)!;
    return {
      status: "needs_action",
      message: `Requirement definition has ${diagnosticCount} deterministic validation errors:\n1. Rejected.`,
      state: harness.controller.currentState,
      requirementDefinitionDiagnosticCount: diagnosticCount,
    };
  });
}

function definition(count: number): RequirementAuditInput {
  return {
    action: "define",
    requirements: Array.from({ length: count }, (_value, offset) => requirement(offset + 1)),
    ignored_source_prompts: [],
    ignored_source_clauses: [],
  };
}

function repair(definitionRevision: string, replacementCounts: number[]): RequirementAuditInput {
  let next = 1_000;
  return {
    action: "repair_definition",
    definition_revision: definitionRevision,
    requirement_repairs: replacementCounts.map((count, offset) => ({
      requirement_index: offset + 1,
      replacements: Array.from({ length: count }, () => requirement(next++)),
    })),
  };
}

function requirement(index: number) {
  return {
    type: "behavior" as const,
    text: `Requirement ${index}`,
    acceptance_criterion: `Requirement ${index} is satisfied`,
    source_prompt_indexes: [1],
  };
}

function currentRevision(controller: TaskVerificationController): string {
  const revision = controller.rejectedRequirementDefinitionDraft?.revision;
  if (!revision) throw new Error("Expected active rejected definition revision.");
  return revision;
}

function lineageBaseline(controller: TaskVerificationController): number | undefined {
  return controller.rejectedRequirementDefinitionDraft?.repairLineageBaselineRequirementCount;
}
