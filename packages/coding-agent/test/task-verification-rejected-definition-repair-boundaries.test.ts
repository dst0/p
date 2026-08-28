import { describe, expect, it } from "vitest";
import {
  authorizeRejectedDraftFreshDefinition,
  formatRejectedDefinitionRepairGuidance,
  rejectedRequirementDefinitionDraft,
  repairRejectedRequirementDefinition,
} from "../src/core/task-verification/requirement-definition-repair.ts";
import type { RequirementAuditInput } from "../src/core/task-verification/types.ts";

describe("task verification rejected-definition repair boundaries", () => {
  it("rejects an empty sparse repair without mutating the retained draft", () => {
    const draft = rejectedRequirementDefinitionDraft(definitionInput())!;
    const retained = structuredClone(draft.input);

    expect(
      repairRejectedRequirementDefinition(draft, {
        action: "repair_definition",
        definition_revision: draft.revision,
      }),
    ).toContain("requires at least one requirement repair or keyed classification change");
    expect(draft.input).toEqual(retained);
  });

  it.each([
    ["non_improving_fresh_definition", "No sparse-repair budget was reopened"],
    ["stagnant_definition", "Definition recovery exhausted"],
  ] as const)("explains why %s requires a fresh definition", (reason, expected) => {
    const draft = rejectedRequirementDefinitionDraft(definitionInput())!;
    authorizeRejectedDraftFreshDefinition(draft, reason);

    expect(formatRejectedDefinitionRepairGuidance("Rejected.", draft)).toContain(expected);
  });
});

function definitionInput(): RequirementAuditInput {
  return {
    action: "define",
    ignored_source_clauses: [],
    ignored_source_prompts: [],
    requirements: [
      {
        acceptance_criterion: "Inventory remains unchanged after a failed update",
        source_prompt_indexes: [1],
        text: "Preserve inventory after failure",
        type: "constraint",
      },
    ],
  };
}
