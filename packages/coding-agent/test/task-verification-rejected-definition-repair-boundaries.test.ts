import { describe, expect, it } from "vitest";
import {
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
    ).toContain("requires exactly one repair item; received 0");
    expect(draft.input).toEqual(retained);
  });

  it("rejects combined repair deltas without mutating the retained draft", () => {
    const draft = rejectedRequirementDefinitionDraft(definitionInput())!;
    const retained = structuredClone(draft.input);

    expect(
      repairRejectedRequirementDefinition(draft, {
        action: "repair_definition",
        definition_revision: draft.revision,
        requirement_addition: {
          acceptance_criterion: "A second behavior is observable",
          source_prompt_indexes: [1],
          text: "Add a second behavior",
          type: "behavior",
        },
        ignored_source_prompt_upserts: [{ source_prompt_index: 2, reason: "Context only" }],
      }),
    ).toContain("requires exactly one repair item; received 2");
    expect(draft.input).toEqual(retained);
  });

  it("rejects a stale singular repair without replacing the active revision", () => {
    const draft = rejectedRequirementDefinitionDraft(definitionInput())!;
    const retained = structuredClone(draft.input);

    expect(
      repairRejectedRequirementDefinition(draft, {
        action: "repair_definition",
        definition_revision: "stale-revision",
        requirement_repairs: [{ requirement_index: 1, replacements: [] }],
      }),
    ).toContain("definition_revision is stale or unavailable");
    expect(draft.input).toEqual(retained);
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
