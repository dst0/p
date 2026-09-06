import { MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH } from "./constants.ts";
import { formatCurrentRejectedDefinitionBatch } from "./rejected-definition-batch-format.ts";
import { definitionDiagnosticCount, type RejectedRequirementDefinitionDraft } from "./requirement-definition-repair.ts";
import {
  REQUIREMENT_REPAIR_IDENTITY_GUIDANCE,
  renderRequirementDefinitionRepairContext,
} from "./requirement-definition-repair-context.ts";
import {
  COMPLETE_REQUIREMENT_REPLACEMENT_GUIDANCE,
  SINGLE_REPAIR_ITEM_GUIDANCE,
} from "./requirement-definition-repair-guidance.ts";
import {
  formatSelectedRequirementDefinitionRepairGuidance,
  selectRequirementDefinitionRepairTarget,
} from "./requirement-definition-repair-target.ts";
import type { TaskVerificationSourcePrompt } from "./types.ts";

const UNRESOLVED_REPAIR_IDENTITY_GUIDANCE =
  'The selected repair identity could not be resolved from the frozen source catalog. Do not submit a repair or infer source ordinals; call record_task_verification with action "status".';

export function formatRejectedDefinitionRepairGuidance(
  message: string,
  draft: RejectedRequirementDefinitionDraft | undefined,
  sourcePrompts?: readonly TaskVerificationSourcePrompt[],
): string {
  const selectedTarget = draft
    ? selectRequirementDefinitionRepairTarget(
        draft.diagnostics,
        draft.knownNormativeSourceClauseIds,
        draft.input.requirements,
      )
    : undefined;
  const repairContext =
    draft && selectedTarget && sourcePrompts
      ? renderRequirementDefinitionRepairContext(selectedTarget, sourcePrompts, draft.input.requirements ?? [])
      : undefined;
  return [
    message,
    ...(draft
      ? [
          `definition_revision: ${draft.revision}`,
          ...formatCurrentRejectedDefinitionBatch(draft),
          repairContext?.identityResolved === false
            ? "next_required_action: status"
            : "next_required_action: repair_definition",
          selectedTarget && repairContext?.identityResolved !== false
            ? formatSelectedRequirementDefinitionRepairGuidance(selectedTarget, draft.revision)
            : selectedTarget
              ? UNRESOLVED_REPAIR_IDENTITY_GUIDANCE
              : SINGLE_REPAIR_ITEM_GUIDANCE,
          ...(repairContext ? [repairContext.text] : []),
          ...(selectedTarget && repairContext?.identityResolved !== false
            ? [REQUIREMENT_REPAIR_IDENTITY_GUIDANCE]
            : []),
          ...(repairContext?.identityResolved === false
            ? []
            : [
                `Each indexed repair atomically replaces that item with zero or more replacements; one lineage may grow by at most ${MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH} requirements.`,
                COMPLETE_REQUIREMENT_REPLACEMENT_GUIDANCE,
                'After one repair item, use the returned revision and controller-selected target. A replacement action "define" is never accepted while the rejected batch exists.',
                "Omitted requirements and classifications are retained. Complete ignored-source snapshots are define-only; a repair uses exactly one keyed upsert or removal.",
              ]),
          "The rejected draft is non-authoritative. The controller reconstructs and validates the complete batch before accepting any requirement or permitting mutation.",
        ]
      : [
          "Correct every diagnostic and resubmit the complete definition batch; rejection stored no authoritative requirement definition.",
        ]),
    'The original requirement-source catalog remains authoritative. If compaction hid it, call record_task_verification with action "status" to restore the current definition instructions.',
  ].join("\n\n");
}

export function formatRejectedDefinitionRepairFeedback(
  message: string,
  draft: RejectedRequirementDefinitionDraft,
  sourcePrompts?: readonly TaskVerificationSourcePrompt[],
): string {
  const selectedTarget = selectRequirementDefinitionRepairTarget(
    draft.diagnostics,
    draft.knownNormativeSourceClauseIds,
    draft.input.requirements,
  );
  const repairContext =
    selectedTarget && sourcePrompts
      ? renderRequirementDefinitionRepairContext(selectedTarget, sourcePrompts, draft.input.requirements ?? [])
      : undefined;
  const nextAction = [
    repairContext?.identityResolved === false
      ? "next_required_action: status"
      : "next_required_action: repair_definition",
    selectedTarget && repairContext?.identityResolved !== false
      ? formatSelectedRequirementDefinitionRepairGuidance(selectedTarget, draft.revision)
      : selectedTarget
        ? UNRESOLVED_REPAIR_IDENTITY_GUIDANCE
        : SINGLE_REPAIR_ITEM_GUIDANCE,
    ...(repairContext ? [repairContext.text] : []),
    ...(selectedTarget && repairContext?.identityResolved !== false ? [REQUIREMENT_REPAIR_IDENTITY_GUIDANCE] : []),
    ...(repairContext?.identityResolved === false ? [] : [COMPLETE_REQUIREMENT_REPLACEMENT_GUIDANCE]),
  ].join("\n");
  return [
    message,
    ...(message.includes(draft.diagnostics) ? [] : ["Active-draft diagnostics:", draft.diagnostics]),
    `definition_revision: ${draft.revision}`,
    `active_requirement_count: ${draft.input.requirements?.length ?? 0}`,
    `active_diagnostic_count: ${definitionDiagnosticCount(draft.diagnostics)}`,
    nextAction,
    "Omitted requirements and keyed classifications remain unchanged.",
    'For exact complete-batch recovery after compaction, call record_task_verification with action "status".',
  ].join("\n\n");
}
