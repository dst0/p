import type { ToolDefinition } from "../../extensions/types.ts";
import { REQUIREMENT_AUDIT_TOOL_NAME, RequirementAuditSchema } from "../constants.ts";
import { requirementAuditForeignFieldError } from "../requirement-audit-action-fields.ts";
import {
  formatRejectedDefinitionRepairGuidance,
  rejectedDefinitionNextActionGuardMessage,
  rejectedDraftRequiresFreshDefinition,
  rejectedRequirementDefinitionDraft,
  repairRejectedRequirementDefinition,
  requirementRepairChangesArity,
} from "../requirement-definition-repair.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { VerificationResult } from "../types.ts";

export function do_createRequirementAuditToolDefinition(
  self: TaskVerificationController,
): ToolDefinition<typeof RequirementAuditSchema, VerificationResult> {
  return {
    name: REQUIREMENT_AUDIT_TOOL_NAME,
    label: "Requirement Audit",
    description:
      "Freeze explicitly referenced task specifications, define authoritative atomic user requirements, then record one evidence-backed verdict batch.",
    promptSnippet:
      "Define atomic user requirements and verify them with one complete verdict batch before a completion certificate can be issued.",
    promptGuidelines: [
      "Use action 'prepare_definition' before the first matching mutation when the controller lists referenced requirement-source candidates. Select 1-3 relevant paths and classify every remaining candidate with an ignored_paths reason.",
      "Use action 'define' only after prepare_definition or ready_to_finish asks for decomposition of the displayed sources.",
      "Include only user requirements; do not invent best practices or duplicate repository policy gates.",
      "Split every high-risk outcome and listed case into its own independently verifiable requirement.",
      "Reference every source prompt by 1-based index or explain why a non-task prompt is ignored.",
      "Classify every referenced-file clause exactly once: map normative clauses through source_clause_ids or list non-requirement clauses in ignored_source_clauses with a concrete classification and reason.",
      "The controller assigns stable R1, R2, ... IDs; never supply IDs during definition.",
      "After a rejected definition, use action 'repair_definition' with its definition_revision and the smallest useful subset of indexed replacements or splits; at most 16 replacements are allowed per call and cumulative lineage growth is capped at 16 requirements before a fresh define batch is required.",
      "In repair_definition, change classifications only through keyed ignored_source_prompt_upserts/removals or ignored_source_clause_upserts/removals; ignored_source_prompts and ignored_source_clauses remain complete define snapshots.",
      "For action 'verdict', submit exactly one verdicts item for every controller-assigned requirement ID in one tool call.",
      "Every verdict needs a reason. Every passed verdict requires current non-error evidence_refs.",
      "High-risk integrity, security, durability, transaction, and concurrency requirements need a relevant focused test with a positive passing result; generic suites and manual reproductions cannot prove them.",
    ],
    parameters: RequirementAuditSchema,
    executionMode: "sequential",
    execute: async (_id, params) => {
      const foreignFieldError = requirementAuditForeignFieldError(params);
      if (foreignFieldError) {
        const result = self.rejected(foreignFieldError);
        return { content: [{ type: "text", text: result.message }], details: result };
      }
      const activeDraft = self.rejectedRequirementDefinitionDraft;
      const requiredAction = rejectedDraftRequiresFreshDefinition(activeDraft) ? "define" : "repair_definition";
      if (activeDraft && params.action !== requiredAction) {
        const result = self.rejected(rejectedDefinitionNextActionGuardMessage(activeDraft));
        return { content: [{ type: "text", text: result.message }], details: result };
      }
      if (
        params.action === "repair_definition" &&
        self.requirementRepairStatusRevision !== undefined &&
        self.requirementRepairStatusRevision === self.rejectedRequirementDefinitionDraft?.revision
      ) {
        const result = self.rejected(
          'Requirement indexes changed after the last rejected repair. Call record_task_verification with action "status" before another repair_definition call.',
        );
        return { content: [{ type: "text", text: result.message }], details: result };
      }
      const changesArity = params.action === "repair_definition" && requirementRepairChangesArity(params);
      const previousRejectedDraft = self.rejectedRequirementDefinitionDraft;
      const repaired =
        params.action === "repair_definition"
          ? repairRejectedRequirementDefinition(self.rejectedRequirementDefinitionDraft, params)
          : params;
      const result = typeof repaired === "string" ? self.rejected(repaired) : self.applyRequirementAudit(repaired);
      if (
        result.status === "needs_action" &&
        result.state.requirementAudit?.status === "awaiting_definition" &&
        typeof repaired !== "string"
      ) {
        self.rejectedRequirementDefinitionDraft = rejectedRequirementDefinitionDraft(
          repaired,
          result.message,
          params.action === "repair_definition" ? previousRejectedDraft : undefined,
        );
        if (changesArity) {
          self.requirementRepairStatusRevision = self.rejectedRequirementDefinitionDraft?.revision;
        }
      } else if (result.status === "updated") {
        self.rejectedRequirementDefinitionDraft = undefined;
        self.requirementRepairStatusRevision = undefined;
      }
      const message =
        result.status !== "needs_action"
          ? result.message
          : params.action === "define" || params.action === "repair_definition"
            ? formatRejectedDefinitionRepairGuidance(
                result.message,
                self.rejectedRequirementDefinitionDraft,
                self.requirementRepairStatusRevision === self.rejectedRequirementDefinitionDraft?.revision,
              )
            : self.withGuidance(result.message);
      return { content: [{ type: "text", text: message }], details: result };
    },
  };
}
