import type { AfterToolCallContext, AfterToolCallResult } from "@dst0/p-agent-core";
import { captureWorkspaceFingerprint } from "../../workspace-fingerprint.ts";
import { TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE } from "../constants.ts";
import { resetRequirementAuditAfterMutation } from "../requirement-audit-reset.ts";
import { baselineRequired } from "../requirement-checks.ts";
import { collectProofWitnesses, countProofFrameMarkers, redactProofFrames } from "../requirement-proof-witnesses.ts";
import { emptyReadiness, emptyState } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import {
  argsRecord,
  describeToolCall,
  isDirectMutationTool,
  isEvidenceTool,
  isPublishCommand,
  isRecognizedBashMutation,
  isShellTool,
  isTaskKind,
  normalizeText,
  summarizeOutput,
} from "../tool-classification.ts";
import type { TaskVerificationEvidence, VerificationInput, VerificationResult } from "../types.ts";
import { isVerificationCommand } from "./failed-verification-resolution.ts";
import { isZeroExitRuntimeAssertionFailure } from "./runtime-assertion-failure.ts";
import {
  mutationSourcePaths,
  recordSourceMutationPaths,
  settleSourceWorkspaceMutation,
} from "./source-mutation-tracking.ts";
import { mutationSourceSizeGuidance } from "./source-size-guidance.ts";
import { requirementAuditAfterTaskDeclaration } from "./task-declaration-requirement-audit.ts";
import {
  appendTestMutationGuidance,
  clearVerifiedTestPaths,
  settleTestAuthoringMutation,
} from "./test-authoring-gate.ts";

export { do_authorizeBaselineTest } from "./baseline-test-authorization.ts";
export async function do_afterToolCall(
  self: TaskVerificationController,
  context: AfterToolCallContext,
  previousResult: AfterToolCallResult | undefined,
): Promise<AfterToolCallResult | undefined> {
  const nativeIsError = context.isError;
  const effectiveIsError = previousResult?.isError ?? context.isError;
  const nativeContent = context.result.content;
  const content = previousResult?.content ?? nativeContent;
  const descriptor = describeToolCall(context.toolCall.name, context.args);
  if (context.toolCall.name === "finish_work" && !effectiveIsError && argsRecord(context.args).status === "success") {
    self.rejectedRequirementDefinitionDraft = undefined;
    self.state = emptyState();
    self.evidence.clear();
    self.bashFingerprints.clear();
    self.testMutationReservations.clear();
    self.testVerificationStarts.clear();
    self.workspaceTestSnapshots.clear();
    self.workspaceSourceSnapshots.clear();
    self.activeMutationAttempts.clear();
    self.requirementSourceTexts.clear();
    self.latestUserPrompt = "";
    self.persistState();
    return previousResult;
  }
  const initialMutation = await self.detectMutation(context, effectiveIsError);
  const testAuthoring = await settleTestAuthoringMutation(self, context, initialMutation);
  const sourceMutation = await settleSourceWorkspaceMutation(self, context);
  const detectedMutation =
    initialMutation ||
    testAuthoring.workspaceMutated ||
    sourceMutation.paths.length > 0 ||
    sourceMutation.trackingFailed;
  const testMutationGuidance = testAuthoring.guidance;
  if (detectedMutation) {
    self.rejectedRequirementDefinitionDraft = undefined;
    recordSourceMutationPaths(
      self,
      [...mutationSourcePaths(self, context), ...sourceMutation.paths],
      sourceMutation.trackingFailed,
    );
    const mutationGuidance = [testMutationGuidance, mutationSourceSizeGuidance(self)]
      .filter((message): message is string => message !== undefined && message.length > 0)
      .join("\n");
    if (self.isAuthorizedBaselineTestMutation(context.toolCall.name, context.args)) {
      self.state = {
        ...self.state,
        baseline: { ...self.state.baseline, testSetupChanged: true },
        updatedAt: new Date().toISOString(),
      };
      self.persistState();
      return appendTestMutationGuidance(context, previousResult, mutationGuidance);
    }
    self.state = {
      ...self.state,
      mutationRevision: self.state.mutationRevision + 1,
      final: { status: "pending", evidenceRefs: [], unresolvedFailures: [] },
      readiness: emptyReadiness(),
      requirementAudit: resetRequirementAuditAfterMutation(self.state.requirementAudit),
      updatedAt: new Date().toISOString(),
    };
    self.persistState();
    return appendTestMutationGuidance(context, previousResult, mutationGuidance);
  }
  if (!isEvidenceTool(context.toolCall.name)) return previousResult;
  const proofWitnesses = collectProofWitnesses(
    nativeContent,
    self.state.requirementAudit.requirements,
    self.state.requirementAudit.requirementSetHash,
    self.state.mutationRevision,
  );
  const proofFrameCount = countProofFrameMarkers(nativeContent);
  const recordedProofCount = proofWitnesses?.length ?? 0;
  const proofFrameFeedback =
    proofFrameCount > recordedProofCount
      ? `Recorded ${recordedProofCount} of ${proofFrameCount} P_PROOF_V1 frames; rejected or duplicate frames were not persisted. Compare every frame with the controller proof template before submitting verdicts.`
      : undefined;
  const redactedContent = redactProofFrames(content);
  const fullOutput = redactedContent
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const runtimeAssertionFailed = isZeroExitRuntimeAssertionFailure(context, fullOutput, nativeIsError);
  const evidence: TaskVerificationEvidence = {
    version: 2,
    taskId: self.state.taskId,
    ref: `verification-evidence-${self.nextEvidence++}`,
    toolCallId: context.toolCall.id,
    toolName: context.toolCall.name,
    descriptor,
    outputSummary: summarizeOutput(redactedContent),
    ...(proofWitnesses ? { proofWitnesses } : {}),
    isError: effectiveIsError || runtimeAssertionFailed,
    nativeIsError,
    mutationRevision: self.state.mutationRevision,
    timestamp: new Date().toISOString(),
  };
  self.evidence.set(evidence.ref, evidence);
  self.sessionManager.appendCustomEntry(TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE, evidence);
  const testBatchVerification = clearVerifiedTestPaths(self, evidence, fullOutput);
  const invalidation = invalidateAfterFailedVerification(self, evidence);
  const autoFinalized = self.tryAutoFinalizeExactReplay(evidence) ?? self.tryAutoFinalizeFocusedTest(evidence);
  const acceptanceAudit = autoFinalized ? undefined : self.highRiskAcceptanceAudit(evidence);
  const evidenceText = [
    `Verification evidence handle: ${evidence.ref} (@${evidence.toolCallId}, ${evidence.toolName}, mutation revision ${evidence.mutationRevision}).`,
    proofFrameFeedback,
    runtimeAssertionFailed
      ? "Runtime assertion failure detected despite a zero process exit; this evidence is failed. Use throwing assertions so the command exits non-zero."
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
  if (previousResult?.details !== undefined) result.details = previousResult.details;
  else if (context.result.details !== undefined) result.details = context.result.details;
  if (previousResult?.terminate !== undefined) result.terminate = previousResult.terminate;
  return result;
}
function invalidateAfterFailedVerification(
  self: TaskVerificationController,
  evidence: TaskVerificationEvidence,
): string | undefined {
  if (!evidence.isError || !isShellTool(evidence.toolName) || !isVerificationCommand(evidence.descriptor)) {
    return undefined;
  }
  self.state = {
    ...self.state,
    readiness: emptyReadiness(),
    requirementAudit: resetRequirementAuditAfterMutation(self.state.requirementAudit),
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
export function do_applyInput(self: TaskVerificationController, input: VerificationInput): VerificationResult {
  switch (input.action) {
    case "declare_task":
      return self.declareTask(input);
    case "authorize_baseline_test":
      return self.authorizeBaselineTest(input);
    case "record_baseline":
      return self.recordBaseline(input);
    case "record_final":
      return self.recordFinal(input);
    case "ready_to_finish":
      return self.readyToFinish(input);
    case "status":
      return self.updated(self.formatStatus(), false);
  }
}
export function do_declareTask(self: TaskVerificationController, input: VerificationInput): VerificationResult {
  if (!isTaskKind(input.task_kind) || !normalizeText(input.task_summary)) {
    return self.rejected("declare_task requires task_kind and a concrete task_summary.");
  }
  if (self.state.mutationRevision > 0)
    return self.rejected("Cannot replace the task declaration after mutation; finish the current task first.");
  const taskSummary = normalizeText(input.task_summary);
  const required = baselineRequired(input.task_kind, `${self.latestUserPrompt}\n${taskSummary}`);
  const currentPrompts = self.state.taskPrompts?.length
    ? self.state.taskPrompts
    : self.latestUserPrompt.trim()
      ? [{ id: `user-${Date.now()}-1`, text: self.latestUserPrompt }]
      : [];
  self.rejectedRequirementDefinitionDraft = undefined;
  self.state = {
    ...emptyState(self.state.taskId),
    taskKind: input.task_kind,
    taskSummary,
    taskContext: self.latestUserPrompt.slice(0, 2_000) || undefined,
    taskPrompts: currentPrompts,
    requirementSourceRefs: self.state.requirementSourceRefs ?? [],
    ignoredRequirementSources: self.state.ignoredRequirementSources ?? [],
    requirementDefinitionPolicy: self.state.requirementDefinitionPolicy,
    baseline: {
      required,
      status: required ? "pending" : "not_required",
      evidenceRefs: [],
      authorizedTestPaths: [],
      testSetupChanged: false,
    },
    requirementAudit: requirementAuditAfterTaskDeclaration(self, taskSummary, currentPrompts),
    updatedAt: new Date().toISOString(),
  };
  if (!self.restoreError?.startsWith("requirement-source snapshot")) self.restoreError = undefined;
  self.persistState();
  return self.updated(
    required
      ? "Task declared; baseline verification is required before production mutation."
      : "Task declared; final verification is required after mutation.",
  );
}
