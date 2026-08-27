import { describe, expect, it, vi } from "vitest";
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
  it("retains the best draft and allows sparse recovery after a regressive repair", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);

    const realApply = harness.controller.applyRequirementAudit.bind(harness.controller);
    const diagnosticCounts = [28, 21, 28];
    const apply = vi.spyOn(harness.controller, "applyRequirementAudit").mockImplementation((input) => {
      const diagnosticCount = diagnosticCounts.shift();
      return diagnosticCount === undefined
        ? realApply(input)
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
    expect(regressed).toContain("next_required_action: repair_definition");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toEqual({
      ...improvedDraft,
      unproductiveRepairAttempts: 1,
    });

    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, repair(currentRevision(harness.controller), [1], 2_000)),
    ).toContain("Defined 45 atomic requirement(s).");
    expect(apply).toHaveBeenCalledTimes(4);
    expect(apply.mock.calls[3]?.[0].requirements).toHaveLength(45);
    expect(apply.mock.calls[3]?.[0].requirements?.[0]?.text).toBe("Requirement 2000");
    expect(apply.mock.calls[3]?.[0].requirements?.at(-1)?.text).toBe("Requirement 39");
    expect(harness.controller.currentState.requirementAudit?.status).toBe("verifying");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
    const mutationGate = await beforeAuditTool(harness.agent, "edit", {
      path: "src/inventory.ts",
      oldText: "before",
      newText: "after",
    });
    expect(mutationGate?.block).not.toBe(true);
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

  it("adopts a fully valid lineage overflow atomically through the real controller", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    const invalidDefinition = definition(35);
    invalidDefinition.requirements![0]!.type = "unsupported" as never;

    expect(await callRequirementAudit(harness.controller, invalidDefinition)).toContain("unsupported type");
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input.requirements).toHaveLength(35);
    await nextModelTurn(harness);

    const accepted = await callRequirementAudit(harness.controller, repair(currentRevision(harness.controller), [20]));

    expect(accepted).toContain("Defined 54 atomic requirement(s).");
    expect(harness.controller.currentState.requirementAudit?.status).toBe("verifying");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
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

function repair(
  definitionRevision: string,
  replacementCounts: number[],
  startRequirement = 1_000,
): RequirementAuditInput {
  let nextRequirement = startRequirement;
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
