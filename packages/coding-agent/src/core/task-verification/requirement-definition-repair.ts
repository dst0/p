import { randomUUID } from "node:crypto";
import {
  MAX_REQUIREMENT_COUNT,
  MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS,
  MAX_REQUIREMENT_REPAIR_ENTRIES,
  MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH,
  MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS,
} from "./constants.ts";
import {
  selectedRequirementDefinitionDiagnosticDisappeared,
  selectRequirementDefinitionRepairTarget,
} from "./requirement-definition-repair-target.ts";
import type { RequirementAuditInput } from "./types.ts";

export interface RejectedRequirementDefinitionDraft {
  revision: string;
  diagnostics: string;
  input: RequirementAuditInput;
  repairLineageBaselineRequirementCount: number;
  bestDiagnosticCount: number;
  unproductiveRepairAttempts: number;
  knownNormativeSourceClauseIds?: string[];
}
type IgnoredPromptInput = NonNullable<RequirementAuditInput["ignored_source_prompts"]>[number];
type IgnoredClauseInput = NonNullable<RequirementAuditInput["ignored_source_clauses"]>[number];
type RequirementInput = NonNullable<RequirementAuditInput["requirements"]>[number];

export function rejectedDefinitionNextActionGuardMessage(draft: RejectedRequirementDefinitionDraft): string {
  return [
    "next_required_action: status",
    `definition_revision: ${draft.revision}`,
    'An active rejected definition blocks this action. Do not infer its controller-selected item; call record_task_verification with action "status" to restore the exact repair target and frozen source identity.',
  ].join("\n");
}
export function recordUnproductiveRejectedDefinitionRepair(draft: RejectedRequirementDefinitionDraft): void {
  draft.unproductiveRepairAttempts = Math.min(
    draft.unproductiveRepairAttempts + 1,
    MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS,
  );
}
export function rejectedRequirementDefinitionDraft(
  input: RequirementAuditInput,
  diagnostics: string = "",
  previousDraft?: RejectedRequirementDefinitionDraft,
  diagnosticCount: number = definitionDiagnosticCount(diagnostics),
): RejectedRequirementDefinitionDraft | undefined {
  if (input.action !== "define" || !input.requirements) return undefined;
  const currentDiagnosticCount = diagnosticCount;
  const previousBestDiagnosticCount = previousDraft?.bestDiagnosticCount ?? currentDiagnosticCount;
  const diagnosticCountImproved = previousDraft !== undefined && currentDiagnosticCount < previousBestDiagnosticCount;
  const previousTarget = previousDraft
    ? selectRequirementDefinitionRepairTarget(
        previousDraft.diagnostics,
        previousDraft.knownNormativeSourceClauseIds,
        previousDraft.input.requirements,
      )
    : undefined;
  const selectedDiagnosticResolved =
    previousTarget !== undefined && selectedRequirementDefinitionDiagnosticDisappeared(previousTarget, diagnostics);
  const repairMadeProgress = diagnosticCountImproved || selectedDiagnosticResolved;
  const draft: RejectedRequirementDefinitionDraft = {
    revision: randomUUID(),
    diagnostics,
    repairLineageBaselineRequirementCount:
      previousDraft?.repairLineageBaselineRequirementCount ?? input.requirements.length,
    bestDiagnosticCount: Math.min(previousBestDiagnosticCount, currentDiagnosticCount),
    knownNormativeSourceClauseIds: knownNormativeSourceClauseIds(diagnostics, previousDraft),
    unproductiveRepairAttempts: previousDraft
      ? repairMadeProgress
        ? 0
        : Math.min(previousDraft.unproductiveRepairAttempts + 1, MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS)
      : 0,
    input: {
      action: "define",
      requirements: structuredClone(input.requirements),
      ignored_source_prompts: structuredClone(input.ignored_source_prompts ?? []),
      ignored_source_clauses: structuredClone(input.ignored_source_clauses ?? []),
    },
  };
  return draft;
}

function knownNormativeSourceClauseIds(
  diagnostics: string,
  previousDraft: RejectedRequirementDefinitionDraft | undefined,
): string[] {
  const ids = new Set(previousDraft?.knownNormativeSourceClauseIds ?? []);
  for (const match of diagnostics.matchAll(/Source clause\s+([^\s,.;:]+)\s+is normative and cannot be ignored\b/gu)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

export function definitionDiagnosticCount(diagnostics: string): number {
  const count = diagnostics.match(/^Requirement definition has (\d+) deterministic validation errors(?:\s|:)/u)?.[1];
  return count ? Number(count) : diagnostics.trim() ? 1 : 0;
}

export function repairRejectedRequirementDefinition(
  draft: RejectedRequirementDefinitionDraft | undefined,
  repair: RequirementAuditInput,
  options: { allowLineageOverflowValidation?: boolean } = {},
): RequirementAuditInput | string {
  if (!draft || repair.definition_revision !== draft.revision) {
    return "The definition_revision is stale or unavailable. Resubmit one complete definition batch.";
  }
  if (repair.ignored_source_prompts || repair.ignored_source_clauses) {
    return "repair_definition requires one keyed repair item; complete ignored-source snapshots are define-only.";
  }
  const repairs = repair.requirement_repairs ?? [];
  const addition = repair.requirement_addition;
  const repairItemCount =
    repairs.length +
    (addition ? 1 : 0) +
    (repair.ignored_source_prompt_upserts?.length ?? 0) +
    (repair.ignored_source_prompt_removals?.length ?? 0) +
    (repair.ignored_source_clause_upserts?.length ?? 0) +
    (repair.ignored_source_clause_removals?.length ?? 0);
  if (repairItemCount !== MAX_REQUIREMENT_REPAIR_ENTRIES) {
    return `repair_definition requires exactly one repair item; received ${repairItemCount}.`;
  }
  const requirements = draft.input.requirements ?? [];
  const selectedTarget = selectRequirementDefinitionRepairTarget(
    draft.diagnostics,
    draft.knownNormativeSourceClauseIds,
    requirements,
  );
  const invalidIndexes = repairs
    .map((item) => item.requirement_index)
    .filter((index) => index < 1 || index > requirements.length);
  if (invalidIndexes.length > 0) {
    return `requirement_repairs references invalid rejected-batch indexes: ${invalidIndexes.join(", ")}.`;
  }
  const replacementCount = repairs.reduce((count, item) => count + item.replacements.length, 0);
  if (replacementCount > MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS) {
    return `requirement_repairs contains ${replacementCount} total replacements; sparse repair permits at most ${MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS}.`;
  }
  const duplicateConsolidationTarget =
    selectedTarget?.kind === "duplicate_consolidation" &&
    repairs.length === 1 &&
    repairs[0]?.requirement_index === selectedTarget.requirementIndex &&
    repairs[0].replacements.length === 0
      ? selectedTarget
      : undefined;
  const removedRequirementCount = duplicateConsolidationTarget?.removedRequirementIndexes.length ?? repairs.length;
  const mergedRequirementCount = requirements.length + replacementCount - removedRequirementCount + (addition ? 1 : 0);
  if (mergedRequirementCount === 0) {
    return "repair_definition cannot remove every requirement; preserve at least one item in the active rejected draft.";
  }
  if (mergedRequirementCount > MAX_REQUIREMENT_COUNT) {
    return `repair would create ${mergedRequirementCount} requirements; maximum is ${MAX_REQUIREMENT_COUNT}.`;
  }
  const lineageLimit = draft.repairLineageBaselineRequirementCount + MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH;
  if (mergedRequirementCount > lineageLimit && !options.allowLineageOverflowValidation) {
    return `repair lineage would grow from ${draft.repairLineageBaselineRequirementCount} to ${mergedRequirementCount} requirements; cumulative net growth permits at most ${MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH}.`;
  }
  const repairsByIndex = new Map(repairs.map((item) => [item.requirement_index, item.replacements]));
  const consolidatedRequirement = duplicateConsolidationTarget
    ? duplicateConsolidationTarget.removedRequirementIndexes.reduce(
        (preserved, requirementIndex) =>
          mergeDuplicateRequirementProvenance(preserved, requirements[requirementIndex - 1]!),
        requirements[duplicateConsolidationTarget.preservedRequirementIndex - 1]!,
      )
    : undefined;
  const consolidatedIndexes = new Set(duplicateConsolidationTarget?.removedRequirementIndexes ?? []);
  const mergedRequirements = requirements.flatMap((requirement, offset) => {
    const requirementIndex = offset + 1;
    if (consolidatedIndexes.has(requirementIndex)) return [];
    if (consolidatedRequirement && requirementIndex === duplicateConsolidationTarget?.preservedRequirementIndex) {
      return [consolidatedRequirement];
    }
    return structuredClone(repairsByIndex.get(requirementIndex) ?? [requirement]);
  });
  if (addition) mergedRequirements.push(structuredClone(addition));
  const ignoredSourcePrompts = mergeKeyedClassifications(
    draft.input.ignored_source_prompts ?? [],
    repair.ignored_source_prompt_upserts ?? [],
    repair.ignored_source_prompt_removals ?? [],
    (item) => item.source_prompt_index,
    "source prompt",
  );
  if (typeof ignoredSourcePrompts === "string") return ignoredSourcePrompts;
  const ignoredSourceClauses = mergeKeyedClassifications(
    draft.input.ignored_source_clauses ?? [],
    repair.ignored_source_clause_upserts ?? [],
    repair.ignored_source_clause_removals ?? [],
    (item) => item.source_clause_id,
    "source clause",
  );
  if (typeof ignoredSourceClauses === "string") return ignoredSourceClauses;
  return {
    action: "define",
    requirements: mergedRequirements,
    ignored_source_prompts: ignoredSourcePrompts,
    ignored_source_clauses: ignoredSourceClauses,
  };
}

function mergeDuplicateRequirementProvenance(preserved: RequirementInput, removed: RequirementInput): RequirementInput {
  const sourcePromptIndexes = mergeProvenance(preserved.source_prompt_indexes, removed.source_prompt_indexes);
  const sourceClauseIds = mergeProvenance(preserved.source_clause_ids, removed.source_clause_ids);
  const sourceFacetIds = mergeProvenance(preserved.source_facet_ids, removed.source_facet_ids);
  return {
    ...structuredClone(preserved),
    ...(sourcePromptIndexes.length > 0 ? { source_prompt_indexes: sourcePromptIndexes } : {}),
    ...(sourceClauseIds.length > 0 ? { source_clause_ids: sourceClauseIds } : {}),
    ...(sourceFacetIds.length > 0 ? { source_facet_ids: sourceFacetIds } : {}),
  };
}

function mergeProvenance<T extends string | number>(left: readonly T[] | undefined, right: readonly T[] | undefined) {
  return [...new Set([...(left ?? []), ...(right ?? [])])];
}

function mergeKeyedClassifications<T extends IgnoredPromptInput | IgnoredClauseInput, K extends string | number>(
  current: readonly T[],
  upserts: readonly T[],
  removals: readonly K[],
  keyOf: (item: T) => K,
  label: string,
): T[] | string {
  const upsertKeys = upserts.map(keyOf);
  const duplicateKeys = upsertKeys.filter((key, offset) => upsertKeys.indexOf(key) !== offset);
  if (duplicateKeys.length > 0)
    return `Ignored ${label} upserts contain duplicate keys: ${[...new Set(duplicateKeys)].join(", ")}.`;
  const removalKeys = new Set(removals);
  const conflicts = upsertKeys.filter((key) => removalKeys.has(key));
  if (conflicts.length > 0)
    return `Ignored ${label} keys cannot be both upserted and removed: ${conflicts.join(", ")}.`;
  const upsertByKey = new Map(upserts.map((item) => [keyOf(item), item]));
  const emitted = new Set<K>();
  const merged: T[] = [];
  for (const item of current) {
    const key = keyOf(item);
    if (removalKeys.has(key)) continue;
    const replacement = upsertByKey.get(key);
    if (replacement) {
      if (!emitted.has(key)) merged.push(structuredClone(replacement));
      emitted.add(key);
    } else {
      merged.push(structuredClone(item));
    }
  }
  for (const item of upserts) {
    const key = keyOf(item);
    if (!emitted.has(key)) merged.push(structuredClone(item));
  }
  return merged;
}
