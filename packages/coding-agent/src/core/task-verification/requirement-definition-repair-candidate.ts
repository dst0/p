import { isDeepStrictEqual } from "node:util";
import { MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH } from "./constants.ts";
import { normalizeText } from "./tool-classification.ts";
import type { RequirementAuditInput } from "./types.ts";

interface RejectedRepairDraftSnapshot {
  input: RequirementAuditInput;
  repairLineageBaselineRequirementCount: number;
}

export function rejectedRepairHasSemanticEffect(
  draft: RejectedRepairDraftSnapshot,
  candidate: RequirementAuditInput,
): boolean {
  return !isDeepStrictEqual(canonicalDefinitionInput(candidate), canonicalDefinitionInput(draft.input));
}

function canonicalDefinitionInput(input: RequirementAuditInput): object {
  return {
    action: input.action,
    requirements: (input.requirements ?? []).map((requirement) => ({
      type: requirement.type,
      text: normalizeText(requirement.text),
      acceptance_criterion: normalizeText(requirement.acceptance_criterion),
      ...canonicalArrayField("source_prompt_indexes", requirement.source_prompt_indexes, (left, right) => left - right),
      ...canonicalArrayField("source_clause_ids", requirement.source_clause_ids, compareStrings),
      ...canonicalArrayField("source_facet_ids", requirement.source_facet_ids, compareStrings),
    })),
    ignored_source_prompts: (input.ignored_source_prompts ?? [])
      .map((item) => ({ source_prompt_index: item.source_prompt_index, reason: normalizeText(item.reason) }))
      .sort((left, right) =>
        left.source_prompt_index === right.source_prompt_index
          ? compareStrings(left.reason, right.reason)
          : left.source_prompt_index - right.source_prompt_index,
      ),
    ignored_source_clauses: (input.ignored_source_clauses ?? [])
      .map((item) => ({
        source_clause_id: normalizeText(item.source_clause_id),
        classification: item.classification,
        reason: normalizeText(item.reason),
        ...(item.superseded_by_source_prompt_index === undefined
          ? {}
          : { superseded_by_source_prompt_index: item.superseded_by_source_prompt_index }),
      }))
      .sort((left, right) => compareStrings(JSON.stringify(left), JSON.stringify(right))),
  };
}

function canonicalArrayField<K extends string, T>(
  key: K,
  values: readonly T[] | undefined,
  compare: (left: T, right: T) => number,
): { [P in K]?: T[] } {
  return values && values.length > 0 ? ({ [key]: [...values].sort(compare) } as { [P in K]: T[] }) : {};
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function rejectedRepairExceedsLineageGrowth(
  draft: RejectedRepairDraftSnapshot,
  candidate: RequirementAuditInput,
): boolean {
  return (
    (candidate.requirements?.length ?? 0) >
    draft.repairLineageBaselineRequirementCount + MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH
  );
}
