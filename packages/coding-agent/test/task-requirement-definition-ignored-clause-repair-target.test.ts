import { describe, expect, it } from "vitest";
import {
  requirementAuditInputTargetsSelectedRepair,
  selectRequirementDefinitionRepairTarget,
} from "../src/core/task-verification/requirement-definition-repair-target.ts";
import type { RequirementAuditInput } from "../src/core/task-verification/types.ts";

describe("ignored source-clause repair target selection", () => {
  it.each([
    "Ignored source clause S2-C3 is invalid or lacks a reason.",
    "Source clause S2-C3 must use classification unsafe_instruction.",
    "Source clause S2-C3 is not a controller-detected unsafe instruction and cannot use unsafe_instruction.",
    "Source clause S2-C3 is normative and cannot be ignored as informational.",
    "Source clause S2-C3 is normative and cannot be ignored as example.",
    "Source clause S2-C3 is not structurally informational.",
    "Source clause S2-C3 is not structurally an example.",
    "Source clause S2-C3 may name superseded_by_source_prompt_index only with classification superseded.",
    "Superseded source clause S2-C3 requires a direct user prompt index.",
    "Direct user prompt 1 does not conflict with or supersede source clause S2-C3.",
    "Source clause S2-C3 cannot be both mapped and ignored.",
    "Source clause S2-C3 is ignored twice.",
  ])("requires removal of only the exact invalid classification for %s", (diagnostic) => {
    const target = selectRequirementDefinitionRepairTarget(errors(diagnostic));

    expect(target).toEqual({ kind: "ignored_clause_removal", sourceClauseId: "S2-C3", diagnostic });
    expect(
      requirementAuditInputTargetsSelectedRepair(repair({ ignored_source_clause_removals: ["S2-C3"] }), target!),
    ).toBe(true);
    expect(
      requirementAuditInputTargetsSelectedRepair(repair({ ignored_source_clause_removals: ["S2-C4"] }), target!),
    ).toBe(false);
    expect(
      requirementAuditInputTargetsSelectedRepair(
        repair({ requirement_repairs: [{ requirement_index: 1, replacements: [requirement()] }] }),
        target!,
      ),
    ).toBe(false);
  });

  it.each([
    "Ignored source clause (missing) is invalid or lacks a reason.",
    "Source clause S2-C3 is not structurally informational because another rule failed.",
  ])("keeps unknown or unaddressable diagnostic-only authority for %s", (diagnostic) => {
    expect(selectRequirementDefinitionRepairTarget(errors(diagnostic))).toEqual({
      kind: "diagnostic_only",
      diagnostic,
    });
  });
});

function errors(diagnostic: string): string {
  return `Requirement definition has 1 deterministic validation errors:\n1. ${diagnostic}`;
}

function repair(fields: Partial<RequirementAuditInput>): RequirementAuditInput {
  return { action: "repair_definition", definition_revision: "revision-1", ...fields };
}

function requirement() {
  return {
    type: "behavior" as const,
    text: "Perform the selected behavior",
    acceptance_criterion: "The selected behavior is observable",
  };
}
