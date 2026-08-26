import { MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS } from "./constants.ts";
import {
  COMPLETE_REQUIREMENT_REPLACEMENT_GUIDANCE,
  definitionDiagnosticCount,
  type RejectedRequirementDefinitionDraft,
  rejectedDefinitionNextActionGuardMessage,
  rejectedDraftFreshDefinitionReason,
} from "./requirement-definition-repair.ts";

export function formatRejectedDefinitionRepairFeedback(
  message: string,
  draft: RejectedRequirementDefinitionDraft,
): string {
  const nextAction = rejectedDraftFreshDefinitionReason(draft)
    ? rejectedDefinitionNextActionGuardMessage(draft)
    : [
        "next_required_action: repair_definition",
        `Submit only changed indexed requirements or classifications, with at most ${MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS} replacements.`,
        COMPLETE_REQUIREMENT_REPLACEMENT_GUIDANCE,
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
