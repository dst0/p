import { persistedCompletionChecklistIsCanonical } from "./completion-checklist-policy.ts";
import { MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS } from "./evidence-critical-proof.ts";
import { normalizeRequirementSourcePath } from "./referenced-requirement-sources.ts";
import type { TaskVerificationCompletionChecklist, TaskVerificationCriticalProofObligation } from "./types.ts";

export function persistedCompletionChecklistIsValid(
  value: unknown,
  taskPrompts: unknown,
  mutationRevision: unknown,
): value is TaskVerificationCompletionChecklist {
  return (
    isRecord(value) &&
    value.version === 1 &&
    persistedCompletionChecklistIsCanonical(value.criteria) &&
    isStringArray(value.sourcePromptIds) &&
    value.sourcePromptIds.length > 0 &&
    new Set(value.sourcePromptIds).size === value.sourcePromptIds.length &&
    Array.isArray(taskPrompts) &&
    value.sourcePromptIds.length === taskPrompts.length &&
    value.sourcePromptIds.every((id, index) => isRecord(taskPrompts[index]) && taskPrompts[index].id === id) &&
    isNonnegativeInteger(value.createdAtMutationRevision) &&
    isNonnegativeInteger(mutationRevision) &&
    value.createdAtMutationRevision <= mutationRevision
  );
}

export function persistedCriticalProofObligationsAreValid(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS) return false;
  if (!value.every(isCriticalProofObligation)) return false;
  const obligations = value as TaskVerificationCriticalProofObligation[];
  return (
    new Set(obligations.map((item) => item.id)).size === obligations.length &&
    new Set(obligations.map((item) => `${item.sourcePath}\n${item.artifactDomain}`)).size === obligations.length
  );
}

function isCriticalProofObligation(value: unknown): value is TaskVerificationCriticalProofObligation {
  return (
    isRecord(value) &&
    isNonemptyString(value.id) &&
    value.policy === "remove_exact_final_byte" &&
    isNonemptyString(value.sourcePath) &&
    normalizeRequirementSourcePath(value.sourcePath) === value.sourcePath &&
    typeof value.sourceSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.sourceSha256) &&
    typeof value.artifactDomain === "string" &&
    /^[a-z][a-z0-9-]{0,63}$/u.test(value.artifactDomain)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
