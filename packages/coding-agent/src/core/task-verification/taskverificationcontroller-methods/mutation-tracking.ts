import type { AfterToolCallContext, AfterToolCallResult } from "@dst0/p-agent-core";
import { captureWorkspaceFingerprint } from "../../workspace-fingerprint.ts";
import { TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE } from "../constants.ts";
import { evidenceCriticalProofRequirement, evidenceCriticalProofSetHash } from "../evidence-critical-proof.ts";
import { recordCriticalProofObservation } from "../evidence-critical-proof-observation.ts";
import { formatProofWitnessEvidenceFeedback } from "../proof-witness-evidence-feedback.ts";
import { resetRequirementAuditAfterMutation } from "../requirement-audit-reset.ts";
import { analyzeProofWitnesses, redactProofFrames } from "../requirement-proof-witnesses.ts";
import { emptyReadiness } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import {
  argsRecord,
  describeToolCall,
  isDirectMutationTool,
  isEvidenceTool,
  isPublishCommand,
  isRecognizedBashMutation,
  isShellTool,
  summarizeOutput,
} from "../tool-classification.ts";
import type { TaskVerificationEvidence } from "../types.ts";
import { resetAfterSuccessfulCompletion } from "./completion-lifecycle.ts";
import { externalEffectStateUpdate, recordSuccessfulExternalEffect } from "./external-effect-receipt.ts";
import { recordDeclaredExternalReadback } from "./external-readback-evidence.ts";
import { isVerificationCommand } from "./failed-verification-resolution.ts";
import { isZeroExitRuntimeAssertionFailure } from "./runtime-assertion-failure.ts";
import {
  mutationSourcePaths,
  recordSourceMutationPaths,
  settleSourceWorkspaceMutation,
} from "./source-mutation-tracking.ts";
import { mutationSourceSizeGuidance } from "./source-size-guidance.ts";
import {
  appendTestMutationGuidance,
  clearVerifiedTestPaths,
  settleTestAuthoringMutation,
} from "./test-authoring-gate.ts";
import { classifyTestEvidence } from "./test-evidence-outcome.ts";
import { resolvedTaskVerificationToolEffect } from "./tool-effect-resolution.ts";
import { updatedWorkspaceEffectLedger } from "./workspace-effect-ledger.ts";

export { do_authorizeBaselineTest } from "./baseline-test-authorization.ts";
export async function do_afterToolCall(
  self: TaskVerificationController,
  context: AfterToolCallContext,
  previousResult: AfterToolCallResult | undefined,
): Promise<AfterToolCallResult | undefined> {
  const nativeIsError = context.isError;
  const effectiveIsError = nativeIsError || previousResult?.isError === true;
  const effectivePreviousResult =
    previousResult && previousResult.isError !== effectiveIsError
      ? { ...previousResult, isError: effectiveIsError }
      : previousResult;
  const content = effectivePreviousResult?.content ?? context.result.content;
  const descriptor = describeToolCall(context.toolCall.name, context.args);
  if (context.toolCall.name === "finish_work" && !effectiveIsError && argsRecord(context.args).status === "success") {
    resetAfterSuccessfulCompletion(self);
    return effectivePreviousResult;
  }
  const effect = resolvedTaskVerificationToolEffect(context);
  const successfulExternalEffect = !effectiveIsError && (effect.kind === "external_write" || effect.kind === "unknown");
  const capturedSourceSnapshot = self.workspaceSourceSnapshots.has(context.toolCall.id);
  const workspaceEffect = effect.kind === "workspace_write" || effect.kind === "unknown" || capturedSourceSnapshot;
  const initialMutation = workspaceEffect ? await self.detectMutation(context, nativeIsError) : false;
  const testAuthoring = await settleTestAuthoringMutation(self, context, initialMutation);
  const sourceMutation = await settleSourceWorkspaceMutation(self, context);
  const workspaceMutation =
    initialMutation ||
    testAuthoring.workspaceMutated ||
    sourceMutation.paths.length > 0 ||
    sourceMutation.trackingFailed;
  const detectedMutation = workspaceMutation || successfulExternalEffect;
  if (detectedMutation) {
    self.rejectedRequirementDefinitionDraft = undefined;
    const workspaceEffectLedger = workspaceMutation
      ? updatedWorkspaceEffectLedger(self.state, sourceMutation.before, sourceMutation.after)
      : undefined;
    if (workspaceMutation) {
      recordSourceMutationPaths(
        self,
        [...mutationSourcePaths(self, context), ...sourceMutation.paths],
        sourceMutation.trackingFailed,
      );
    }
    const nextMutationRevision = self.state.mutationRevision + 1;
    const externalEffect = successfulExternalEffect
      ? recordSuccessfulExternalEffect(self, context, effect, nextMutationRevision)
      : undefined;
    const mutationGuidance = [
      testAuthoring.guidance,
      effect.kind === "read" && capturedSourceSnapshot && workspaceMutation
        ? "A test-like read command changed workspace source files. The mutation was recorded, the command was not accepted as verification evidence, and completion readiness was invalidated."
        : undefined,
      self.mode === "audit" ? mutationSourceSizeGuidance(self) : undefined,
    ]
      .filter((message): message is string => message !== undefined && message.length > 0)
      .join("\n");
    if (self.isAuthorizedBaselineTestMutation(context.toolCall.name, context.args)) {
      self.state = {
        ...self.state,
        ...workspaceEffectLedger,
        ...externalEffectStateUpdate(externalEffect),
        baseline: { ...self.state.baseline, testSetupChanged: true },
        updatedAt: new Date().toISOString(),
      };
      self.persistState();
      return appendTestMutationGuidance(context, effectivePreviousResult, mutationGuidance);
    }
    self.state = {
      ...self.state,
      ...workspaceEffectLedger,
      ...externalEffectStateUpdate(externalEffect),
      mutationRevision: nextMutationRevision,
      final: { status: "pending", evidenceRefs: [], unresolvedFailures: [] },
      readiness: emptyReadiness(),
      requirementAudit:
        self.mode === "audit"
          ? resetRequirementAuditAfterMutation(self.state.requirementAudit)
          : self.state.requirementAudit,
      updatedAt: new Date().toISOString(),
    };
    self.persistState();
    const externalEvidenceGuidance = externalEffect?.evidence
      ? `Verification evidence handle: ${externalEffect.evidence.ref} (@${externalEffect.evidence.toolCallId}, ${externalEffect.evidence.toolName}, mutation revision ${externalEffect.evidence.mutationRevision}). Metadata-only external-effect receipt recorded.`
      : undefined;
    return appendTestMutationGuidance(
      context,
      effectivePreviousResult,
      [mutationGuidance, externalEvidenceGuidance].filter(Boolean).join("\n"),
    );
  }
  if (!isEvidenceTool(context.toolCall.name) && !(effect.kind === "read" && effect.source === "declared")) {
    return effectivePreviousResult;
  }
  if (effect.kind === "read" && effect.source === "declared") {
    return recordDeclaredExternalReadback(self, context, effectivePreviousResult, content, effect, effectiveIsError);
  }
  const proofRequirements =
    self.mode === "audit"
      ? self.state.requirementAudit.requirements
      : (self.state.criticalProofObligations ?? []).map(evidenceCriticalProofRequirement);
  const proofSetHash =
    self.mode === "audit"
      ? self.state.requirementAudit.requirementSetHash
      : evidenceCriticalProofSetHash(self.state.criticalProofObligations ?? []);
  const proofAnalysis = analyzeProofWitnesses(
    context.result.content,
    proofRequirements,
    proofSetHash,
    self.state.mutationRevision,
  );
  const proofWitnesses = proofAnalysis.witnesses;
  const proofFrameFeedback = formatProofWitnessEvidenceFeedback(proofAnalysis, proofRequirements);
  const redactedContent = redactProofFrames(content);
  const fullOutput = redactedContent
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const runtimeAssertionFailed = isZeroExitRuntimeAssertionFailure(context, fullOutput, nativeIsError);
  const verificationIsError = effectiveIsError || runtimeAssertionFailed;
  const readText = content.length === 1 && content[0]?.type === "text" ? content[0].text : undefined;
  const criticalProofGuidance =
    !verificationIsError && effect.kind === "read"
      ? recordCriticalProofObservation(self, context.args, readText)
      : undefined;
  const evidence: TaskVerificationEvidence = {
    version: 2,
    taskId: self.state.taskId,
    ref: `verification-evidence-${self.nextEvidence++}`,
    toolCallId: context.toolCall.id,
    toolName: context.toolCall.name,
    descriptor,
    outputSummary: summarizeOutput(redactedContent),
    ...(proofWitnesses ? { proofWitnesses } : {}),
    isError: verificationIsError,
    ...classifyTestEvidence(descriptor, fullOutput, verificationIsError, self.sessionManager.getCwd()),
    nativeIsError,
    mutationRevision: self.state.mutationRevision,
    timestamp: new Date().toISOString(),
  };
  self.evidence.set(evidence.ref, evidence);
  self.sessionManager.appendCustomEntry(TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE, evidence);
  const testBatchVerification = clearVerifiedTestPaths(self, evidence, fullOutput);
  const invalidation = invalidateAfterFailedVerification(self, evidence);
  const autoFinalized =
    self.mode === "audit"
      ? (self.tryAutoFinalizeExactReplay(evidence) ?? self.tryAutoFinalizeFocusedTest(evidence))
      : undefined;
  const acceptanceAudit = self.mode === "audit" && !autoFinalized ? self.highRiskAcceptanceAudit(evidence) : undefined;
  const evidenceText = [
    `Verification evidence handle: ${evidence.ref} (@${evidence.toolCallId}, ${evidence.toolName}, mutation revision ${evidence.mutationRevision}).`,
    proofFrameFeedback,
    criticalProofGuidance,
    runtimeAssertionFailed
      ? "Runtime assertion failure detected despite a zero process exit; this evidence is failed. Use throwing assertions so the command exits non-zero."
      : undefined,
    evidence.verificationFailureKind === "missing_test_script"
      ? "The requested package script is unavailable, so no tests ran and no implementation-test failure was recorded. Inspect the active package's declared scripts and run an applicable existing test command; do not add a script alias solely to clear verification."
      : undefined,
    testBatchVerification,
    invalidation,
    autoFinalized,
    acceptanceAudit,
  ]
    .filter((text): text is string => text !== undefined)
    .join("\n");
  const newContent = [...redactedContent];
  let lastIndex = -1;
  for (let i = newContent.length - 1; i >= 0; i--) {
    if (newContent[i]!.type === "text") {
      lastIndex = i;
      break;
    }
  }
  if (lastIndex !== -1) {
    const lastItem = newContent[lastIndex]!;
    if (lastItem.type === "text") {
      const text = lastItem.text ?? "";
      const footerMatch = text.match(/\n\n\[Showing lines [^\]]+\]$/);
      if (footerMatch && footerMatch.index !== undefined) {
        const head = text.slice(0, footerMatch.index);
        const footer = text.slice(footerMatch.index);
        newContent[lastIndex] = {
          type: "text",
          text: `${head}\n${evidenceText}${footer}`,
        };
      } else {
        newContent.push({ type: "text", text: evidenceText });
      }
    } else {
      newContent.push({ type: "text", text: evidenceText });
    }
  } else {
    newContent.push({ type: "text", text: evidenceText });
  }
  const result: AfterToolCallResult = {
    content: newContent,
    isError: evidence.isError,
  };
  if (effectivePreviousResult?.details !== undefined) result.details = effectivePreviousResult.details;
  else if (context.result.details !== undefined) result.details = context.result.details;
  if (effectivePreviousResult?.terminate !== undefined) result.terminate = effectivePreviousResult.terminate;
  return result;
}
function invalidateAfterFailedVerification(
  self: TaskVerificationController,
  evidence: TaskVerificationEvidence,
): string | undefined {
  if (
    !evidence.isError ||
    evidence.verificationFailureKind === "missing_test_script" ||
    !isShellTool(evidence.toolName) ||
    !isVerificationCommand(evidence.descriptor)
  ) {
    return undefined;
  }
  self.state = {
    ...self.state,
    readiness: emptyReadiness(),
    requirementAudit:
      self.mode === "audit"
        ? resetRequirementAuditAfterMutation(self.state.requirementAudit)
        : self.state.requirementAudit,
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  return "This failed verification invalidated completion readiness and all requirement verdicts. Repair it, rerun the exact command successfully, then restart ready_to_finish.";
}
export async function do_detectMutation(
  self: TaskVerificationController,
  context: AfterToolCallContext,
  isError: boolean,
): Promise<boolean> {
  const toolName = context.toolCall.name;
  if (isDirectMutationTool(toolName)) return !isError;
  if (!isShellTool(toolName) || isPublishCommand(toolName, context.args)) return false;
  const hadFingerprint = self.bashFingerprints.has(context.toolCall.id);
  const beforeFingerprint = self.bashFingerprints.get(context.toolCall.id);
  self.bashFingerprints.delete(context.toolCall.id);
  if (hadFingerprint && beforeFingerprint !== undefined) {
    const sessionFile = self.sessionManager.getSessionFile();
    const afterFingerprint = await captureWorkspaceFingerprint(
      self.sessionManager.getCwd(),
      sessionFile ? [sessionFile] : [],
    );
    if (afterFingerprint !== undefined) return beforeFingerprint !== afterFingerprint;
  }
  return isRecognizedBashMutation(context.args);
}
