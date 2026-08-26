import { describe, expect, it, vi } from "vitest";
import { rejectedDraftFreshDefinitionReason } from "../src/core/task-verification/requirement-definition-repair.ts";
import type { RequirementAuditInput } from "../src/core/task-verification/types.ts";
import {
  beforeAuditTool,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
} from "./task-requirement-audit-test-harness.ts";

describe("rejected requirement definition monotonic repair", () => {
  it("retains the best draft when a later arity-changing repair regresses diagnostics", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);

    const diagnosticCounts = [28, 21, 28];
    const apply = vi.spyOn(harness.controller, "applyRequirementAudit").mockImplementation(() => {
      const diagnosticCount = diagnosticCounts.shift();
      return diagnosticCount === undefined
        ? { status: "updated", message: "Accepted.", state: harness.controller.currentState }
        : {
            status: "needs_action",
            message: diagnostics(diagnosticCount),
            state: harness.controller.currentState,
            requirementDefinitionDiagnosticCount: diagnosticCount,
          };
    });

    await callRequirementAudit(harness.controller, definition(39));
    await nextModelTurn(harness);

    const improved = await callRequirementAudit(
      harness.controller,
      repair(currentRevision(harness.controller), [3, 3, 3, 1]),
    );
    const improvedDraft = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);
    expect(improved).toContain("21 deterministic validation errors");
    expect(improvedDraft?.input.requirements).toHaveLength(45);
    expect(improvedDraft?.bestDiagnosticCount).toBe(21);
    expect(improvedDraft?.unproductiveRepairAttempts).toBe(0);

    await callTaskVerification(harness.controller, { action: "status" });
    await nextModelTurn(harness);

    const regressed = await callRequirementAudit(
      harness.controller,
      repair(currentRevision(harness.controller), [3, 2, 2, 2, 2]),
    );

    expect(apply.mock.calls[0]?.[0].requirements).toHaveLength(39);
    expect(apply.mock.calls[1]?.[0].requirements).toHaveLength(45);
    expect(apply.mock.calls[2]?.[0].requirements).toHaveLength(51);
    expect(regressed).toContain("Repair was not adopted");
    expect(regressed).toContain("28 deterministic diagnostic(s); the active draft has 21");
    expect(regressed).toContain("next_required_action: define");
    expect(rejectedDraftFreshDefinitionReason(harness.controller.rejectedRequirementDefinitionDraft)).toBe(
      "regressive_repair",
    );
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual({
      ...improvedDraft,
      unproductiveRepairAttempts: 1,
    });

    await nextModelTurn(harness);
    expect(await callRequirementAudit(harness.controller, repair(currentRevision(harness.controller), [1]))).toContain(
      "fresh define is required",
    );
    expect(apply).toHaveBeenCalledTimes(3);
    const mutationGate = await beforeAuditTool(harness.agent, "edit", {
      path: "src/inventory.ts",
      oldText: "before",
      newText: "after",
    });
    expect(mutationGate?.block).toBe(true);

    await nextModelTurn(harness);
    expect(await callRequirementAudit(harness.controller, definition(45))).toBe("Accepted.");
    expect(apply).toHaveBeenCalledTimes(4);
    expect(harness.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
  });

  it("adopts a lateral repair when both diagnostic messages use the single-error shape", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);

    const messages = ["Requirement 1 is still invalid.", "Requirement 1 needs another correction."];
    vi.spyOn(harness.controller, "applyRequirementAudit").mockImplementation(() => ({
      status: "needs_action",
      message: messages.shift()!,
      state: harness.controller.currentState,
      requirementDefinitionDiagnosticCount: 1,
    }));

    await callRequirementAudit(harness.controller, definition(1));
    const firstRevision = currentRevision(harness.controller);
    await nextModelTurn(harness);

    const lateral = await callRequirementAudit(harness.controller, repair(firstRevision, [1]));

    expect(lateral).not.toContain("Repair was not adopted");
    expect(currentRevision(harness.controller)).not.toBe(firstRevision);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input.requirements?.[0]?.text).toBe(
      "Requirement 1000",
    );
    expect(harness.controller.rejectedRequirementDefinitionDraft?.unproductiveRepairAttempts).toBe(1);
  });

  it("does not mistake a controller rejection for an improved validator result", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);

    const results = [
      { message: diagnostics(3), requirementDefinitionDiagnosticCount: 3 },
      { message: "Only one requirement-audit transition is allowed in a single model turn." },
    ];
    vi.spyOn(harness.controller, "applyRequirementAudit").mockImplementation(() => ({
      status: "needs_action",
      ...results.shift()!,
      state: harness.controller.currentState,
    }));

    await callRequirementAudit(harness.controller, definition(3));
    const activeDraft = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);
    await nextModelTurn(harness);

    const rejected = await callRequirementAudit(harness.controller, repair(currentRevision(harness.controller), [1]));

    expect(rejected).toContain("Repair was not adopted");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual({
      ...activeDraft,
      unproductiveRepairAttempts: 1,
    });
    expect(harness.controller.rejectedRequirementDefinitionDraft?.bestDiagnosticCount).toBe(3);
  });
});

function definition(count: number): RequirementAuditInput {
  return {
    action: "define",
    requirements: Array.from({ length: count }, (_value, index) => requirement(index + 1)),
    ignored_source_prompts: [],
    ignored_source_clauses: [],
  };
}

function repair(definitionRevision: string, replacementCounts: number[]): RequirementAuditInput {
  let nextRequirement = 1_000;
  return {
    action: "repair_definition",
    definition_revision: definitionRevision,
    requirement_repairs: replacementCounts.map((count, index) => ({
      requirement_index: index + 1,
      replacements: Array.from({ length: count }, () => requirement(nextRequirement++)),
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

function diagnostics(count: number): string {
  return [
    `Requirement definition has ${count} deterministic validation errors:`,
    ...Array.from({ length: count }, (_value, index) => `${index + 1}. Diagnostic ${index + 1}`),
  ].join("\n");
}

function currentRevision(controller: { rejectedRequirementDefinitionDraft?: { revision: string } }): string {
  const revision = controller.rejectedRequirementDefinitionDraft?.revision;
  if (!revision) throw new Error("Expected active rejected definition revision.");
  return revision;
}
