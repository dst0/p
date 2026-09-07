import type { RejectedRequirementDefinitionDraft } from "./requirement-definition-repair.ts";

const REQUIREMENT_COLUMNS = [
  "index",
  "type",
  "text",
  "acceptance_criterion",
  "source_prompt_indexes",
  "source_clause_ids",
  "source_facet_ids",
] as const;

export function formatCurrentRejectedDefinitionBatch(draft: RejectedRequirementDefinitionDraft): string[] {
  const requirements = (draft.input.requirements ?? []).map((requirement, index) => [
    index + 1,
    requirement.type,
    requirement.text,
    requirement.acceptance_criterion,
    requirement.source_prompt_indexes ?? null,
    requirement.source_clause_ids ?? null,
    requirement.source_facet_ids ?? null,
  ]);
  return [
    "Current merged rejected batch; requirement indexes below are the repair_definition indexes:",
    JSON.stringify({
      requirement_columns: REQUIREMENT_COLUMNS,
      requirements,
      ignored_source_prompts: draft.input.ignored_source_prompts ?? [],
      ignored_source_clauses: draft.input.ignored_source_clauses ?? [],
    }),
  ];
}
