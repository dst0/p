import type { BeforeToolCallResult } from "@dst0/p-agent-core";
import { validatedCompletionChecklist } from "../completion-checklist-policy.ts";
import { evidenceCriticalProofRequirement, formatEvidenceCriticalProofGuidance } from "../evidence-critical-proof.ts";
import { emptyReadiness } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type {
  EvidenceVerificationInput,
  TaskVerificationCompletionChecklist,
  TaskVerificationCriticalProofObligation,
  VerificationResult,
} from "../types.ts";

const EXACT_FINAL_BYTE_PATTERN =
  /\b(?:(?:exact|final|last|terminal)\s+(?:(?:lf|newline)\s+)?byte|(?:exact|final|last|terminal)\s+(?:lf|newline)|(?:remove|removal|missing)\w*[^\n.]{0,30}(?:final|last|terminal)\s+(?:byte|lf|newline))\b/iu;
const TRUNCATION_REJECTION_PATTERN =
  /\b(?:reject|fail|invalid|error|throw)\w*\b[^\n.]{0,160}\btruncat\w*\b|\btruncat\w*\b[^\n.]{0,160}\b(?:reject|fail|invalid|error|throw)\w*\b/iu;

export function recordCompletionChecklist(
  self: TaskVerificationController,
  input: EvidenceVerificationInput,
): VerificationResult {
  const normalized = validatedCompletionChecklist(input.completion_checklist);
  if (typeof normalized === "string") return self.rejected(normalized);
  if (self.state.criticalProofObligationOverflow) return self.rejected(criticalProofOverflowMessage());
  const missingObligation = (self.state.criticalProofObligations ?? []).find(
    (obligation) => !checklistCoversCriticalProof(normalized, obligation),
  );
  if (missingObligation) return self.rejected(missingCriticalProofMessage(missingObligation));

  const sourcePromptIds = currentSourcePromptIds(self);
  if (sourcePromptIds.length === 0) {
    return self.rejected("record_completion_checklist requires a current substantive user prompt.");
  }
  const existing = self.state.completionChecklist;
  if (existing && sameStrings(existing.sourcePromptIds, sourcePromptIds)) {
    if (sameStrings(existing.criteria, normalized)) {
      return self.updated("The current completion checklist is already recorded; continue with implementation.", false);
    }
    const existingMissesNewObligation = (self.state.criticalProofObligations ?? []).some(
      (obligation) => !checklistCoversCriticalProof(existing.criteria, obligation),
    );
    if (!existingMissesNewObligation || existing.criteria.some((criterion) => !normalized.includes(criterion))) {
      return self.rejected(
        "Keep every existing completion criterion. A same-prompt checklist may only append a newly discovered bounded behavior check.",
      );
    }
  }
  const checklist: TaskVerificationCompletionChecklist = {
    version: 1,
    criteria: normalized,
    sourcePromptIds,
    createdAtMutationRevision: self.state.mutationRevision,
  };
  self.state = {
    ...self.state,
    completionChecklist: checklist,
    readiness: emptyReadiness(),
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  return self.updated(
    `Completion checklist recorded with ${normalized.length} behavioral check${normalized.length === 1 ? "" : "s"}.`,
    false,
  );
}

export function evidenceMutationChecklistGate(
  self: TaskVerificationController,
  action: string,
): BeforeToolCallResult | undefined {
  if (self.mode !== "evidence") return undefined;
  const error = currentChecklistError(self);
  return error ? self.blocked(`Cannot ${action}: ${error}`) : undefined;
}

export function currentCompletionChecklist(
  self: TaskVerificationController,
): TaskVerificationCompletionChecklist | string {
  const error = currentChecklistError(self);
  return error ?? self.state.completionChecklist!;
}

export function checklistCoversCriticalProof(
  criteria: readonly string[],
  obligation: TaskVerificationCriticalProofObligation,
): boolean {
  return criteria.some((criterion) => criterionCoversCriticalProof(criterion, obligation));
}

export function criterionCoversCriticalProof(
  criterion: string,
  obligation: TaskVerificationCriticalProofObligation,
): boolean {
  if (!criterionCoversExactFinalByte(criterion)) return false;
  const normalized = criterion.replace(/[-_]+/gu, " ");
  return obligation.artifactDomain === "event-log"
    ? /\b(?:event\s+log|jsonl|log)\b/iu.test(normalized)
    : normalized.toLocaleLowerCase("en-US").includes(obligation.artifactDomain.replaceAll("-", " "));
}

export function criterionCoversExactFinalByte(criterion: string): boolean {
  const normalized = criterion.replace(/[-_]+/gu, " ");
  return EXACT_FINAL_BYTE_PATTERN.test(normalized) && TRUNCATION_REJECTION_PATTERN.test(normalized);
}

export function formatCompletionChecklist(self: TaskVerificationController): string[] {
  const checklist = self.state.completionChecklist;
  const checklistLines = checklist
    ? ["Completion checklist:", ...checklist.criteria.map((criterion, index) => `${index + 1}. ${criterion}`)]
    : ["Completion checklist: not recorded"];
  return [...checklistLines, ...formatEvidenceCriticalProofGuidance(self.state.criticalProofObligations ?? [])];
}

function currentChecklistError(self: TaskVerificationController): string | undefined {
  if (self.state.criticalProofObligationOverflow) return criticalProofOverflowMessage();
  const checklist = self.state.completionChecklist;
  if (!checklist || !sameStrings(checklist.sourcePromptIds, currentSourcePromptIds(self))) {
    return 'record one completion checklist after discovery with record_task_verification action "record_completion_checklist" before the first matching mutation';
  }
  const missing = (self.state.criticalProofObligations ?? []).find(
    (obligation) => !checklistCoversCriticalProof(checklist.criteria, obligation),
  );
  return missing ? missingCriticalProofMessage(missing) : undefined;
}

function currentSourcePromptIds(self: TaskVerificationController): string[] {
  return (self.state.taskPrompts ?? []).map((prompt) => prompt.id);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function missingCriticalProofMessage(obligation: TaskVerificationCriticalProofObligation): string {
  const criterion = evidenceCriticalProofRequirement(obligation).acceptanceCriterion;
  return `The authoritative source ${obligation.sourcePath} introduces a bounded critical boundary. Keep the existing checklist and append: ${criterion}.`;
}

function criticalProofOverflowMessage(): string {
  return "More than four distinct critical proof boundaries were discovered. Ask the user to narrow the authoritative source set before mutation.";
}
