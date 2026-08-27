import type { ToolDefinition } from "../../extensions/types.ts";
import {
  MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS,
  MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH,
  REQUIREMENT_AUDIT_TOOL_NAME,
  RequirementAuditSchema,
} from "../constants.ts";
import { requirementAuditForeignFieldError } from "../requirement-audit-action-fields.ts";
import {
  COMPLETE_REQUIREMENT_REPLACEMENT_GUIDANCE,
  definitionDiagnosticCount,
  formatRejectedDefinitionRepairGuidance,
  recordUnproductiveRejectedDefinitionRepair,
  rejectedDefinitionNextActionGuardMessage,
  rejectedDraftRecoveryExhausted,
  rejectedDraftRequiresFreshDefinition,
  rejectedRepairDoesNotWorsenHistoricalMinimum,
  rejectedRequirementDefinitionDraft,
  repairRejectedRequirementDefinition,
} from "../requirement-definition-repair.ts";
import {
  rejectedRepairExceedsLineageGrowth,
  rejectedRepairHasSemanticEffect,
} from "../requirement-definition-repair-candidate.ts";
import { formatRejectedDefinitionRepairFeedback } from "../requirement-definition-repair-feedback.ts";
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
      "For every new mutating task, use action 'define' and obtain one accepted complete requirement set before the first workspace mutation. After prepare_definition, define immediately from the displayed sources; without referenced candidates, define from the direct user prompts after task declaration.",
      "Include only user requirements; do not invent best practices or duplicate repository policy gates.",
      "Split every high-risk outcome and listed case into its own independently verifiable requirement.",
      "Use source_prompt_indexes only for direct user prompts. For referenced files, use source_clause_ids or source_facet_ids; the controller derives their prompt indexes.",
      "Classify every referenced-file clause exactly once: map normative clauses through source_clause_ids or list non-requirement clauses in ignored_source_clauses with a concrete classification and reason.",
      "The controller assigns stable R1, R2, ... IDs; never supply IDs during definition.",
      `After a rejected definition, use action 'repair_definition' with its current batch definition_revision and indexed replacements or splits; address every current diagnostic in one convergent call when possible, with at most ${MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS} replacements per call and normal cumulative lineage growth capped at ${MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH} requirements. A lineage-overflow candidate must pass atomic validation completely; an invalid overflow is never retained as the next repair draft.`,
      "Each adopted repair returns a new revision, compact current diagnostics, and the active requirement count. Use task-verification status only when compaction requires exact complete-batch recovery; unchanged requirements remain controller-side.",
      COMPLETE_REQUIREMENT_REPLACEMENT_GUIDANCE,
      "In repair_definition, change classifications only through keyed ignored_source_prompt_upserts/removals or ignored_source_clause_upserts/removals; ignored_source_prompts and ignored_source_clauses remain complete define snapshots.",
      "For action 'verdict', submit exactly one verdicts item for every controller-assigned requirement ID in one tool call.",
      "Every verdict needs a reason. Every passed verdict requires current non-error evidence_refs.",
      "High-risk integrity, security, durability, transaction, and concurrency requirements need a relevant focused test with a positive passing result; generic suites and manual reproductions cannot prove them.",
    ],
    parameters: RequirementAuditSchema,
    executionMode: "sequential",
    execute: async (_id, params) => {
      const activeDraft = self.rejectedRequirementDefinitionDraft;
      if (rejectedDraftRecoveryExhausted(activeDraft)) {
        const result = self.rejected(rejectedDefinitionNextActionGuardMessage(activeDraft!));
        return { content: [{ type: "text", text: result.message }], details: result, terminate: true };
      }
      const foreignFieldError = requirementAuditForeignFieldError(params);
      if (foreignFieldError) {
        if (params.action === "repair_definition" && activeDraft) {
          recordUnproductiveRejectedDefinitionRepair(activeDraft);
        }
        const result = self.rejected(foreignFieldError);
        const message = activeDraft
          ? formatRejectedDefinitionRepairFeedback(result.message, activeDraft)
          : result.message;
        return { content: [{ type: "text", text: message }], details: result };
      }
      const requiredAction = rejectedDraftRequiresFreshDefinition(activeDraft) ? "define" : "repair_definition";
      if (activeDraft && params.action !== requiredAction) {
        const result = self.rejected(rejectedDefinitionNextActionGuardMessage(activeDraft));
        return { content: [{ type: "text", text: result.message }], details: result };
      }
      const previousRejectedDraft = self.rejectedRequirementDefinitionDraft;
      const repaired =
        params.action === "repair_definition"
          ? repairRejectedRequirementDefinition(self.rejectedRequirementDefinitionDraft, params, {
              allowLineageOverflowValidation: true,
            })
          : params;
      if (params.action === "repair_definition" && typeof repaired === "string" && previousRejectedDraft) {
        recordUnproductiveRejectedDefinitionRepair(previousRejectedDraft);
      }
      if (
        params.action === "repair_definition" &&
        previousRejectedDraft &&
        typeof repaired !== "string" &&
        !rejectedRepairHasSemanticEffect(previousRejectedDraft, repaired)
      ) {
        recordUnproductiveRejectedDefinitionRepair(previousRejectedDraft);
        const result = self.rejected(
          "Repair was not validated or adopted because it makes no semantic change to the active rejected definition. The previous draft and definition_revision were retained.",
        );
        const message = formatRejectedDefinitionRepairFeedback(result.message, previousRejectedDraft);
        return { content: [{ type: "text", text: message }], details: result };
      }
      const lineageOverflow =
        params.action === "repair_definition" &&
        previousRejectedDraft &&
        typeof repaired !== "string" &&
        rejectedRepairExceedsLineageGrowth(previousRejectedDraft, repaired);
      const result = typeof repaired === "string" ? self.rejected(repaired) : self.applyRequirementAudit(repaired);
      const candidateDiagnosticCount = result.requirementDefinitionDiagnosticCount;
      if (
        params.action === "repair_definition" &&
        previousRejectedDraft &&
        typeof repaired !== "string" &&
        result.status === "needs_action" &&
        result.state.requirementAudit?.status === "awaiting_definition" &&
        (!rejectedRepairDoesNotWorsenHistoricalMinimum(previousRejectedDraft, candidateDiagnosticCount) ||
          lineageOverflow)
      ) {
        recordUnproductiveRejectedDefinitionRepair(previousRejectedDraft);
        const activeDiagnosticCount = definitionDiagnosticCount(previousRejectedDraft.diagnostics);
        const retainedMessage =
          candidateDiagnosticCount === undefined
            ? "Repair was not adopted because the controller rejection did not include structured requirement-definition diagnostics. The previous draft and definition_revision were retained."
            : lineageOverflow
              ? [
                  `Repair was not adopted because it would retain ${repaired.requirements?.length ?? 0} invalid requirements beyond the lineage limit of ${previousRejectedDraft.repairLineageBaselineRequirementCount + MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH}. Overflow candidates are validated atomically but only a fully valid overflow may replace the compact draft. The previous draft and definition_revision were retained.`,
                  "Candidate diagnostics:",
                  result.message,
                ].join("\n\n")
              : [
                  `Repair was not adopted because it produced ${candidateDiagnosticCount} deterministic diagnostic(s); the active draft has ${activeDiagnosticCount} and the historical best is ${previousRejectedDraft.bestDiagnosticCount}. The previous draft and definition_revision were retained.`,
                  "Candidate diagnostics:",
                  result.message,
                ].join("\n\n");
        const message = formatRejectedDefinitionRepairFeedback(retainedMessage, previousRejectedDraft);
        return { content: [{ type: "text", text: message }], details: result };
      }
      if (
        result.status === "needs_action" &&
        result.state.requirementAudit?.status === "awaiting_definition" &&
        typeof repaired !== "string" &&
        candidateDiagnosticCount !== undefined
      ) {
        const authorizedFreshDefinition =
          params.action === "define" && rejectedDraftRequiresFreshDefinition(previousRejectedDraft);
        self.rejectedRequirementDefinitionDraft = rejectedRequirementDefinitionDraft(
          repaired,
          result.message,
          params.action === "repair_definition" || authorizedFreshDefinition ? previousRejectedDraft : undefined,
          authorizedFreshDefinition ? "fresh_definition" : "repair",
          candidateDiagnosticCount,
        );
      } else if (result.status === "updated") {
        self.rejectedRequirementDefinitionDraft = undefined;
      }
      const message =
        result.status !== "needs_action"
          ? result.message
          : params.action === "define" || params.action === "repair_definition"
            ? params.action === "repair_definition" && self.rejectedRequirementDefinitionDraft
              ? formatRejectedDefinitionRepairFeedback(result.message, self.rejectedRequirementDefinitionDraft)
              : formatRejectedDefinitionRepairGuidance(result.message, self.rejectedRequirementDefinitionDraft)
            : self.withGuidance(result.message);
      return { content: [{ type: "text", text: message }], details: result };
    },
  };
}
