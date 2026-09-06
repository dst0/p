import type { AfterToolCallContext, AfterToolCallResult } from "@dst0/p-agent-core";
import { TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE } from "../constants.ts";
import type { TaskVerificationResolvedToolEffect } from "../external-effect-state.ts";
import { emptyReadiness } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { TaskVerificationEvidence } from "../types.ts";
import { externalReadbackBinding } from "./external-readback-proof.ts";

export function evidenceIsDeclaredExternalReadback(evidence: TaskVerificationEvidence): boolean {
  return evidence.toolEffect?.kind === "read" && evidence.toolEffect.source === "declared";
}

export function evidenceIsConfirmedExternalReadback(evidence: TaskVerificationEvidence): boolean {
  return (
    evidenceIsDeclaredExternalReadback(evidence) &&
    evidence.externalReadbackOutcome === "confirmed" &&
    evidence.externalReadbackReceiptId !== undefined &&
    evidence.externalReadbackCriterionSha256 !== undefined
  );
}

export function evidenceIsCurrentDeclaredExternalReadback(
  self: TaskVerificationController,
  evidence: TaskVerificationEvidence,
): boolean {
  if (!evidenceIsDeclaredExternalReadback(evidence)) return false;
  const entries = [...self.evidence.values()];
  const index = entries.findIndex((candidate) => candidate.ref === evidence.ref);
  return index >= 0 && !entries.slice(index + 1).some((candidate) => sameReadbackScope(candidate, evidence));
}

export function recordDeclaredExternalReadback(
  self: TaskVerificationController,
  context: AfterToolCallContext,
  previousResult: AfterToolCallResult | undefined,
  content: AfterToolCallContext["result"]["content"],
  effect: TaskVerificationResolvedToolEffect,
  isError: boolean,
): AfterToolCallResult {
  const binding = externalReadbackBinding(self, context.result.details, effect);
  const evidence: TaskVerificationEvidence = {
    version: 2,
    taskId: self.state.taskId,
    ref: `verification-evidence-${self.nextEvidence++}`,
    toolCallId: context.toolCall.id,
    toolName: context.toolCall.name,
    descriptor: `declared external readback (${effect.domains.join(",") || "general"})`,
    outputSummary: `${isError ? "failed" : "successful"} metadata-only declared external readback`,
    toolEffect: structuredClone(effect),
    ...(binding
      ? {
          externalReadbackReceiptId: binding.receiptId,
          externalReadbackCriterionSha256: binding.criterionSha256,
          externalReadbackOutcome: binding.outcome,
        }
      : {}),
    isError,
    nativeIsError: context.isError,
    mutationRevision: self.state.mutationRevision,
    timestamp: new Date().toISOString(),
  };
  self.evidence.set(evidence.ref, evidence);
  self.sessionManager.appendCustomEntry(TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE, evidence);
  if ((isError || binding?.outcome === "not_confirmed") && readinessUsesReadbackScope(self, evidence)) {
    self.state = {
      ...self.state,
      readiness: emptyReadiness(),
      updatedAt: new Date().toISOString(),
    };
    self.persistState();
  }
  const result: AfterToolCallResult = {
    content: [
      ...content,
      {
        type: "text",
        text: `Verification evidence handle: ${evidence.ref} (@${evidence.toolCallId}, ${evidence.toolName}, mutation revision ${evidence.mutationRevision}). Metadata-only declared external readback recorded.`,
      },
    ],
    isError,
  };
  if (context.result.details !== undefined) result.details = context.result.details;
  if (previousResult?.terminate !== undefined) result.terminate = previousResult.terminate;
  return result;
}

function readinessUsesReadbackScope(self: TaskVerificationController, evidence: TaskVerificationEvidence): boolean {
  return (self.state.readiness?.acceptanceChecks ?? []).some((check) =>
    check.evidenceRefs.some((ref) => {
      const mapped = self.evidence.get(ref);
      return mapped !== undefined && sameReadbackScope(mapped, evidence);
    }),
  );
}

function sameReadbackScope(left: TaskVerificationEvidence, right: TaskVerificationEvidence): boolean {
  if (!evidenceIsDeclaredExternalReadback(left) || !evidenceIsDeclaredExternalReadback(right)) return false;
  const leftBound = evidenceHasReadbackBinding(left);
  const rightBound = evidenceHasReadbackBinding(right);
  if (leftBound || rightBound) {
    return (
      leftBound &&
      rightBound &&
      left.externalReadbackReceiptId === right.externalReadbackReceiptId &&
      left.externalReadbackCriterionSha256 === right.externalReadbackCriterionSha256
    );
  }
  const sameDomains =
    left.toolEffect!.domains.length === right.toolEffect!.domains.length &&
    left.toolEffect!.domains.every((domain) => right.toolEffect!.domains.includes(domain));
  return sameDomains && left.toolName === right.toolName;
}

function evidenceHasReadbackBinding(evidence: TaskVerificationEvidence): boolean {
  return (
    evidence.externalReadbackOutcome !== undefined &&
    evidence.externalReadbackReceiptId !== undefined &&
    evidence.externalReadbackCriterionSha256 !== undefined
  );
}
