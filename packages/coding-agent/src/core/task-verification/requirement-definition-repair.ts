import { randomUUID } from "node:crypto";
import {
  MAX_REQUIREMENT_COUNT,
  MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS,
  MAX_REQUIREMENT_REPAIR_ENTRIES,
  MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH,
  MAX_REQUIREMENT_REPAIR_STAGNANT_FRESH_DEFINITIONS,
  MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS,
} from "./constants.ts";
import { formatCurrentRejectedDefinitionBatch } from "./rejected-definition-batch-format.ts";
import type { RequirementAuditInput } from "./types.ts";

export interface RejectedRequirementDefinitionDraft {
  revision: string;
  diagnostics: string;
  input: RequirementAuditInput;
  repairLineageBaselineRequirementCount: number;
  bestDiagnosticCount: number;
  unproductiveRepairAttempts: number;
  consecutiveNonImprovingFreshDefinitions: number;
}
type IgnoredPromptInput = NonNullable<RequirementAuditInput["ignored_source_prompts"]>[number];
type IgnoredClauseInput = NonNullable<RequirementAuditInput["ignored_source_clauses"]>[number];
export type FreshDefinitionReason =
  | "empty_definition"
  | "lineage_growth"
  | "non_improving_fresh_definition"
  | "stagnant_definition"
  | "recovery_prompt_limit"
  | "stagnant_repair";
export type RejectedDefinitionTransition = "repair" | "fresh_definition";
export const COMPLETE_REQUIREMENT_REPLACEMENT_GUIDANCE =
  'Each repair replacement is a complete requirement object, not a patch; omitted provenance fields are deleted. When both independently apply, preserve them explicitly, for example {"source_prompt_indexes":[1],"source_clause_ids":["S2-C2"]}. Remove an accidental ignored-clause classification with ignored_source_clause_removals:["S2-C2"].';
export const SINGLE_REPAIR_ITEM_GUIDANCE =
  "Submit exactly one semantic repair item: one indexed requirement repair or one keyed classification change. One indexed requirement may split into multiple complete replacements.";
const FRESH_DEFINITION_FIELD_GUIDANCE =
  "Define fields only: action, requirements, ignored_source_prompts, and ignored_source_clauses. Never include selected_paths, adopt_changed_paths, ignored_paths, or repair fields.";

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
export function rejectedDraftRecoveryExhausted(draft: RejectedRequirementDefinitionDraft | undefined): boolean {
  return rejectedDraftFreshDefinitionReason(draft) === "stagnant_definition";
}

export function rejectedDefinitionNextActionGuardMessage(draft: RejectedRequirementDefinitionDraft): string {
  const reason = rejectedDraftFreshDefinitionReason(draft);
  if (reason === "stagnant_definition") {
    return `next_required_action: none\nDefinition recovery exhausted after ${MAX_REQUIREMENT_REPAIR_STAGNANT_FRESH_DEFINITIONS} consecutive non-improving complete definitions. No further define or repair transition is accepted for this task; preserve the workspace and start a fresh task or session with narrower, directly actionable requirements.`;
  }
  if (reason === "non_improving_fresh_definition") {
    return `next_required_action: define\nThe fresh definition has ${definitionDiagnosticCount(draft.diagnostics)} deterministic diagnostic(s); the historical best is ${draft.bestDiagnosticCount}. No sparse-repair budget was reopened. Submit a valid complete definition or one with fewer than ${draft.bestDiagnosticCount} diagnostics.\n${FRESH_DEFINITION_FIELD_GUIDANCE}`;
  }
  return reason
    ? `next_required_action: define\nA fresh define is required because ${freshDefinitionReasonText(reason)}. Resubmit one complete action "define" batch.\n${FRESH_DEFINITION_FIELD_GUIDANCE}`
    : 'next_required_action: repair_definition\nA fresh define is not authorized while the active rejected definition remains repairable. Use action "repair_definition" with the current definition_revision.';
}
export function recordUnproductiveRejectedDefinitionRepair(draft: RejectedRequirementDefinitionDraft): void {
  draft.unproductiveRepairAttempts += 1;
  if (draft.unproductiveRepairAttempts >= MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS) {
    authorizeRejectedDraftFreshDefinition(draft, "stagnant_repair");
  }
}
export function rejectedRequirementDefinitionDraft(
  input: RequirementAuditInput,
  diagnostics: string = "",
  previousDraft?: RejectedRequirementDefinitionDraft,
  transition: RejectedDefinitionTransition = "repair",
  diagnosticCount: number = definitionDiagnosticCount(diagnostics),
): RejectedRequirementDefinitionDraft | undefined {
  if (input.action !== "define" || !input.requirements) return undefined;
  const currentDiagnosticCount = diagnosticCount;
  const previousBestDiagnosticCount = previousDraft?.bestDiagnosticCount ?? currentDiagnosticCount;
  const diagnosticCountImproved = previousDraft !== undefined && currentDiagnosticCount < previousBestDiagnosticCount;
  const consecutiveNonImprovingFreshDefinitions =
    transition === "fresh_definition"
      ? diagnosticCountImproved
        ? 0
        : (previousDraft?.consecutiveNonImprovingFreshDefinitions ?? 0) + 1
      : (previousDraft?.consecutiveNonImprovingFreshDefinitions ?? 0);
  const draft: RejectedRequirementDefinitionDraft = {
    revision: randomUUID(),
    diagnostics,
    repairLineageBaselineRequirementCount:
      transition === "fresh_definition"
        ? input.requirements.length
        : (previousDraft?.repairLineageBaselineRequirementCount ?? input.requirements.length),
    bestDiagnosticCount: Math.min(previousBestDiagnosticCount, currentDiagnosticCount),
    consecutiveNonImprovingFreshDefinitions,
    unproductiveRepairAttempts: previousDraft
      ? diagnosticCountImproved
        ? 0
        : transition === "fresh_definition"
          ? MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS
          : previousDraft.unproductiveRepairAttempts + 1
      : 0,
    input: {
      action: "define",
      requirements: structuredClone(input.requirements),
      ignored_source_prompts: structuredClone(input.ignored_source_prompts ?? []),
      ignored_source_clauses: structuredClone(input.ignored_source_clauses ?? []),
    },
  };
  if (
    transition === "fresh_definition" &&
    consecutiveNonImprovingFreshDefinitions >= MAX_REQUIREMENT_REPAIR_STAGNANT_FRESH_DEFINITIONS
  ) {
    authorizeRejectedDraftFreshDefinition(draft, "stagnant_definition");
  } else if (transition === "fresh_definition" && !diagnosticCountImproved) {
    authorizeRejectedDraftFreshDefinition(draft, "non_improving_fresh_definition");
  } else if (input.requirements.length === 0) {
    authorizeRejectedDraftFreshDefinition(draft, "empty_definition");
  } else if (draft.unproductiveRepairAttempts >= MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS) {
    authorizeRejectedDraftFreshDefinition(draft, "stagnant_repair");
  }
  return draft;
}
export function definitionDiagnosticCount(diagnostics: string): number {
  const count = diagnostics.match(/^Requirement definition has (\d+) deterministic validation errors(?:\s|:)/u)?.[1];
  return count ? Number(count) : diagnostics.trim() ? 1 : 0;
}

export function rejectedRepairDoesNotWorsenHistoricalMinimum(
  draft: RejectedRequirementDefinitionDraft,
  diagnosticCount: number | undefined,
): boolean {
  return diagnosticCount !== undefined && diagnosticCount <= draft.bestDiagnosticCount;
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
  const repairItemCount =
    repairs.length +
    (repair.ignored_source_prompt_upserts?.length ?? 0) +
    (repair.ignored_source_prompt_removals?.length ?? 0) +
    (repair.ignored_source_clause_upserts?.length ?? 0) +
    (repair.ignored_source_clause_removals?.length ?? 0);
  if (repairItemCount !== MAX_REQUIREMENT_REPAIR_ENTRIES) {
    return `repair_definition requires exactly one repair item; received ${repairItemCount}.`;
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
  if (mergedRequirementCount > lineageLimit && !options.allowLineageOverflowValidation) {
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
): string {
  return [
    message,
    ...(draft
      ? [
          `definition_revision: ${draft.revision}`,
          ...formatCurrentRejectedDefinitionBatch(draft),
          ...(rejectedDraftFreshDefinitionReason(draft)
            ? rejectedDefinitionNextActionGuardMessage(draft).split("\n")
            : [
                "next_required_action: repair_definition",
                `Continue corrections with action "repair_definition", this current batch revision, and one current 1-based index. Each call corrects exactly one requirement or one keyed classification item. A requirement repair atomically replaces that one rejected-batch item with zero or more replacements; one lineage may grow by at most ${MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH} requirements.`,
                COMPLETE_REQUIREMENT_REPLACEMENT_GUIDANCE,
                'Address one repair item, then use the new revision and indexes returned after atomic merged-batch validation. A fresh action "define" batch is forbidden unless the controller explicitly returns next_required_action: define.',
              ]),
          "Omitted requirements and classifications are retained. Complete ignored-source snapshots are define-only; a repair uses exactly one keyed upsert or removal.",
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
    case "non_improving_fresh_definition":
      return "the fresh definition did not improve the historical diagnostic minimum";
    case "stagnant_definition":
      return "the complete-definition recovery budget was exhausted without a lower diagnostic count";
    case "recovery_prompt_limit":
      return "the active rejected batch cannot be rendered within the recovery prompt limit";
    case "stagnant_repair":
      return "consecutive repair attempts were unproductive";
  }
}
