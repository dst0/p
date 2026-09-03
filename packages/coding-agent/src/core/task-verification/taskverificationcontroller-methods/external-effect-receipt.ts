import type { AfterToolCallContext } from "@dst0/p-agent-core";
import { TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE } from "../constants.ts";
import {
  MAX_EXTERNAL_EFFECT_RECEIPTS,
  type TaskVerificationExternalEffectReceipt,
  type TaskVerificationResolvedToolEffect,
} from "../external-effect-state.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { TaskVerificationEvidence } from "../types.ts";
import {
  evidenceIsConfirmedExternalReadback,
  evidenceIsCurrentDeclaredExternalReadback,
} from "./external-readback-evidence.ts";
import { externalReadbackCriterionHash } from "./external-readback-proof.ts";

export interface RecordedExternalEffect {
  receipts: TaskVerificationExternalEffectReceipt[];
  overflow: boolean;
  trackingFailed: boolean;
  evidence?: TaskVerificationEvidence;
}

export function evidenceHasRecordedExternalEffect(
  self: TaskVerificationController,
  evidence: TaskVerificationEvidence,
): boolean {
  return externalEffectReceiptForEvidence(self, evidence) !== undefined;
}

export function externalEffectReceiptSupportsCriterion(
  self: TaskVerificationController,
  evidence: TaskVerificationEvidence,
  criterion: string,
): boolean {
  const receipt = externalEffectReceiptForEvidence(self, evidence);
  if (!receipt) return false;
  const normalized = criterion.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (/^the (?:requested )?external effect completes successfully[.!]?$/iu.test(normalized)) return true;
  const toolBound = normalized.match(
    /^external effect(?: [1-9]\d{0,2})? via tool ([\p{L}\p{N}_.:/-]+) completes successfully[.!]?$/iu,
  );
  return toolBound?.[1] === receipt.toolName;
}

export function externalEffectReceiptHasCompatibleReadback(
  self: TaskVerificationController,
  evidence: TaskVerificationEvidence,
  candidates: readonly TaskVerificationEvidence[],
  criterion: string,
): boolean {
  const receipt = externalEffectReceiptForEvidence(self, evidence);
  if (!receipt || receipt.effect.domains.length === 0) return false;
  return candidates.some(
    (candidate) =>
      evidenceIsConfirmedExternalReadback(candidate) &&
      evidenceIsCurrentDeclaredExternalReadback(self, candidate) &&
      !candidate.isError &&
      candidate.externalReadbackReceiptId === receipt.id &&
      candidate.externalReadbackCriterionSha256 === externalReadbackCriterionHash(criterion) &&
      candidate.mutationRevision >= receipt.effectRevision &&
      candidate.toolEffect!.domains.some((domain) => receipt.effect.domains.includes(domain)),
  );
}

function externalEffectReceiptForEvidence(
  self: TaskVerificationController,
  evidence: TaskVerificationEvidence,
): TaskVerificationExternalEffectReceipt | undefined {
  if (!evidence.externalEffectReceiptId) return undefined;
  return (self.state.externalEffectReceipts ?? []).find(
    (receipt) =>
      receipt.id === evidence.externalEffectReceiptId &&
      receipt.toolCallId === evidence.toolCallId &&
      receipt.toolName === evidence.toolName &&
      receipt.effectRevision === evidence.mutationRevision,
  );
}

export function externalEffectStateUpdate(
  recorded: RecordedExternalEffect | undefined,
): Partial<
  Pick<
    TaskVerificationController["state"],
    "externalEffectReceipts" | "externalEffectReceiptOverflow" | "effectTrackingFailed"
  >
> {
  return recorded
    ? {
        externalEffectReceipts: recorded.receipts,
        externalEffectReceiptOverflow: recorded.overflow,
        effectTrackingFailed: recorded.trackingFailed,
      }
    : {};
}

export function recordSuccessfulExternalEffect(
  self: TaskVerificationController,
  context: AfterToolCallContext,
  effect: TaskVerificationResolvedToolEffect,
  effectRevision: number,
): RecordedExternalEffect {
  const receipts = [...(self.state.externalEffectReceipts ?? [])];
  const overflow =
    (self.state.externalEffectReceiptOverflow ?? false) || receipts.length >= MAX_EXTERNAL_EFFECT_RECEIPTS;
  if (overflow) {
    return {
      receipts,
      overflow: true,
      trackingFailed: self.state.effectTrackingFailed === true,
    };
  }
  const receipt: TaskVerificationExternalEffectReceipt = {
    id: `external-effect-${effectRevision}-${receipts.length + 1}`,
    toolCallId: context.toolCall.id,
    toolName: context.toolCall.name,
    effect: structuredClone(effect),
    effectRevision,
  };
  receipts.push(receipt);
  const evidence: TaskVerificationEvidence = {
    version: 2,
    taskId: self.state.taskId,
    ref: `verification-evidence-${self.nextEvidence++}`,
    toolCallId: context.toolCall.id,
    toolName: context.toolCall.name,
    descriptor: `${effect.kind} effect (${effect.domains.join(",") || "general"})`,
    outputSummary: "successful metadata-only external-effect receipt",
    externalEffectReceiptId: receipt.id,
    toolEffect: structuredClone(effect),
    isError: false,
    nativeIsError: false,
    mutationRevision: effectRevision,
    timestamp: new Date().toISOString(),
  };
  self.evidence.set(evidence.ref, evidence);
  self.sessionManager.appendCustomEntry(TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE, evidence);
  return {
    receipts,
    overflow: false,
    trackingFailed: self.state.effectTrackingFailed === true,
    evidence,
  };
}
