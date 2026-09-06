import { completionVerificationScope } from "../completion-verification-scope.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { TaskVerificationAcceptanceCheck, TaskVerificationEvidence } from "../types.ts";
import {
  evidenceHasRecordedExternalEffect,
  externalEffectReceiptHasCompatibleReadback,
  externalEffectReceiptSupportsCriterion,
  isExternalEffectChecklistCriterion,
} from "./external-effect-receipt.ts";
import {
  evidenceIsConfirmedExternalReadback,
  evidenceIsCurrentDeclaredExternalReadback,
  evidenceIsDeclaredExternalReadback,
} from "./external-readback-evidence.ts";
import { externalReadbackCriterionHash } from "./external-readback-proof.ts";

export interface EvidenceReadinessSelection {
  checks: TaskVerificationAcceptanceCheck[];
  evidence: Map<string, TaskVerificationEvidence>;
}

export function selectEvidenceForReadiness(
  self: TaskVerificationController,
  criteria: readonly string[],
): EvidenceReadinessSelection | string {
  const selected = eligibleEvidence(self);
  if (selected.length === 0) {
    return "ready_to_finish requires fresh successful verification evidence for the current mutation revision.";
  }
  const external = selectExternalEffects(self, criteria, selected);
  if (typeof external === "string") return external;
  const ordinary = selected.filter(
    (item) => !evidenceHasRecordedExternalEffect(self, item) && !evidenceIsDeclaredExternalReadback(item),
  );
  const checks: TaskVerificationAcceptanceCheck[] = [];
  for (const [index, criterion] of criteria.entries()) {
    const evidence = external.get(index) ?? ordinary;
    if (evidence.length === 0) {
      return `${criterion}: ready_to_finish requires fresh successful verification evidence for the current mutation revision; external-effect receipts cannot prove workspace changes.`;
    }
    checks.push({ criterion, evidenceRefs: evidence.map((item) => item.ref) });
  }
  return {
    checks,
    evidence: new Map(selected.map((item) => [item.ref, item])),
  };
}

function eligibleEvidence(self: TaskVerificationController): TaskVerificationEvidence[] {
  const selected = new Map<string, TaskVerificationEvidence>();
  for (const item of self.evidence.values()) {
    if (item.isError) continue;
    const externalEffect = evidenceHasRecordedExternalEffect(self, item);
    const current = item.mutationRevision === self.state.mutationRevision;
    const currentConfirmedReadback =
      current && evidenceIsConfirmedExternalReadback(item) && evidenceIsCurrentDeclaredExternalReadback(self, item);
    const currentOrdinary = current && !evidenceIsDeclaredExternalReadback(item);
    if (externalEffect || currentConfirmedReadback || currentOrdinary) selected.set(item.ref, item);
  }
  return [...selected.values()];
}

function selectExternalEffects(
  self: TaskVerificationController,
  criteria: readonly string[],
  selected: readonly TaskVerificationEvidence[],
): Map<number, TaskVerificationEvidence[]> | string {
  const receipts = selected.filter((item) => evidenceHasRecordedExternalEffect(self, item));
  const externalOnly =
    completionVerificationScope(self.state.completionChecklist) === "external_operation" ||
    (self.state.taskOwnedPaths ?? []).length === 0;
  const candidates = criteria.map((criterion) =>
    receipts.flatMap((receipt, index) =>
      externalEffectReceiptSupportsCriterion(self, receipt, criterion) ||
      externalEffectReceiptHasCompatibleReadback(self, receipt, selected, criterion)
        ? [index]
        : [],
    ),
  );
  const required = criteria.flatMap((criterion, index) =>
    externalOnly ||
    isExternalEffectChecklistCriterion(criterion) ||
    candidates[index]!.length > 0 ||
    [...self.evidence.values()].some(
      (item) => item.externalReadbackCriterionSha256 === externalReadbackCriterionHash(criterion),
    )
      ? [index]
      : [],
  );
  const assignments = new Map<number, number>();
  function assign(criterionIndex: number, seen: Set<number>): boolean {
    for (const receiptIndex of candidates[criterionIndex]!) {
      if (!assignments.has(receiptIndex)) {
        assignments.set(receiptIndex, criterionIndex);
        return true;
      }
    }
    for (const receiptIndex of candidates[criterionIndex]!) {
      if (seen.has(receiptIndex)) continue;
      seen.add(receiptIndex);
      const previous = assignments.get(receiptIndex)!;
      if (assign(previous, seen)) {
        assignments.set(receiptIndex, criterionIndex);
        return true;
      }
    }
    return false;
  }
  for (const index of required.sort((left, right) => candidates[left]!.length - candidates[right]!.length)) {
    if (!assign(index, new Set())) {
      return `${criteria[index]}: requires one distinct compatible external-effect receipt. A receipt proves only successful tool execution; a semantic outcome also needs explicit confirmed readback proof. Shell, unrelated, wrong-resource, negative, and unconfirmed reads do not prove remote state.`;
    }
  }
  const result = new Map<number, TaskVerificationEvidence[]>();
  for (const [receiptIndex, criterionIndex] of assignments) {
    const receipt = receipts[receiptIndex]!;
    const readbacks = selected.filter((item) =>
      externalEffectReceiptHasCompatibleReadback(self, receipt, [item], criteria[criterionIndex]!),
    );
    result.set(criterionIndex, [receipt, ...readbacks]);
  }
  return result;
}
