import { describe, expect, it, vi } from "vitest";
import { formatRequirementDefinitionPrompt } from "../src/core/task-verification/requirement-definition-prompt.ts";
import {
  formatRejectedDefinitionRepairGuidance,
  rejectedDefinitionNextActionGuardMessage,
  rejectedDraftFreshDefinitionReason,
  rejectedDraftRecoveryExhausted,
  rejectedRequirementDefinitionDraft,
} from "../src/core/task-verification/requirement-definition-repair.ts";
import type { RequirementAuditInput } from "../src/core/task-verification/types.ts";
import {
  callRequirementAudit,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
} from "./task-requirement-audit-test-harness.ts";

describe("requirement definition cross-cycle stagnation", () => {
  it("states that repair replacements are complete objects with explicit provenance", () => {
    const draft = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnostics(1));
    const guidance = formatRejectedDefinitionRepairGuidance("Rejected", draft);

    expect(guidance).toContain("complete requirement object, not a patch");
    expect(guidance).toContain("omitted provenance fields are deleted");
    expect(guidance).toContain('{"source_prompt_indexes":[1],"source_clause_ids":["S2-C2"]}');
    expect(guidance).toContain('ignored_source_clause_removals:["S2-C2"]');

    const recovery = formatRequirementDefinitionPrompt([{ id: "p1", text: "Implement the requirement." }], draft);
    expect(recovery).toContain("complete requirement object, not a patch");
    expect(recovery).toContain("omitted provenance fields are deleted");
  });

  it("keeps equal or worse fresh definitions define-only without reopening sparse repair", () => {
    let draft = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnostics(1));
    draft = nonImprovingRepairs(draft, 3, 1);

    expect(rejectedDraftFreshDefinitionReason(draft)).toBe("stagnant_repair");

    draft = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnostics(2), draft, "fresh_definition");
    expect(draft?.unproductiveRepairAttempts).toBe(3);
    expect(rejectedDraftFreshDefinitionReason(draft)).toBe("non_improving_fresh_definition");
    const nextAction = rejectedDefinitionNextActionGuardMessage(draft!);
    expect(nextAction).toContain("next_required_action: define");
    expect(nextAction).toContain("2 deterministic diagnostic(s)");
    expect(nextAction).toContain("historical best is 1");
    expect(nextAction).toContain("No sparse-repair budget was reopened");

    draft = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnostics(2), draft, "fresh_definition");
    expect(draft?.unproductiveRepairAttempts).toBe(3);
    expect(rejectedDraftFreshDefinitionReason(draft)).toBe("non_improving_fresh_definition");
  });

  it("exhausts repeated non-improving fresh definitions instead of reopening forever", () => {
    let draft = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnostics(3));
    draft = nonImprovingRepairs(draft, 3, 3);

    for (let attempt = 0; attempt < 3; attempt++) {
      draft = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnostics(4), draft, "fresh_definition");
    }

    expect(rejectedDraftFreshDefinitionReason(draft)).toBe("stagnant_definition");
    expect(rejectedDefinitionNextActionGuardMessage(draft!)).toContain("next_required_action: none");
  });

  it("blocks further audit validation after the fresh-definition budget is exhausted", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    const apply = vi.spyOn(harness.controller, "applyRequirementAudit").mockImplementation(() => ({
      status: "needs_action",
      message: diagnostics(4),
      state: harness.controller.currentState,
      requirementDefinitionDiagnosticCount: 4,
    }));

    await callRequirementAudit(harness.controller, invalidDefinition());
    for (let attempt = 0; attempt < 3; attempt++) {
      await nextModelTurn(harness);
      await callRequirementAudit(harness.controller, invalidRepair(currentRevision(harness)));
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      await nextModelTurn(harness);
      await callRequirementAudit(harness.controller, invalidDefinition());
    }
    expect(rejectedDraftRecoveryExhausted(harness.controller.rejectedRequirementDefinitionDraft)).toBe(true);
    const callsBeforeGuard = apply.mock.calls.length;

    await nextModelTurn(harness);
    const blocked = await callRequirementAudit(harness.controller, invalidDefinition());
    expect(blocked).toContain("No further define or repair transition is accepted");
    expect(apply).toHaveBeenCalledTimes(callsBeforeGuard);
  });

  it("resets the cross-cycle bound after a fresh definition reaches a lower diagnostic minimum", () => {
    let draft = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnostics(3));
    draft = nonImprovingRepairs(draft, 3, 3);

    draft = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnostics(2), draft, "fresh_definition");

    expect(draft?.bestDiagnosticCount).toBe(2);
    expect(draft?.unproductiveRepairAttempts).toBe(0);
    expect(rejectedDraftFreshDefinitionReason(draft)).toBeUndefined();
  });

  it("carries the historical minimum through the audit tool without reopening repair", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, invalidDefinition());

    let result = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      await nextModelTurn(harness);
      result = await callRequirementAudit(harness.controller, invalidRepair(currentRevision(harness)));
    }
    expect(result).toContain("next_required_action: define");

    await nextModelTurn(harness);
    result = await callRequirementAudit(harness.controller, invalidDefinition());
    expect(result).toContain("next_required_action: define");
    const freshRevision = currentRevision(harness);

    await nextModelTurn(harness);
    expect(await callRequirementAudit(harness.controller, invalidRepair(freshRevision))).toContain(
      "No sparse-repair budget was reopened",
    );

    await nextModelTurn(harness);
    expect(await callRequirementAudit(harness.controller, invalidDefinition())).toContain(
      "next_required_action: define",
    );
  });

  it("reopens repair through the audit tool only after a lower diagnostic minimum", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    let attempt = 0;
    vi.spyOn(harness.controller, "applyRequirementAudit").mockImplementation(() => {
      attempt += 1;
      if (attempt === 6) {
        return { status: "updated", message: "Accepted improved repair.", state: harness.controller.currentState };
      }
      return {
        status: "needs_action",
        message: diagnostics(attempt === 5 ? 2 : 3),
        state: harness.controller.currentState,
        requirementDefinitionDiagnosticCount: attempt === 5 ? 2 : 3,
      };
    });
    await callRequirementAudit(harness.controller, invalidDefinition());
    for (let repairAttempt = 0; repairAttempt < 3; repairAttempt++) {
      await nextModelTurn(harness);
      await callRequirementAudit(
        harness.controller,
        invalidRepair(currentRevision(harness), `attempt-${repairAttempt}`),
      );
    }
    await nextModelTurn(harness);
    expect(await callRequirementAudit(harness.controller, invalidDefinition())).toContain("definition_revision");
    expect(rejectedDraftFreshDefinitionReason(harness.controller.rejectedRequirementDefinitionDraft)).toBeUndefined();
    await nextModelTurn(harness);
    expect(await callRequirementAudit(harness.controller, invalidRepair(currentRevision(harness), "accepted"))).toBe(
      "Accepted improved repair.",
    );
    expect(harness.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
  });
});

function nonImprovingRepairs(
  initial: ReturnType<typeof rejectedRequirementDefinitionDraft>,
  count: number,
  diagnosticCount: number,
) {
  let draft = initial;
  for (let attempt = 0; attempt < count; attempt++) {
    draft = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnostics(diagnosticCount), draft);
  }
  return draft;
}

function invalidDefinition(): RequirementAuditInput {
  return {
    action: "define",
    requirements: [
      {
        type: "behavior",
        text: "Invalid requirement",
        acceptance_criterion: "Invalid requirement is repaired",
        source_prompt_indexes: [99],
      },
    ],
    ignored_source_prompts: [],
    ignored_source_clauses: [],
  };
}

function invalidRepair(definitionRevision: string, change?: string): RequirementAuditInput {
  const replacement = invalidDefinition().requirements![0]!;
  if (change) replacement.text = `${replacement.text} ${change}`;
  return {
    action: "repair_definition",
    definition_revision: definitionRevision,
    requirement_repairs: [
      {
        requirement_index: 1,
        replacements: [replacement],
      },
    ],
  };
}

function currentRevision(harness: ReturnType<typeof createRequirementAuditHarness>): string {
  const revision = harness.controller.rejectedRequirementDefinitionDraft?.revision;
  if (!revision) throw new Error("Expected an active rejected definition.");
  return revision;
}

function diagnostics(count: number): string {
  return [
    `Requirement definition has ${count} deterministic validation errors:`,
    ...Array.from({ length: count }, (_value, index) => `${index + 1}. Diagnostic ${index + 1}`),
  ].join("\n");
}
