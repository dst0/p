import { describe, expect, it, vi } from "vitest";
import { formatRequirementDefinitionPrompt } from "../src/core/task-verification/requirement-definition-prompt.ts";
import { rejectedDraftFreshDefinitionReason } from "../src/core/task-verification/requirement-definition-repair.ts";
import type { TaskVerificationController } from "../src/core/task-verification/taskverificationcontroller.ts";
import type { RequirementAuditInput } from "../src/core/task-verification/types.ts";
import {
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
  recordAuditToolResult,
  type RequirementAuditHarness,
} from "./task-requirement-audit-test-harness.ts";

describe("rejected requirement definition next-action authorization", () => {
  it("keeps fresh define blocked after aggregate overflow while allowing bounded repair", async () => {
    const harness = await preparedHarness();
    const apply = rejectingApplySpy(harness);
    await callRequirementAudit(harness.controller, definition(39));
    const original = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);
    expect(original).toBeDefined();
    expect(apply).toHaveBeenCalledTimes(1);
    await nextModelTurn(harness);

    const aggregateOverflow = await callRequirementAudit(harness.controller, repair(original!.revision, [8, 9]));
    expect(aggregateOverflow).toContain("17 total replacements");
    expect(aggregateOverflow).toContain("next_required_action: repair_definition");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(original);
    expect(apply).toHaveBeenCalledTimes(1);

    expect(await callRequirementAudit(harness.controller, { action: "prepare_definition" })).toContain(
      "next_required_action: repair_definition",
    );
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(original);
    expect(apply).toHaveBeenCalledTimes(1);

    expect(await callRequirementAudit(harness.controller, definition(3))).toContain("fresh define is not authorized");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(original);
    expect(apply).toHaveBeenCalledTimes(1);
    const aggregateStatus = await callTaskVerification(harness.controller, { action: "status" });
    expect(aggregateStatus).toContain("next_required_action: repair_definition");
    expect(await callRequirementAudit(harness.controller, definition(3))).toContain("fresh define is not authorized");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(original);
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

  it("authorizes one fresh define after cumulative lineage overflow and resets authorization", async () => {
    const harness = await preparedHarness();
    const apply = rejectingApplySpy(harness);
    await callRequirementAudit(harness.controller, definition(10));
    expect(apply).toHaveBeenCalledTimes(1);
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
    const lineageOverflow = await callRequirementAudit(
      harness.controller,
      repair(currentRevision(harness.controller), [2]),
    );
    expect(lineageOverflow).toContain("cumulative net growth permits at most 16");
    expect(lineageOverflow).toContain("next_required_action: define");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(overflowDraft);
    expect(apply).toHaveBeenCalledTimes(3);

    expect(await callRequirementAudit(harness.controller, { action: "prepare_definition" })).toContain(
      "next_required_action: define",
    );
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(overflowDraft);
    expect(apply).toHaveBeenCalledTimes(3);

    expect(
      await callRequirementAudit(harness.controller, repair(currentRevision(harness.controller), [1])),
    ).toContain("fresh define is required");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(overflowDraft);
    expect(apply).toHaveBeenCalledTimes(3);

    const lineageStatus = await callTaskVerification(harness.controller, { action: "status" });
    expect(lineageStatus).toContain("next_required_action: define");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(overflowDraft);

    expect(await callRequirementAudit(harness.controller, definition(3))).toContain("definition_revision");
    expect(apply).toHaveBeenCalledTimes(4);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input.requirements).toHaveLength(3);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.revision).not.toBe(overflowDraft?.revision);
    expect(lineageBaseline(harness.controller)).toBe(3);
    const resetDraft = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);

    expect(await callRequirementAudit(harness.controller, definition(4))).toContain("fresh define is not authorized");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(resetDraft);
    expect(apply).toHaveBeenCalledTimes(4);
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

  it("allows a corrected full definition after an empty rejected batch", async () => {
    const harness = await preparedHarness();
    const apply = rejectingApplySpy(harness);
    await callRequirementAudit(harness.controller, definition(0));
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input.requirements).toEqual([]);
    await nextModelTurn(harness);

    expect(await callRequirementAudit(harness.controller, definition(3))).toContain("definition_revision");
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
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(original);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(await callRequirementAudit(harness.controller, definition(2))).toContain("fresh define is not authorized");
  });

  it("invalidates a rejected draft when a later workspace mutation changes the audit subject", async () => {
    const harness = await preparedHarness();
    rejectingApplySpy(harness);
    await callRequirementAudit(harness.controller, definition(3));
    expect(harness.controller.rejectedRequirementDefinitionDraft).toBeDefined();

    await recordAuditToolResult(
      harness.agent,
      "edit",
      { path: "src/inventory.ts", oldText: "before", newText: "after" },
      { text: "Updated the inventory implementation." },
    );

    expect(harness.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
    expect(harness.controller.requirementRepairStatusRevision).toBeUndefined();
    expect(
      await callTaskVerification(harness.controller, {
        action: "record_final",
        method: "focused_test",
        command: "vitest --run test/inventory.test.ts",
        observations: "Focused inventory test passed after the later mutation.",
      }),
    ).not.toContain("next_required_action:");
  });

  it("accepts the instructed full definition after oversized recovery authorizes it", async () => {
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
    expect(await callRequirementAudit(harness.controller, definition(3))).toContain("definition_revision");
    expect(apply).toHaveBeenCalledTimes(2);
  });
});

async function preparedHarness(): Promise<RequirementAuditHarness> {
  const harness = createRequirementAuditHarness();
  await reachAuditEvidenceReady(harness);
  await nextModelTurn(harness);
  return harness;
}

function rejectingApplySpy(harness: RequirementAuditHarness) {
  return vi.spyOn(harness.controller, "applyRequirementAudit").mockImplementation(() => ({
    status: "needs_action",
    message: "Definition rejected.",
    state: harness.controller.currentState,
  }));
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
