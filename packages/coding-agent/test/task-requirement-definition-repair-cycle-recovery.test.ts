import { describe, expect, it } from "vitest";
import { rejectedRequirementDefinitionDraft } from "../src/core/task-verification/requirement-definition-repair.ts";
import type { RequirementAuditInput } from "../src/core/task-verification/types.ts";

describe("requirement definition repair cycle recovery", () => {
  it("keeps singular repairs open while each one resolves the selected diagnostic", () => {
    const initial = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnosticsFor("A", "B", "C"));
    const second = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnosticsFor("B", "C", "D"), initial);
    const third = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnosticsFor("C", "D", "E"), second);
    const fourth = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnosticsFor("D", "E", "F"), third);

    expect(initial?.unproductiveRepairAttempts).toBe(0);
    expect(second?.unproductiveRepairAttempts).toBe(0);
    expect(third?.unproductiveRepairAttempts).toBe(0);
    expect(fourth?.unproductiveRepairAttempts).toBe(0);
  });

  it("recognizes selected-diagnostic progress even when the total does not fall", () => {
    const initial = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnostics(3));
    const improved = rejectedRequirementDefinitionDraft(invalidDefinition(), diagnostics(2), initial);
    const changedWithoutImprovement = rejectedRequirementDefinitionDraft(
      invalidDefinition(),
      diagnostics(2).replaceAll("Diagnostic", "Alternative"),
      improved,
    );

    expect(improved?.unproductiveRepairAttempts).toBe(0);
    expect(changedWithoutImprovement?.unproductiveRepairAttempts).toBe(0);
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

function diagnosticsFor(...identities: string[]): string {
  return [
    `Requirement definition has ${identities.length} deterministic validation errors:`,
    ...identities.map((identity, index) => `${index + 1}. Diagnostic ${identity}`),
  ].join("\n");
}
