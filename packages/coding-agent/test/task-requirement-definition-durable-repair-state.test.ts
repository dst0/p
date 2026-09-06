import { describe, expect, it } from "vitest";
import { TASK_VERIFICATION_STATE_CUSTOM_TYPE } from "../src/core/task-verification/constants.ts";
import { isTaskVerificationState } from "../src/core/task-verification/state-validation.ts";
import {
  beforeAuditTool,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("durable rejected requirement-definition repair state", () => {
  it("restores the exact active draft and keeps a replacement define blocked", async () => {
    const harness = await activeRepairHarness();
    const expectedDraft = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);
    const expectedState = harness.controller.currentState;

    const restored = createRequirementAuditHarness(harness.sessionManager);

    expect(restored.controller.rejectedRequirementDefinitionDraft).toEqual(expectedDraft);
    expect(restored.controller.currentState).toMatchObject({
      requirementDefinitionRepairPending: 1,
      rejectedRequirementDefinitionDraft: expectedDraft,
      requirementAudit: { status: "awaiting_definition" },
    });
    expect(restored.controller.currentState.taskPrompts).toEqual(expectedState.taskPrompts);
    const redefine = await callRequirementAudit(restored.controller, definition("Replacement batch"));
    expect(redefine).toContain("next_required_action: repair_definition");
    expect(restored.controller.rejectedRequirementDefinitionDraft).toEqual(expectedDraft);
    const repaired = await callRequirementAudit(restored.controller, {
      action: "repair_definition",
      definition_revision: expectedDraft!.revision,
      requirement_repairs: [{ requirement_index: 1, replacements: definition("Corrected batch").requirements }],
    });
    expect(repaired).toContain("Defined 1 atomic requirement");
  });

  it("restores and atomically consolidates an entire exact duplicate group", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(harness, "Implement a deterministic greeting.", 100);
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Implement a deterministic greeting",
    });
    harness.controller.state.requirementAudit = {
      status: "awaiting_definition",
      requirements: [],
      ignoredSourcePrompts: [],
      ignoredSourceClauses: [],
      nextRequirementIndex: 0,
    };
    const duplicate = definition("Implement a deterministic\u0000greeting").requirements[0]!;
    const rejected = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [duplicate, duplicate, duplicate],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });
    expect(rejected).toContain("Requirement 2 duplicates Requirement 1");
    const revision = harness.controller.rejectedRequirementDefinitionDraft!.revision;

    const restored = createRequirementAuditHarness(harness.sessionManager);
    const repaired = await callRequirementAudit(restored.controller, {
      action: "repair_definition",
      definition_revision: revision,
      requirement_repairs: [{ requirement_index: 2, replacements: [] }],
    });

    expect(repaired).toContain("Defined 1 atomic requirement");
    expect(restored.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
    expect(restored.controller.currentState.requirementAudit.requirements).toHaveLength(1);
  });

  it("appends a substantive follow-up without erasing or rotating the active repair batch", async () => {
    const harness = await activeRepairHarness();
    const expectedDraft = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);

    await sendAuditUserPrompt(harness, "Also require a deterministic fallback.", 200);

    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual(expectedDraft);
    expect(harness.controller.currentState).toMatchObject({
      requirementDefinitionRepairPending: 1,
      rejectedRequirementDefinitionDraft: expectedDraft,
      readiness: { status: "pending" },
      requirementAudit: { status: "awaiting_definition" },
    });
    expect(harness.controller.currentState.taskPrompts).toHaveLength(2);
    const restored = createRequirementAuditHarness(harness.sessionManager);
    expect(restored.controller.rejectedRequirementDefinitionDraft).toEqual(expectedDraft);
    expect(restored.controller.currentState.taskPrompts).toHaveLength(2);
    const incomplete = await callRequirementAudit(restored.controller, {
      action: "repair_definition",
      definition_revision: expectedDraft!.revision,
      requirement_repairs: [{ requirement_index: 1, replacements: definition("Corrected greeting").requirements }],
    });
    expect(incomplete).toContain("unclassified indexes: 2");
    const rotatedRevision = restored.controller.rejectedRequirementDefinitionDraft?.revision;
    expect(rotatedRevision).not.toBe(expectedDraft!.revision);
    expect(await callRequirementAudit(restored.controller, definition("Replacement batch"))).toContain(
      "next_required_action: repair_definition",
    );
    await nextModelTurn(restored);
    const completed = await callRequirementAudit(restored.controller, {
      action: "repair_definition",
      definition_revision: rotatedRevision,
      requirement_addition: definition("Provide a deterministic fallback", [2]).requirements[0],
    });
    expect(completed).toContain("Defined 2 atomic requirement(s)");
  });

  it("persists a retained draft after the selected diagnostic survives a repair", async () => {
    const harness = await activeRepairHarness();
    const revision = harness.controller.rejectedRequirementDefinitionDraft!.revision;

    const retained = await callRequirementAudit(harness.controller, {
      action: "repair_definition",
      definition_revision: revision,
      requirement_repairs: [{ requirement_index: 1, replacements: definition("Still invalid", [2]).requirements }],
    });

    expect(retained).toContain("previous draft and definition_revision were retained");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toMatchObject({
      revision,
      unproductiveRepairAttempts: 1,
    });
    const restored = createRequirementAuditHarness(harness.sessionManager);
    expect(restored.controller.rejectedRequirementDefinitionDraft).toMatchObject({
      revision,
      unproductiveRepairAttempts: 1,
    });
  });

  it("blocks publish and successful finish before their zero-mutation fast paths", async () => {
    const harness = await activeRepairHarness();

    const publish = await beforeAuditTool(harness.agent, "bash", { command: "git commit -m repair-pending" });
    const finish = await beforeAuditTool(harness.agent, "finish_work", { status: "success" });

    expect(publish).toMatchObject({ block: true });
    expect(finish).toMatchObject({ block: true });
    expect(String(publish?.reason)).toContain("next_required_action: repair_definition");
    expect(String(finish?.reason)).toContain("next_required_action: repair_definition");
  });

  it("rejects unpaired or malformed persisted repair state during restoration", async () => {
    const harness = await activeRepairHarness();
    const valid = harness.controller.currentState;
    const missingDraft = { ...valid, rejectedRequirementDefinitionDraft: undefined };
    const missingMarker = { ...valid, requirementDefinitionRepairPending: undefined };
    const invalidCounter = {
      ...valid,
      rejectedRequirementDefinitionDraft: {
        ...valid.rejectedRequirementDefinitionDraft!,
        unproductiveRepairAttempts: Number.MAX_SAFE_INTEGER,
      },
    };
    const wrongAction = {
      ...valid,
      rejectedRequirementDefinitionDraft: {
        ...valid.rejectedRequirementDefinitionDraft!,
        input: { action: "repair_definition", definition_revision: "repair-revision" },
      },
    };
    const wrongPhase = { ...valid, requirementAudit: { ...valid.requirementAudit, status: "pending" } };
    const oversizedDiagnostics = {
      ...valid,
      rejectedRequirementDefinitionDraft: {
        ...valid.rejectedRequirementDefinitionDraft!,
        diagnostics: "x".repeat(32_769),
      },
    };
    const oversizedInput = structuredClone(valid);
    oversizedInput.rejectedRequirementDefinitionDraft!.input.requirements![0]!.text = "x".repeat(32_769);
    const fractionalCounter = structuredClone(valid);
    fractionalCounter.rejectedRequirementDefinitionDraft!.bestDiagnosticCount = 1.5;
    const oversizedClauseId = structuredClone(valid);
    oversizedClauseId.rejectedRequirementDefinitionDraft!.knownNormativeSourceClauseIds = [`S${"1".repeat(80)}-C1`];
    const oversizedClauseIdSet = structuredClone(valid);
    oversizedClauseIdSet.rejectedRequirementDefinitionDraft!.knownNormativeSourceClauseIds = Array.from(
      { length: 128 },
      (_, index) => `S${"1".repeat(38)}-C${index + 1}`,
    );
    expect(isTaskVerificationState(missingDraft)).toBe(false);
    expect(isTaskVerificationState(missingMarker)).toBe(false);
    expect(isTaskVerificationState(invalidCounter)).toBe(false);
    expect(isTaskVerificationState(wrongAction)).toBe(false);
    expect(isTaskVerificationState(wrongPhase)).toBe(false);
    expect(isTaskVerificationState(oversizedDiagnostics)).toBe(false);
    expect(isTaskVerificationState(oversizedInput)).toBe(false);
    expect(isTaskVerificationState(fractionalCounter)).toBe(false);
    expect(isTaskVerificationState(oversizedClauseId)).toBe(false);
    expect(isTaskVerificationState(oversizedClauseIdSet)).toBe(false);

    harness.sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, missingDraft);
    const restored = createRequirementAuditHarness(harness.sessionManager);
    expect(restored.controller.restoreError).toContain("persisted task-verification state is invalid");
    expect(restored.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
    await sendAuditUserPrompt(restored, "Start over with a replacement definition.", 300);
    expect(await callTaskVerification(restored.controller, { action: "declare_task" })).toContain(
      "persisted task-verification state is invalid",
    );
    const rehydrated = createRequirementAuditHarness(harness.sessionManager);
    expect(rehydrated.controller.restoreError).toContain("persisted task-verification state is invalid");
  });
});

async function activeRepairHarness() {
  const harness = createRequirementAuditHarness();
  await sendAuditUserPrompt(harness, "Implement a deterministic greeting.", 100);
  await callTaskVerification(harness.controller, {
    action: "declare_task",
    task_kind: "feature",
    task_summary: "Implement a deterministic greeting",
  });
  harness.controller.state.requirementAudit = {
    status: "awaiting_definition",
    requirements: [],
    ignoredSourcePrompts: [],
    ignoredSourceClauses: [],
    nextRequirementIndex: 0,
  };
  const rejected = await callRequirementAudit(
    harness.controller,
    definition("Implement a deterministic greeting", [2]),
  );
  expect(rejected).toContain("deterministic validation error");
  expect(harness.controller.rejectedRequirementDefinitionDraft).toBeDefined();
  return harness;
}

function definition(text: string, sourcePromptIndexes: number[] = [1]) {
  return {
    action: "define" as const,
    requirements: [
      {
        type: "behavior" as const,
        text,
        acceptance_criterion: "The focused greeting check passes deterministically",
        source_prompt_indexes: sourcePromptIndexes,
      },
    ],
    ignored_source_prompts: [],
    ignored_source_clauses: [],
  };
}
