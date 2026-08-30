import { REQUIREMENT_AUDIT_TOOL_NAME, TASK_VERIFICATION_TOOL_NAME } from "../constants.ts";
import { renderRequirementDefinitionPrompt } from "../requirement-definition-prompt.ts";
import {
  REQUIREMENT_REPAIR_IDENTITY_GUIDANCE,
  renderRequirementDefinitionRepairContext,
} from "../requirement-definition-repair-context.ts";
import { selectRequirementDefinitionRepairTarget } from "../requirement-definition-repair-target.ts";
import { requirementDefinitionSources } from "../requirement-source-storage.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";

export function formatTaskVerificationCompactionNextAction(self: TaskVerificationController): string {
  const draft = self.rejectedRequirementDefinitionDraft;
  if (!draft) {
    if (self.state.requirementAudit.status !== "verifying") return self.formatNextRequirement();
    return [
      `NEXT REQUIRED ACTION: Verify all ${self.state.requirementAudit.requirements.length} requirements and submit exactly one batched action "verdict" through ${REQUIREMENT_AUDIT_TOOL_NAME}.`,
      `Call ${TASK_VERIFICATION_TOOL_NAME} with action "status" to restore exact requirement IDs, acceptance criteria, and eligible evidence after compaction.`,
    ].join("\n");
  }
  const target = selectRequirementDefinitionRepairTarget(
    draft.diagnostics,
    draft.knownNormativeSourceClauseIds,
    draft.input.requirements,
  );
  const sources = requirementDefinitionSources(self.state, self.requirementSourceTexts);
  const repairPrompt = typeof sources === "string" ? undefined : renderRequirementDefinitionPrompt(sources, draft);
  if (repairPrompt?.repairActionable === false) {
    return [
      `definition_revision: ${draft.revision}`,
      "next_required_action: status",
      "The exact selected repair is not actionable within the bounded controller prompt. Do not infer source ordinals or submit a repair.",
      `Call ${TASK_VERIFICATION_TOOL_NAME} with action "status" to restore the authoritative recovery boundary.`,
    ].join("\n");
  }
  const repairContext =
    target && typeof sources !== "string"
      ? renderRequirementDefinitionRepairContext(target, sources, draft.input.requirements ?? [])
      : undefined;
  const identityResolved = repairContext?.identityResolved === true;
  return [
    `definition_revision: ${draft.revision}`,
    identityResolved ? "next_required_action: repair_definition" : "next_required_action: status",
    ...(repairContext ? [repairContext.text] : []),
    ...(identityResolved
      ? [
          REQUIREMENT_REPAIR_IDENTITY_GUIDANCE,
          `Use ${REQUIREMENT_AUDIT_TOOL_NAME} for exactly this controller-selected repair item.`,
          `Call ${TASK_VERIFICATION_TOOL_NAME} with action "status" only when the exact complete rejected batch is needed.`,
        ]
      : [
          "The selected repair source could not be resolved. Do not infer source ordinals or submit a repair.",
          `Call ${TASK_VERIFICATION_TOOL_NAME} with action "status" to restore authoritative source identity.`,
        ]),
  ].join("\n");
}
