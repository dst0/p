import type { AfterToolCallContext } from "@dst0/p-agent-core";
import { TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE } from "../constants.ts";
import {
  MAX_EXTERNAL_EFFECT_RECEIPTS,
  type TaskVerificationExternalEffectReceipt,
  type TaskVerificationResolvedToolEffect,
} from "../external-effect-state.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { TaskVerificationEvidence } from "../types.ts";

export interface RecordedExternalEffect {
  receipts: TaskVerificationExternalEffectReceipt[];
  overflow: boolean;
  trackingFailed: boolean;
  evidence?: TaskVerificationEvidence;
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
