import { describe, expect, it, vi } from "vitest";
import { MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS } from "../src/core/task-verification/constants.ts";
import { formatRequirementDefinitionPrompt } from "../src/core/task-verification/requirement-definition-prompt.ts";
import {
  rejectedDefinitionNextActionGuardMessage,
  rejectedRequirementDefinitionDraft,
} from "../src/core/task-verification/requirement-definition-repair.ts";
import { formatRejectedDefinitionRepairGuidance } from "../src/core/task-verification/requirement-definition-repair-feedback.ts";
import type { RequirementAuditInput } from "../src/core/task-verification/types.ts";
import {
  callRequirementAudit,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
} from "./task-requirement-audit-test-harness.ts";

describe("requirement definition cross-cycle stagnation", () => {
  it("states that repair replacements are complete objects without unrelated provenance examples", () => {
    const draft = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnostics("Invalid provenance", 1));
    const guidance = formatRejectedDefinitionRepairGuidance("Rejected", draft);
    expect(guidance).toContain("complete requirement object, not a patch");
    expect(guidance).toContain("omitted provenance fields are deleted");
    expect(guidance).toContain("Use requirement_addition only for the controller-selected missing source");
    expect(guidance).not.toContain('{"source_prompt_indexes":[1],"source_clause_ids":["S2-C2"]}');

    const recovery = formatRequirementDefinitionPrompt([{ id: "p1", text: "Implement the requirement." }], draft);
    expect(recovery).toContain("complete requirement object, not a patch");
    expect(recovery).toContain("omitted provenance fields are deleted");
  });

  it("saturates cross-cycle non-improvement without authorizing define or terminal recovery", () => {
    let draft = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnostics("Invalid provenance", 1));
    for (let attempt = 0; attempt < MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS + 3; attempt++) {
      draft = rejectedRequirementDefinitionDraft(
        invalidDefinition(`attempt-${attempt}`),
        diagnostics("Invalid provenance", 1),
        draft,
      );
    }
    expect(draft?.unproductiveRepairAttempts).toBe(MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS);
    expect(rejectedDefinitionNextActionGuardMessage(draft!)).toContain("next_required_action: status");
    expect(rejectedDefinitionNextActionGuardMessage(draft!)).toContain(
      'call record_task_verification with action "status"',
    );
  });

  it("blocks a replacement define while retaining the active singular-repair revision", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, invalidDefinition());
    const revision = currentRevision(harness);

    await nextModelTurn(harness);
    const blocked = await callRequirementAudit(harness.controller, validDefinition());
    expect(blocked).toContain("next_required_action: repair_definition");
    expect(blocked).toContain('replacement action "define" is never accepted');
    expect(currentRevision(harness)).toBe(revision);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input).toEqual(invalidDefinition());

    const directResult = await harness.controller.requirementAuditToolDefinition.execute(
      "requirement-audit-define-guard",
      validDefinition() as never,
      undefined,
      undefined,
      {} as never,
    );
    expect(directResult.terminate).not.toBe(true);
  });

  it("adopts a same-count repair that resolves the selected diagnostic, then clears on a valid repair", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    let attempt = 0;
    vi.spyOn(harness.controller, "applyRequirementAudit").mockImplementation(() => {
      attempt += 1;
      if (attempt === 3) {
        return {
          status: "updated",
          message: "Accepted final singular repair.",
          state: harness.controller.currentState,
        };
      }
      const message = diagnostics(attempt === 1 ? "Invalid provenance" : "Criterion is incomplete", 2);
      return {
        status: "needs_action",
        message,
        state: harness.controller.currentState,
        requirementDefinitionDiagnosticCount: 2,
      };
    });

    await callRequirementAudit(harness.controller, invalidDefinition());
    const firstRevision = currentRevision(harness);
    await nextModelTurn(harness);
    const productive = await callRequirementAudit(
      harness.controller,
      invalidRepair(firstRevision, "productive same-count change"),
    );
    const secondRevision = currentRevision(harness);
    expect(productive).toContain("Criterion is incomplete");
    expect(secondRevision).not.toBe(firstRevision);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.bestDiagnosticCount).toBe(2);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.unproductiveRepairAttempts).toBe(0);

    await nextModelTurn(harness);
    expect(await callRequirementAudit(harness.controller, invalidRepair(secondRevision, "valid final change"))).toBe(
      "Accepted final singular repair.",
    );
    expect(harness.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
  });
});

function invalidDefinition(change?: string): RequirementAuditInput {
  return {
    action: "define",
    requirements: [
      {
        type: "behavior",
        text: `Invalid requirement${change ? ` ${change}` : ""}`,
        acceptance_criterion: "Invalid requirement is repaired",
        source_prompt_indexes: [99],
      },
    ],
    ignored_source_prompts: [],
    ignored_source_clauses: [],
  };
}

function validDefinition(): RequirementAuditInput {
  return {
    action: "define",
    requirements: [
      {
        type: "behavior",
        text: "Valid requirement",
        acceptance_criterion: "Valid requirement is accepted",
        source_prompt_indexes: [1],
      },
    ],
    ignored_source_prompts: [],
    ignored_source_clauses: [],
  };
}

function invalidRepair(definitionRevision: string, change: string): RequirementAuditInput {
  return {
    action: "repair_definition",
    definition_revision: definitionRevision,
    requirement_repairs: [
      {
        requirement_index: 1,
        replacements: [invalidDefinition(change).requirements![0]!],
      },
    ],
  };
}

function currentRevision(harness: ReturnType<typeof createRequirementAuditHarness>): string {
  const revision = harness.controller.rejectedRequirementDefinitionDraft?.revision;
  if (!revision) throw new Error("Expected an active rejected definition.");
  return revision;
}

function diagnostics(firstDiagnostic: string, count: number): string {
  return [
    `Requirement definition has ${count} deterministic validation errors:`,
    `1. Requirement 1: ${firstDiagnostic}`,
    ...Array.from({ length: count - 1 }, (_value, index) => `${index + 2}. Diagnostic ${index + 2}`),
  ].join("\n");
}
