import type { ToolDefinition } from "../../extensions/types.ts";
import {
  MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS,
  MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH,
  REQUIREMENT_AUDIT_TOOL_NAME,
  RequirementAuditSchema,
} from "../constants.ts";
import { requirementAuditForeignFieldError } from "../requirement-audit-action-fields.ts";
import { renderRequirementDefinitionPrompt } from "../requirement-definition-prompt.ts";
import {
  recordUnproductiveRejectedDefinitionRepair,
  rejectedRequirementDefinitionDraft,
  repairRejectedRequirementDefinition,
} from "../requirement-definition-repair.ts";
import {
  rejectedRepairExceedsLineageGrowth,
  rejectedRepairHasSemanticEffect,
} from "../requirement-definition-repair-candidate.ts";
import {
  formatRejectedDefinitionRepairFeedback,
  formatRejectedDefinitionRepairGuidance,
} from "../requirement-definition-repair-feedback.ts";
import { COMPLETE_REQUIREMENT_REPLACEMENT_GUIDANCE } from "../requirement-definition-repair-guidance.ts";
import {
  requirementAuditInputTargetsSelectedRepair,
  selectedRequirementDefinitionDiagnosticDisappeared,
  selectRequirementDefinitionRepairTarget,
} from "../requirement-definition-repair-target.ts";
import { requirementDefinitionSources } from "../requirement-source-storage.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { RequirementAuditInput, VerificationResult } from "../types.ts";
import { formatTaskVerificationCompactionNextAction } from "./task-verification-compaction-context.ts";
import { taskVerificationContextExtract } from "./task-verification-context-extract.ts";

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
      "For every new mutating task, obtain one accepted complete requirement set. Define before the first workspace mutation when no referenced source is selected. After prepare_definition selects any authoritative source, implement from the frozen snapshots and direct prompts, then define their complete combined requirement set when the controller reports evidence readiness.",
      "Include only user requirements; do not invent best practices or duplicate repository policy gates.",
      "Split every high-risk outcome and listed case into its own independently verifiable requirement.",
      "Use source_prompt_indexes only for direct user prompts. For referenced files, use source_clause_ids or source_facet_ids; the controller derives their prompt indexes.",
      "Classify every referenced-file clause exactly once: map normative clauses through source_clause_ids or list non-requirement clauses in ignored_source_clauses with a concrete classification and reason.",
      "The controller assigns stable R1, R2, ... IDs; never supply IDs during definition.",
      `After a rejected definition, use action 'repair_definition' with its current definition_revision and exactly one repair item: one indexed requirement replacement/split, one requirement_addition, or one keyed classification upsert/removal. A requirement split may contain at most ${MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS} replacements and normal cumulative lineage growth is capped at ${MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH} requirements. A lineage-overflow candidate must pass atomic validation completely; an invalid overflow is never retained as the next repair draft.`,
      "Each adopted repair returns a new revision, compact current diagnostics, and the active requirement count. Use task-verification status only when compaction requires exact complete-batch recovery; unchanged requirements remain controller-side.",
      COMPLETE_REQUIREMENT_REPLACEMENT_GUIDANCE,
      "In repair_definition, complete ignored-source snapshots are forbidden; correct exactly one classification item with one keyed upsert or removal.",
      "For action 'verdict', submit exactly one verdicts item for every controller-assigned requirement ID in one tool call.",
      "Every verdict needs a reason. Every passed verdict requires current non-error evidence_refs.",
      "High-risk integrity, security, durability, transaction, and concurrency requirements need a relevant focused test with a positive passing result; generic suites and manual reproductions cannot prove them.",
    ],
    parameters: RequirementAuditSchema,
    executionMode: "sequential",
    execute: async (_id, params) => {
      if (self.restoreError) {
        const result = self.rejected(`Cannot use the requirement audit: ${self.restoreError}.`);
        return {
          content: [{ type: "text", text: result.message }],
          details: requirementAuditResultWithCurrentContext(self, result),
        };
      }
      const activeDraft = self.rejectedRequirementDefinitionDraft;
      const resolvedSources = requirementDefinitionSources(self.state, self.requirementSourceTexts);
      const sourcePrompts = typeof resolvedSources === "string" ? [] : resolvedSources;
      const selectedRepairTarget = activeDraft
        ? selectRequirementDefinitionRepairTarget(
            activeDraft.diagnostics,
            activeDraft.knownNormativeSourceClauseIds,
            activeDraft.input.requirements,
          )
        : undefined;
      const activeRepairPrompt = activeDraft
        ? renderRequirementDefinitionPrompt(sourcePrompts, activeDraft)
        : undefined;
      const foreignFieldError = requirementAuditForeignFieldError(params);
      if (foreignFieldError) {
        if (params.action === "repair_definition" && activeDraft) {
          recordUnproductiveRejectedDefinitionRepair(activeDraft);
        }
        const result = self.rejected(foreignFieldError);
        const message = activeDraft
          ? activeRepairPrompt?.repairActionable === false
            ? `${result.message}\n${activeRepairPrompt.text}`
            : formatRejectedDefinitionRepairFeedback(result.message, activeDraft, sourcePrompts)
          : result.message;
        if (activeDraft) self.persistState();
        return {
          content: [{ type: "text", text: message }],
          details: requirementAuditResultWithCurrentContext(self, result),
        };
      }
      if (activeDraft && params.action !== "repair_definition") {
        const result = self.rejected(
          'A replacement action "define" is never accepted while an active rejected definition exists. Use only the current controller-selected repair item below.',
        );
        const message =
          activeRepairPrompt?.repairActionable === false
            ? `${result.message}\n${activeRepairPrompt.text}`
            : formatRejectedDefinitionRepairFeedback(result.message, activeDraft, sourcePrompts);
        return {
          content: [{ type: "text", text: message }],
          details: requirementAuditResultWithCurrentContext(self, result),
        };
      }
      if (activeDraft && activeRepairPrompt?.repairActionable === false) {
        const result = self.rejected(
          "Repair was not validated because the controller cannot expose an exact actionable selected target within the bounded prompt.",
        );
        const message = `${result.message}\n${activeRepairPrompt.text}`;
        return {
          content: [{ type: "text", text: message }],
          details: requirementAuditResultWithCurrentContext(self, result),
        };
      }
      const previousRejectedDraft = self.rejectedRequirementDefinitionDraft;
      const repaired: RequirementAuditInput | string =
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
        selectedRepairTarget &&
        !requirementAuditInputTargetsSelectedRepair(params, selectedRepairTarget)
      ) {
        recordUnproductiveRejectedDefinitionRepair(previousRejectedDraft);
        const result = self.rejected(
          "Repair was not validated because it does not target the controller-selected diagnostic. The active rejected draft and definition_revision were retained.",
        );
        const message = formatRejectedDefinitionRepairFeedback(result.message, previousRejectedDraft, sourcePrompts);
        self.persistState();
        return {
          content: [{ type: "text", text: message }],
          details: requirementAuditResultWithCurrentContext(self, result),
        };
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
        const message = formatRejectedDefinitionRepairFeedback(result.message, previousRejectedDraft, sourcePrompts);
        self.persistState();
        return {
          content: [{ type: "text", text: message }],
          details: requirementAuditResultWithCurrentContext(self, result),
        };
      }
      const lineageOverflow =
        params.action === "repair_definition" &&
        previousRejectedDraft &&
        typeof repaired !== "string" &&
        rejectedRepairExceedsLineageGrowth(previousRejectedDraft, repaired);
      const result = typeof repaired === "string" ? self.rejected(repaired) : self.applyRequirementAudit(repaired);
      const candidateDiagnosticCount = result.requirementDefinitionDiagnosticCount;
      const selectedDiagnosticRemains =
        selectedRepairTarget !== undefined &&
        !selectedRequirementDefinitionDiagnosticDisappeared(selectedRepairTarget, result.message);
      if (
        params.action === "repair_definition" &&
        previousRejectedDraft &&
        typeof repaired !== "string" &&
        result.status === "needs_action" &&
        (candidateDiagnosticCount === undefined || selectedDiagnosticRemains || lineageOverflow)
      ) {
        recordUnproductiveRejectedDefinitionRepair(previousRejectedDraft);
        const retainedMessage =
          candidateDiagnosticCount === undefined
            ? "Repair was not adopted because the controller rejection did not include structured requirement-definition diagnostics. The previous draft and definition_revision were retained."
            : selectedDiagnosticRemains
              ? [
                  "Repair was not adopted because the controller-selected diagnostic remains unresolved. The previous draft and definition_revision were retained.",
                  "Candidate diagnostics:",
                  result.message,
                ].join("\n\n")
              : lineageOverflow
                ? [
                    `Repair was not adopted because it would retain ${repaired.requirements?.length ?? 0} invalid requirements beyond the lineage limit of ${previousRejectedDraft.repairLineageBaselineRequirementCount + MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH}. Overflow candidates are validated atomically but only a fully valid overflow may replace the compact draft. The previous draft and definition_revision were retained.`,
                    "Candidate diagnostics:",
                    result.message,
                  ].join("\n\n")
                : `Repair was not adopted because the controller rejection did not include structured requirement-definition diagnostics. The previous draft and definition_revision were retained.`;
        const message = formatRejectedDefinitionRepairFeedback(retainedMessage, previousRejectedDraft, sourcePrompts);
        self.persistState();
        return {
          content: [{ type: "text", text: message }],
          details: requirementAuditResultWithCurrentContext(self, result),
        };
      }
      if (result.status === "needs_action" && typeof repaired !== "string" && candidateDiagnosticCount !== undefined) {
        self.rejectedRequirementDefinitionDraft = rejectedRequirementDefinitionDraft(
          repaired,
          result.message,
          params.action === "repair_definition" ? previousRejectedDraft : undefined,
          candidateDiagnosticCount,
        );
      } else if (result.status === "updated") {
        self.rejectedRequirementDefinitionDraft = undefined;
      }
      self.persistState();
      const message =
        result.status !== "needs_action"
          ? result.message
          : params.action === "define" || params.action === "repair_definition"
            ? params.action === "repair_definition" && self.rejectedRequirementDefinitionDraft
              ? formatRejectedDefinitionRepairFeedback(
                  result.message,
                  self.rejectedRequirementDefinitionDraft,
                  sourcePrompts,
                )
              : formatRejectedDefinitionRepairGuidance(
                  result.message,
                  self.rejectedRequirementDefinitionDraft,
                  sourcePrompts,
                )
            : self.withGuidance(result.message);
      return {
        content: [{ type: "text", text: message }],
        details: requirementAuditResultWithCurrentContext(self, result),
      };
    },
  };
}

function requirementAuditResultWithCurrentContext(
  self: TaskVerificationController,
  result: VerificationResult,
): VerificationResult {
  return {
    ...result,
    contextExtract: taskVerificationContextExtract(formatTaskVerificationCompactionNextAction(self), self.currentState),
  };
}
