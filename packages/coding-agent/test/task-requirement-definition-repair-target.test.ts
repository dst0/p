import { describe, expect, it } from "vitest";
import {
  firstRequirementDefinitionDiagnostic,
  formatSelectedRequirementDefinitionRepairGuidance,
  type RequirementDefinitionRepairTarget,
  requirementAuditInputTargetsSelectedRepair,
  selectedRequirementDefinitionDiagnosticDisappeared,
  selectRequirementDefinitionRepairTarget,
} from "../src/core/task-verification/requirement-definition-repair-target.ts";
import type { RequirementAuditInput } from "../src/core/task-verification/types.ts";

describe("controller-selected singular requirement repair target", () => {
  it("parses and selects only the first numbered deterministic diagnostic", () => {
    const diagnostics = errors(
      "Requirement 8: Source clause S3-C5 does not semantically support the mapped requirement.",
      "Every referenced-file clause must be mapped or explicitly ignored; unclassified source_clause_ids: S3-C5.",
    );

    expect(firstRequirementDefinitionDiagnostic(diagnostics)).toBe(
      "Requirement 8: Source clause S3-C5 does not semantically support the mapped requirement.",
    );
    expect(selectRequirementDefinitionRepairTarget(diagnostics)).toEqual({
      kind: "requirement",
      requirementIndex: 8,
      diagnostic: "Requirement 8: Source clause S3-C5 does not semantically support the mapped requirement.",
    });
    expect(firstRequirementDefinitionDiagnostic("Definition rejected.")).toBe("Definition rejected.");
  });

  it.each([
    "Source clause S2-C3 is normative and cannot be ignored as informational.",
    "Source clause S2-C3 cannot be both mapped and ignored.",
    "Source clause S2-C3 is not structurally informational.",
  ])("selects the exact ignored-clause removal for %s", (diagnostic) => {
    expect(selectRequirementDefinitionRepairTarget(errors(diagnostic))).toEqual({
      kind: "ignored_clause_removal",
      sourceClauseId: "S2-C3",
      diagnostic,
    });
  });

  it("selects the first unclassified clause or direct-prompt index", () => {
    expect(
      selectRequirementDefinitionRepairTarget(
        errors(
          "Every referenced-file clause must be mapped or explicitly ignored; unclassified source_clause_ids: S3-C2, S3-C7.",
        ),
      ),
    ).toMatchObject({ kind: "clause_classify_or_add", sourceClauseId: "S3-C2" });
    expect(
      selectRequirementDefinitionRepairTarget(
        errors("Every direct user prompt must be mapped or explicitly ignored; unclassified indexes: 4, 7."),
      ),
    ).toMatchObject({ kind: "prompt_classify_or_add", sourcePromptIndex: 4 });
  });

  it("requires addition when an unclassified clause is already known normative", () => {
    const target = selectRequirementDefinitionRepairTarget(errors("Unclassified source_clause_ids: S3-C7."), ["S3-C7"]);
    expect(target).toMatchObject({ kind: "clause_addition", sourceClauseId: "S3-C7" });
    expect(
      requirementAuditInputTargetsSelectedRepair(
        repair({ requirement_addition: requirement({ source_clause_ids: ["S3-C7"] }) }),
        target!,
      ),
    ).toBe(true);
    expect(
      requirementAuditInputTargetsSelectedRepair(
        repair({
          ignored_source_clause_upserts: [
            { source_clause_id: "S3-C7", classification: "informational", reason: "Incorrectly ignored" },
          ],
        }),
        target!,
      ),
    ).toBe(false);
  });

  it("makes clause-only provenance explicit without a contradictory mixed-source example", () => {
    const target = selectRequirementDefinitionRepairTarget(errors("Unclassified source_clause_ids: S2-C2."), ["S2-C2"]);

    const guidance = formatSelectedRequirementDefinitionRepairGuidance(target!, "revision-1");

    expect(guidance).toContain('source_clause_ids:["S2-C2"]');
    expect(guidance).toContain("omit source_prompt_indexes and source_facet_ids");
    expect(guidance).not.toContain('source_prompt_indexes":[1]');
  });

  it("selects and permits deletion of only the later exact duplicate", () => {
    const duplicate = requirement({ source_prompt_indexes: [1] });
    const requirements = [
      duplicate,
      { ...requirement({ source_clause_ids: ["S2-C3"] }), text: "Different requirement" },
      { ...duplicate, source_prompt_indexes: undefined, source_clause_ids: ["S2-C2"] },
    ];
    const target = selectRequirementDefinitionRepairTarget(
      errors(`Duplicate requirement: ${duplicate.text}`),
      [],
      requirements,
    );

    expect(target).toMatchObject({
      kind: "duplicate_consolidation",
      requirementIndex: 3,
      preservedRequirementIndex: 1,
    });
    expect(
      requirementAuditInputTargetsSelectedRepair(
        repair({ requirement_repairs: [{ requirement_index: 3, replacements: [] }] }),
        target!,
      ),
    ).toBe(true);
    expect(
      requirementAuditInputTargetsSelectedRepair(
        repair({ requirement_repairs: [{ requirement_index: 3, replacements: [requirement()] }] }),
        target!,
      ),
    ).toBe(false);
    expect(formatSelectedRequirementDefinitionRepairGuidance(target!, "revision-1")).toContain(
      'requirement_repairs:[{"requirement_index":3,"replacements":[]}]',
    );
  });

  it("keeps an unknown first diagnostic diagnostic-only instead of skipping ahead", () => {
    const diagnostic = "Requirement provenance is inconsistent.";
    const target = selectRequirementDefinitionRepairTarget(
      errors(diagnostic, "Every direct user prompt must be mapped or explicitly ignored; unclassified indexes: 2."),
    );
    expect(target).toEqual({ kind: "diagnostic_only", diagnostic });
    expect(requirementAuditInputTargetsSelectedRepair(repair({ requirement_addition: requirement() }), target!)).toBe(
      true,
    );
  });

  it("accepts only a singular complete indexed repair for the selected requirement", () => {
    const target = targetFrom(errors("Requirement 3: Invalid provenance."));
    const valid = repair({ requirement_repairs: [{ requirement_index: 3, replacements: [requirement()] }] });

    expect(requirementAuditInputTargetsSelectedRepair(valid, target)).toBe(true);
    expect(
      requirementAuditInputTargetsSelectedRepair(
        repair({ requirement_repairs: [{ requirement_index: 2, replacements: [requirement()] }] }),
        target,
      ),
    ).toBe(false);
    expect(
      requirementAuditInputTargetsSelectedRepair(
        repair({
          requirement_repairs: [{ requirement_index: 3, replacements: [{} as ReturnType<typeof requirement>] }],
        }),
        target,
      ),
    ).toBe(false);
    expect(
      requirementAuditInputTargetsSelectedRepair(
        repair({
          requirement_addition: requirement({ source_clause_ids: ["S3-C1"] }),
          requirement_repairs: [{ requirement_index: 3, replacements: [requirement()] }],
        }),
        target,
      ),
    ).toBe(false);
  });

  it("binds ignored-clause removal to the exact selected clause", () => {
    const target = targetFrom(errors("Source clause S2-C3 is not structurally informational."));

    expect(
      requirementAuditInputTargetsSelectedRepair(repair({ ignored_source_clause_removals: ["S2-C3"] }), target),
    ).toBe(true);
    expect(
      requirementAuditInputTargetsSelectedRepair(repair({ ignored_source_clause_removals: ["S2-C4"] }), target),
    ).toBe(false);
  });

  it("accepts only an exact clause addition or classification", () => {
    const target = targetFrom(errors("Unclassified source_clause_ids: S3-C7."));

    expect(
      requirementAuditInputTargetsSelectedRepair(
        repair({ requirement_addition: requirement({ source_clause_ids: ["S3-C7"] }) }),
        target,
      ),
    ).toBe(true);
    expect(
      requirementAuditInputTargetsSelectedRepair(
        repair({
          ignored_source_clause_upserts: [
            { source_clause_id: "S3-C7", classification: "informational", reason: "Non-normative example" },
          ],
        }),
        target,
      ),
    ).toBe(true);
    expect(
      requirementAuditInputTargetsSelectedRepair(
        repair({ requirement_addition: requirement({ source_clause_ids: ["S3-C7", "S3-C8"] }) }),
        target,
      ),
    ).toBe(false);
  });

  it("accepts only an exact direct-prompt addition or classification", () => {
    const target = targetFrom(errors("Unclassified indexes: 2."));

    expect(
      requirementAuditInputTargetsSelectedRepair(
        repair({ requirement_addition: requirement({ source_prompt_indexes: [2] }) }),
        target,
      ),
    ).toBe(true);
    expect(
      requirementAuditInputTargetsSelectedRepair(
        repair({ ignored_source_prompt_upserts: [{ source_prompt_index: 2, reason: "Superseded request" }] }),
        target,
      ),
    ).toBe(true);
    expect(
      requirementAuditInputTargetsSelectedRepair(
        repair({ requirement_addition: requirement({ source_prompt_indexes: [2, 3] }) }),
        target,
      ),
    ).toBe(false);
  });

  it("reports identity progress when the selected diagnostic disappears", () => {
    const selected = targetFrom(errors("Requirement 8: Source clause S3-C5 is unsupported."));

    expect(
      selectedRequirementDefinitionDiagnosticDisappeared(
        selected,
        errors("Requirement 8: Source clause S3-C5 is unsupported."),
      ),
    ).toBe(false);
    expect(
      selectedRequirementDefinitionDiagnosticDisappeared(
        selected,
        errors("Every referenced-file clause is unclassified; unclassified source_clause_ids: S3-C5."),
      ),
    ).toBe(true);
    expect(selectedRequirementDefinitionDiagnosticDisappeared(selected, "")).toBe(true);

    const single = targetFrom("Definition rejected.");
    expect(selectedRequirementDefinitionDiagnosticDisappeared(single, "Definition rejected.")).toBe(false);
    expect(selectedRequirementDefinitionDiagnosticDisappeared(single, "Different rejection.")).toBe(true);
  });

  it("formats compact imperative guidance for every target kind", () => {
    const targets = [
      targetFrom(errors("Requirement 3: Invalid provenance.")),
      targetFrom(errors("Source clause S2-C3 cannot be both mapped and ignored.")),
      selectRequirementDefinitionRepairTarget(errors("Unclassified source_clause_ids: S3-C7."), ["S3-C7"])!,
      targetFrom(errors("Unclassified source_clause_ids: S3-C7.")),
      targetFrom(errors("Unclassified indexes: 2.")),
      targetFrom(errors("Unknown deterministic diagnostic.")),
    ];

    for (const target of targets) {
      const guidance = formatSelectedRequirementDefinitionRepairGuidance(target, "revision-1");
      expect(guidance).toContain('action "repair_definition"');
      expect(guidance).toContain('definition_revision "revision-1"');
      expect(guidance).toMatch(/Repair only|Remove only|Resolve only|Add only/u);
      expect(guidance.length).toBeLessThan(420);
    }
  });
});

function errors(...diagnostics: string[]): string {
  return [
    `Requirement definition has ${diagnostics.length} deterministic validation errors:`,
    ...diagnostics.map((diagnostic, index) => `${index + 1}. ${diagnostic}`),
  ].join("\n");
}

function targetFrom(diagnostics: string): RequirementDefinitionRepairTarget {
  const target = selectRequirementDefinitionRepairTarget(diagnostics);
  if (!target) throw new Error("Expected a repair target");
  return target;
}

function repair(fields: Partial<RequirementAuditInput>): RequirementAuditInput {
  return { action: "repair_definition", definition_revision: "revision-1", ...fields };
}

function requirement(
  provenance: Pick<
    NonNullable<RequirementAuditInput["requirement_addition"]>,
    "source_clause_ids" | "source_prompt_indexes"
  > = {},
) {
  return {
    type: "behavior" as const,
    text: "Perform the selected behavior",
    acceptance_criterion: "The selected behavior is observable",
    ...provenance,
  };
}
