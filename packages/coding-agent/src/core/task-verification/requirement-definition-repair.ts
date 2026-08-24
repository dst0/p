import { randomUUID } from "node:crypto";
import {
  MAX_REQUIREMENT_COUNT,
  MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS,
  MAX_REQUIREMENT_REPAIR_ENTRIES,
  MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH,
} from "./constants.ts";
import type { RequirementAuditInput } from "./types.ts";

export interface RejectedRequirementDefinitionDraft {
  revision: string;
  diagnostics: string;
  input: RequirementAuditInput;
  repairLineageBaselineRequirementCount: number;
}

type IgnoredPromptInput = NonNullable<RequirementAuditInput["ignored_source_prompts"]>[number];
type IgnoredClauseInput = NonNullable<RequirementAuditInput["ignored_source_clauses"]>[number];

export type FreshDefinitionReason = "empty_definition" | "lineage_growth" | "recovery_prompt_limit";

// Authorization belongs to one ephemeral draft identity and must not survive structured cloning or draft rotation.
const freshDefinitionReasons = new WeakMap<RejectedRequirementDefinitionDraft, FreshDefinitionReason>();

export function authorizeRejectedDraftFreshDefinition(
  draft: RejectedRequirementDefinitionDraft,
  reason: FreshDefinitionReason,
): void {
  if (!freshDefinitionReasons.has(draft)) freshDefinitionReasons.set(draft, reason);
}

export function rejectedDraftFreshDefinitionReason(
  draft: RejectedRequirementDefinitionDraft | undefined,
): FreshDefinitionReason | undefined {
  return draft === undefined ? undefined : freshDefinitionReasons.get(draft);
}

export function rejectedDraftRequiresFreshDefinition(draft: RejectedRequirementDefinitionDraft | undefined): boolean {
  return rejectedDraftFreshDefinitionReason(draft) !== undefined;
}

export function rejectedDefinitionNextActionGuardMessage(draft: RejectedRequirementDefinitionDraft): string {
  const reason = rejectedDraftFreshDefinitionReason(draft);
  return reason
    ? `next_required_action: define\nA fresh define is required because ${freshDefinitionReasonText(reason)}. Resubmit one complete action "define" batch.`
    : 'next_required_action: repair_definition\nA fresh define is not authorized while the active rejected definition remains repairable. Use action "repair_definition" with the current definition_revision.';
}

export function rejectedRequirementDefinitionDraft(
  input: RequirementAuditInput,
  diagnostics: string = "",
  previousDraft?: RejectedRequirementDefinitionDraft,
): RejectedRequirementDefinitionDraft | undefined {
  if (input.action !== "define" || !input.requirements) return undefined;
  const draft: RejectedRequirementDefinitionDraft = {
    revision: randomUUID(),
    diagnostics,
    repairLineageBaselineRequirementCount:
      previousDraft?.repairLineageBaselineRequirementCount ?? input.requirements.length,
    input: {
      action: "define",
      requirements: structuredClone(input.requirements),
      ignored_source_prompts: structuredClone(input.ignored_source_prompts ?? []),
      ignored_source_clauses: structuredClone(input.ignored_source_clauses ?? []),
    },
  };
  if (input.requirements.length === 0) authorizeRejectedDraftFreshDefinition(draft, "empty_definition");
  return draft;
}

export function repairRejectedRequirementDefinition(
  draft: RejectedRequirementDefinitionDraft | undefined,
  repair: RequirementAuditInput,
): RequirementAuditInput | string {
  if (!draft || repair.definition_revision !== draft.revision) {
    return "The definition_revision is stale or unavailable. Resubmit one complete definition batch.";
  }
  if (repair.ignored_source_prompts || repair.ignored_source_clauses) {
    return "repair_definition requires keyed ignored-source upserts/removals; legacy ignored_source_prompts and ignored_source_clauses are complete define snapshots.";
  }
  const repairs = repair.requirement_repairs ?? [];
  if (
    repairs.length === 0 &&
    (repair.ignored_source_prompt_upserts?.length ?? 0) === 0 &&
    (repair.ignored_source_prompt_removals?.length ?? 0) === 0 &&
    (repair.ignored_source_clause_upserts?.length ?? 0) === 0 &&
    (repair.ignored_source_clause_removals?.length ?? 0) === 0
  ) {
    return "repair_definition requires at least one requirement repair or keyed classification change.";
  }
  if (repairs.length > MAX_REQUIREMENT_REPAIR_ENTRIES) {
    return `requirement_repairs contains ${repairs.length} entries; sparse repair permits at most ${MAX_REQUIREMENT_REPAIR_ENTRIES}.`;
  }
  const duplicateIndexes = repairs
    .map((item) => item.requirement_index)
    .filter((index, offset, indexes) => indexes.indexOf(index) !== offset);
  if (duplicateIndexes.length > 0) {
    return `requirement_repairs contains duplicate requirement indexes: ${[...new Set(duplicateIndexes)].join(", ")}.`;
  }
  const requirements = draft.input.requirements ?? [];
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
  const mergedRequirementCount = requirements.length + replacementCount - repairs.length;
  if (mergedRequirementCount === 0) {
    return "repair_definition cannot remove every requirement; preserve at least one item in the active rejected draft.";
  }
  if (mergedRequirementCount > MAX_REQUIREMENT_COUNT) {
    return `repair would create ${mergedRequirementCount} requirements; maximum is ${MAX_REQUIREMENT_COUNT}.`;
  }
  const lineageLimit = draft.repairLineageBaselineRequirementCount + MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH;
  if (mergedRequirementCount > lineageLimit) {
    authorizeRejectedDraftFreshDefinition(draft, "lineage_growth");
    return `repair lineage would grow from ${draft.repairLineageBaselineRequirementCount} to ${mergedRequirementCount} requirements; cumulative net growth permits at most ${MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH}.`;
  }
  const repairsByIndex = new Map(repairs.map((item) => [item.requirement_index, item.replacements]));
  const mergedRequirements = requirements.flatMap((requirement, offset) =>
    structuredClone(repairsByIndex.get(offset + 1) ?? [requirement]),
  );
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

export function requirementRepairChangesArity(repair: RequirementAuditInput): boolean {
  return (repair.requirement_repairs ?? []).some((item) => item.replacements.length !== 1);
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

export function formatRejectedDefinitionRepairGuidance(
  message: string,
  draft: RejectedRequirementDefinitionDraft | undefined,
  statusRequired: boolean = false,
): string {
  return [
    message,
    ...(draft
      ? [
          `definition_revision: ${draft.revision}`,
          ...(rejectedDraftFreshDefinitionReason(draft)
            ? [
                "next_required_action: define",
                `A fresh complete definition is required because ${freshDefinitionReasonText(rejectedDraftFreshDefinitionReason(draft)!)}. Sparse repair is no longer authorized for this rejected draft.`,
              ]
            : statusRequired
              ? [
                  'Indexes changed. Call record_task_verification with action "status" before another repair_definition call.',
                ]
              : [
                  "next_required_action: repair_definition",
                  `Continue corrections with action "repair_definition", this revision, and a bounded subset of requirement_repairs. Each repair atomically replaces one 1-based rejected-batch item with zero or more replacements; one call permits at most ${MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS} replacements total and one lineage may grow by at most ${MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH} requirements.`,
                  'Prioritize the smallest high-leverage subset; the complete merged batch is revalidated, so one repair call does not need to eliminate every remaining diagnostic. A fresh action "define" batch is forbidden unless the controller explicitly returns next_required_action: define.',
                ]),
          "Omitted requirements and keyed classification changes are retained. Repair classifications only with ignored_source_prompt_upserts/removals and ignored_source_clause_upserts/removals; legacy ignored-source arrays are complete define snapshots.",
          "The rejected draft is non-authoritative. The controller reconstructs and validates the complete batch before accepting any requirement or permitting mutation.",
        ]
      : [
          "Correct every diagnostic and resubmit the complete definition batch; rejection stored no authoritative requirement definition.",
        ]),
    'The original requirement-source catalog remains authoritative. If compaction hid it, call record_task_verification with action "status" to restore the current definition instructions.',
  ].join("\n\n");
}

function freshDefinitionReasonText(reason: FreshDefinitionReason): string {
  switch (reason) {
    case "empty_definition":
      return "the rejected batch contains no indexed requirement that sparse repair can target";
    case "lineage_growth":
      return "the active rejected definition exhausted its cumulative lineage growth budget";
    case "recovery_prompt_limit":
      return "the active rejected batch cannot be rendered within the recovery prompt limit";
  }
}
