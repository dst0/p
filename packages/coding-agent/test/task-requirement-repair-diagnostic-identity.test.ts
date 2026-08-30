import { describe, expect, it } from "vitest";
import {
  firstRequirementDefinitionDiagnostic,
  selectedRequirementDefinitionDiagnosticDisappeared,
  selectRequirementDefinitionRepairTarget,
} from "../src/core/task-verification/requirement-definition-repair-target.ts";

describe("requirement repair diagnostic identity", () => {
  it("excludes generated diagnostic-count metadata from selected target identity", () => {
    const selected = selectRequirementDefinitionRepairTarget(
      errors("Requirement 8: Invalid provenance. [34 instances]"),
    );

    expect(firstRequirementDefinitionDiagnostic(errors("Requirement 8: Invalid provenance. [34 instances]"))).toBe(
      "Requirement 8: Invalid provenance.",
    );
    expect(selected).toBeDefined();
    expect(
      selectedRequirementDefinitionDiagnosticDisappeared(
        selected!,
        errors("Requirement 8: Invalid provenance. [12 instances]"),
      ),
    ).toBe(false);
    expect(
      selectedRequirementDefinitionDiagnosticDisappeared(selected!, errors("Requirement 8: Invalid provenance.")),
    ).toBe(false);
  });
});

function errors(diagnostic: string): string {
  return ["Requirement definition has deterministic validation errors:", `1. ${diagnostic}`].join("\n");
}
