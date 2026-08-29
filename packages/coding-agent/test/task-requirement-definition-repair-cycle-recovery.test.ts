import { describe, expect, it } from "vitest";
import {
  rejectedDraftFreshDefinitionReason,
  rejectedRequirementDefinitionDraft,
} from "../src/core/task-verification/requirement-definition-repair.ts";
import type { RequirementAuditInput } from "../src/core/task-verification/types.ts";

describe("requirement definition repair cycle recovery", () => {
  it("authorizes a fresh definition when diagnostics alternate without reducing their count", () => {
    const initial = rejectedRequirementDefinitionDraft(invalidDefinition(), "Diagnostic A");
    const alternate = rejectedRequirementDefinitionDraft(invalidDefinition(), "Diagnostic B", initial);
    const cycle = rejectedRequirementDefinitionDraft(invalidDefinition(), "Diagnostic A", alternate);
    const repeatedCycle = rejectedRequirementDefinitionDraft(invalidDefinition(), "Diagnostic B", cycle);

    expect(initial?.unproductiveRepairAttempts).toBe(0);
    expect(alternate?.unproductiveRepairAttempts).toBe(1);
    expect(cycle?.unproductiveRepairAttempts).toBe(2);
    expect(rejectedDraftFreshDefinitionReason(cycle)).toBeUndefined();
    expect(repeatedCycle?.unproductiveRepairAttempts).toBe(3);
    expect(rejectedDraftFreshDefinitionReason(repeatedCycle)).toBe("stagnant_repair");
  });

  it("resets stagnation only when a repair reaches a lower diagnostic count", () => {
    const initial = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnostics(3));
    const improved = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnostics(2), initial);
    const changedWithoutImprovement = rejectedRequirementDefinitionDraft(
      invalidDefinition(),
      diagnostics(2).replaceAll("Diagnostic", "Alternative"),
      improved,
    );

    expect(improved?.unproductiveRepairAttempts).toBe(0);
    expect(changedWithoutImprovement?.unproductiveRepairAttempts).toBe(1);
    expect(rejectedDraftFreshDefinitionReason(changedWithoutImprovement)).toBeUndefined();
  });
});

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

function diagnostics(count: number): string {
  return [
    `Requirement definition has ${count} deterministic validation errors:`,
    ...Array.from({ length: count }, (_value, index) => `${index + 1}. Diagnostic ${index + 1}`),
  ].join("\n");
}
