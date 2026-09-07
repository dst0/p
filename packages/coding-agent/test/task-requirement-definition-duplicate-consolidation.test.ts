import { describe, expect, it } from "vitest";
import { formatRequirementDefinitionDiagnostics } from "../src/core/task-verification/requirement-definition-diagnostics.ts";
import {
  rejectedRequirementDefinitionDraft,
  repairRejectedRequirementDefinition,
} from "../src/core/task-verification/requirement-definition-repair.ts";
import {
  selectedRequirementDefinitionDiagnosticDisappeared,
  selectRequirementDefinitionRepairTarget,
} from "../src/core/task-verification/requirement-definition-repair-target.ts";
import { validateRequirementDefinition } from "../src/core/task-verification/requirement-definition-validation.ts";
import type { RequirementAuditInput } from "../src/core/task-verification/types.ts";

describe("duplicate requirement consolidation", () => {
  it("atomically removes the later duplicate and unions its provenance into the first", () => {
    const promptRequirement = requirement({ source_prompt_indexes: [1] });
    const clauseRequirement = requirement({ source_clause_ids: ["S2-C2"] });
    const draft = rejectedRequirementDefinitionDraft(
      {
        action: "define",
        requirements: [promptRequirement, differentRequirement(), clauseRequirement],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
      errors(`Duplicate requirement: ${promptRequirement.text}`),
    )!;
    const repair: RequirementAuditInput = {
      action: "repair_definition",
      definition_revision: draft.revision,
      requirement_repairs: [{ requirement_index: 3, replacements: [] }],
    };

    expect(repairRejectedRequirementDefinition(draft, repair)).toEqual({
      action: "define",
      requirements: [requirement({ source_prompt_indexes: [1], source_clause_ids: ["S2-C2"] }), differentRequirement()],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });
  });

  it("consolidates every later member of one exact duplicate group in one repair item", () => {
    const promptRequirement = requirement({ source_prompt_indexes: [1] });
    const clauseRequirement = requirement({ source_clause_ids: ["S2-C2"] });
    const facetRequirement = requirement({ source_facet_ids: ["S2-C2-F1"] });
    const draft = rejectedRequirementDefinitionDraft(
      {
        action: "define",
        requirements: [promptRequirement, differentRequirement(), clauseRequirement, facetRequirement],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
      errors(
        `Duplicate requirement: Requirement 3 duplicates Requirement 1: ${promptRequirement.text}`,
        `Duplicate requirement: Requirement 4 duplicates Requirement 1: ${promptRequirement.text}`,
      ),
    )!;

    expect(
      repairRejectedRequirementDefinition(draft, {
        action: "repair_definition",
        definition_revision: draft.revision,
        requirement_repairs: [{ requirement_index: 3, replacements: [] }],
      }),
    ).toEqual({
      action: "define",
      requirements: [
        requirement({
          source_prompt_indexes: [1],
          source_clause_ids: ["S2-C2"],
          source_facet_ids: ["S2-C2-F1"],
        }),
        differentRequirement(),
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });
  });

  it("keeps same-text duplicate groups distinguishable by indexed diagnostics", () => {
    const first = requirement({ source_prompt_indexes: [1] });
    const second = { ...first, type: "constraint" as const, acceptance_criterion: "A different criterion passes." };
    const requirements = [first, second, { ...first }, { ...second }];
    const diagnostics = duplicateDiagnostics(requirements);

    expect(diagnostics).toEqual([
      `Duplicate requirement: Requirement 3 duplicates Requirement 1: ${first.text}`,
      `Duplicate requirement: Requirement 4 duplicates Requirement 2: ${first.text}`,
    ]);
    const target = selectRequirementDefinitionRepairTarget(errors(...diagnostics), [], requirements)!;
    expect(target).toMatchObject({
      kind: "duplicate_consolidation",
      preservedRequirementIndex: 1,
      removedRequirementIndexes: [3],
    });
    expect(selectedRequirementDefinitionDiagnosticDisappeared(target, errors(diagnostics[1]!))).toBe(true);
  });

  it("selects an indexed duplicate group after diagnostic control characters are sanitized", () => {
    const controlledText = "Implement stable\u0000slug behavior.";
    const first = { ...requirement({ source_prompt_indexes: [1] }), text: controlledText };
    const requirements = [
      first,
      { ...first, source_prompt_indexes: undefined, source_clause_ids: ["S2-C2"] },
      { ...first, source_prompt_indexes: undefined, source_facet_ids: ["S2-C2-F1"] },
    ];
    const diagnostics = formatRequirementDefinitionDiagnostics([
      `Duplicate requirement: Requirement 2 duplicates Requirement 1: ${controlledText}`,
      `Duplicate requirement: Requirement 3 duplicates Requirement 1: ${controlledText}`,
    ]);

    expect(diagnostics).not.toContain("\u0000");
    expect(selectRequirementDefinitionRepairTarget(diagnostics, [], requirements)).toMatchObject({
      kind: "duplicate_consolidation",
      preservedRequirementIndex: 1,
      removedRequirementIndexes: [2, 3],
    });
  });
});

function requirement(
  provenance: Pick<
    NonNullable<RequirementAuditInput["requirement_addition"]>,
    "source_clause_ids" | "source_facet_ids" | "source_prompt_indexes"
  >,
) {
  return {
    type: "deliverable" as const,
    text: "Implement toStableSlug(input: string): string in src/slug.ts.",
    acceptance_criterion: "src/slug.ts exports the specified toStableSlug function.",
    ...provenance,
  };
}

function differentRequirement() {
  return {
    type: "verification" as const,
    text: "Run the contract tests.",
    acceptance_criterion: "The contract tests pass.",
    source_clause_ids: ["S3-C6"],
  };
}

function errors(...diagnostics: string[]): string {
  return [
    `Requirement definition has ${diagnostics.length} deterministic validation errors:`,
    ...diagnostics.map((diagnostic, index) => `${index + 1}. ${diagnostic}`),
  ].join("\n");
}

function duplicateDiagnostics(requirements: NonNullable<RequirementAuditInput["requirements"]>): string[] {
  const result = validateRequirementDefinition([{ id: "prompt", text: "Implement the stable slug utility." }], {
    action: "define",
    requirements,
    ignored_source_prompts: [],
    ignored_source_clauses: [],
  });
  return result.diagnostics.filter((diagnostic) => diagnostic.startsWith("Duplicate requirement:"));
}
