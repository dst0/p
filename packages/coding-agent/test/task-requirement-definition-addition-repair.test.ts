import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { MAX_REQUIREMENT_COUNT, RequirementAuditSchema } from "../src/core/task-verification/constants.ts";
import {
  rejectedRequirementDefinitionDraft,
  repairRejectedRequirementDefinition,
} from "../src/core/task-verification/requirement-definition-repair.ts";
import {
  formatRejectedDefinitionRepairFeedback,
  formatRejectedDefinitionRepairGuidance,
} from "../src/core/task-verification/requirement-definition-repair-feedback.ts";
import { validateRequirementDefinition } from "../src/core/task-verification/requirement-definition-validation.ts";
import type { RequirementAuditInput, TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

describe("single requirement addition repair", () => {
  it("accepts one schema-level addition and appends it without replacing existing requirements", () => {
    const draft = rejectedRequirementDefinitionDraft(definition())!;
    const input = additionRepair(draft.revision, requirement("Recover with npm test", "S3-C7"));

    expect(Value.Check(RequirementAuditSchema, input)).toBe(true);
    expect(repairRejectedRequirementDefinition(draft, input)).toEqual({
      action: "define",
      requirements: [
        requirement("Implement the utility", "S2-C2"),
        requirement("Run test:unit", "S3-C6"),
        requirement("Recover with npm test", "S3-C7"),
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });
  });

  it("counts an addition with any other delta as two repair items", () => {
    const draft = rejectedRequirementDefinitionDraft(definition())!;
    const input: RequirementAuditInput = {
      ...additionRepair(draft.revision, requirement("Recover with npm test", "S3-C7")),
      requirement_repairs: [{ requirement_index: 1, replacements: [requirement("Implement slug", "S2-C2")] }],
    };

    expect(repairRejectedRequirementDefinition(draft, input)).toContain(
      "repair_definition requires exactly one repair item; received 2",
    );
  });

  it("gives an exact one-clause addition payload without requiring an indexed replacement", () => {
    const diagnostics = missingClauseDiagnostics("S3-C2", "S3-C7");
    const draft = rejectedRequirementDefinitionDraft(definition(), diagnostics)!;
    const feedback = formatRejectedDefinitionRepairFeedback("Definition rejected.", draft);
    const fullGuidance = formatRejectedDefinitionRepairGuidance("Definition rejected.", draft);

    for (const output of [feedback, fullGuidance]) {
      expect(output).toContain("requirement_addition");
      expect(output).toContain("Repair only S3-C2");
      expect(output).toContain('source_clause_ids:["S3-C2"]');
      expect(output).toContain("omit source_prompt_indexes and source_facet_ids");
    }
  });

  it("routes global-count capacity to one bounded classification or replacement repair", () => {
    const draft = rejectedRequirementDefinitionDraft(
      definitionAtCount(MAX_REQUIREMENT_COUNT),
      missingClauseDiagnostics("S97-C1"),
    )!;
    const feedback = formatRejectedDefinitionRepairFeedback("Definition rejected.", draft);

    expect(feedback).toContain("next_required_action: repair_definition");
    expect(feedback).toContain("ignored_source_clause_upserts");
    expect(feedback).not.toContain('"requirement_addition":');
  });

  it("routes multi-diagnostic lineage capacity to bounded repair but allows a final valid addition", () => {
    const baseline = rejectedRequirementDefinitionDraft(
      definitionAtCount(1),
      missingClauseDiagnostics("S1-C2", "S1-C3"),
    )!;
    const expandedInput = definitionAtCount(17);
    const blocked = rejectedRequirementDefinitionDraft(
      expandedInput,
      missingClauseDiagnostics("S18-C1", "S18-C2"),
      baseline,
    )!;
    const finalRepair = rejectedRequirementDefinitionDraft(
      expandedInput,
      missingClauseDiagnostics("S18-C1"),
      baseline,
    )!;

    const blockedFeedback = formatRejectedDefinitionRepairFeedback("Definition rejected.", blocked);
    expect(blockedFeedback).toContain("next_required_action: repair_definition");
    expect(blockedFeedback).toContain("ignored_source_clause_upserts");
    expect(blockedFeedback).not.toContain('"requirement_addition":');
    expect(formatRejectedDefinitionRepairFeedback("Definition rejected.", finalRepair)).toContain(
      "requirement_addition",
    );
  });

  it("reports each unclassified clause as one independently repairable diagnostic", () => {
    const prompts: TaskVerificationSourcePrompt[] = [
      {
        id: "spec",
        kind: "referenced_file",
        path: "SPEC.md",
        sha256: "a".repeat(64),
        text: "Implement alpha.\nImplement beta.\nImplement gamma.",
      },
    ];
    const validation = validateRequirementDefinition(prompts, {
      action: "define",
      requirements: [requirement("Implement alpha", "S1-C1")],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });

    expect(
      validation.diagnostics.filter((diagnostic) => diagnostic.includes("unclassified source_clause_ids")),
    ).toEqual([
      "Every referenced-file clause must be mapped or explicitly ignored; unclassified source_clause_ids: S1-C2.",
      "Every referenced-file clause must be mapped or explicitly ignored; unclassified source_clause_ids: S1-C3.",
    ]);
  });

  it("reports each unclassified direct prompt as one independently repairable diagnostic", () => {
    const prompts: TaskVerificationSourcePrompt[] = [
      { id: "one", kind: "user_prompt", text: "Implement alpha." },
      { id: "two", kind: "user_prompt", text: "Implement beta." },
      { id: "three", kind: "user_prompt", text: "Implement gamma." },
    ];
    const validation = validateRequirementDefinition(prompts, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Implement alpha",
          acceptance_criterion: "Alpha is implemented",
          source_prompt_indexes: [1],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });

    expect(validation.diagnostics.filter((diagnostic) => diagnostic.includes("unclassified indexes"))).toEqual([
      expect.stringContaining("unclassified indexes: 2"),
      expect.stringContaining("unclassified indexes: 3"),
    ]);
  });
});

function additionRepair(revision: string, addition: ReturnType<typeof requirement>): RequirementAuditInput {
  return {
    action: "repair_definition",
    definition_revision: revision,
    requirement_addition: addition,
  };
}

function definition(): RequirementAuditInput {
  return {
    action: "define",
    requirements: [requirement("Implement the utility", "S2-C2"), requirement("Run test:unit", "S3-C6")],
    ignored_source_prompts: [],
    ignored_source_clauses: [],
  };
}

function definitionAtCount(count: number): RequirementAuditInput {
  return {
    action: "define",
    requirements: Array.from({ length: count }, (_value, index) =>
      requirement(`Requirement ${index + 1}`, `S${index + 1}-C1`),
    ),
    ignored_source_prompts: [],
    ignored_source_clauses: [],
  };
}

function missingClauseDiagnostics(...sourceClauseIds: string[]): string {
  return [
    `Requirement definition has ${sourceClauseIds.length} deterministic validation errors:`,
    ...sourceClauseIds.map(
      (sourceClauseId, index) =>
        `${index + 1}. Every referenced-file clause must be mapped or explicitly ignored; unclassified source_clause_ids: ${sourceClauseId}.`,
    ),
  ].join("\n");
}

function requirement(text: string, sourceClauseId: string) {
  return {
    type: "workflow" as const,
    text,
    acceptance_criterion: `${text} succeeds`,
    source_clause_ids: [sourceClauseId],
  };
}
