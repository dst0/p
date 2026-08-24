import { isAbsolute, relative, resolve } from "node:path";
import type { AfterToolCallContext, AfterToolCallResult } from "@dst0/p-agent-core";
import { captureWorkspaceFingerprint } from "../../workspace-fingerprint.ts";
import {
  GENERIC_CHECK_PATTERN,
  TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE,
  TEST_PATH_PATTERN,
  TEST_PATTERN,
} from "../constants.ts";
import { resetRequirementAuditAfterMutation } from "../requirement-audit-reset.ts";
import { baselineRequired } from "../requirement-checks.ts";
import { renderedRejectedDefinitionRevision } from "../requirement-definition-prompt.ts";
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
  normalizeStrings,
  normalizeText,
  pathArgument,
  summarizeOutput,
} from "../tool-classification.ts";
import type { TaskVerificationEvidence, VerificationInput, VerificationResult } from "../types.ts";
import { requirementAuditAfterTaskDeclaration } from "./task-declaration-requirement-audit.ts";
export async function do_afterToolCall(
  self: TaskVerificationController,
  context: AfterToolCallContext,
  previousResult: AfterToolCallResult | undefined,
): Promise<AfterToolCallResult | undefined> {
  const effectiveIsError = previousResult?.isError ?? context.isError;
  const content = previousResult?.content ?? context.result.content;
  const descriptor = describeToolCall(context.toolCall.name, context.args);
  if (context.toolCall.name === "finish_work" && !effectiveIsError && argsRecord(context.args).status === "success") {
    self.requirementRepairStatusRevision = self.rejectedRequirementDefinitionDraft = undefined;
    self.state = emptyState();
    self.evidence.clear();
    self.bashFingerprints.clear();
    self.mutatedSourceFiles.clear();
    self.requirementSourceTexts.clear();
    self.latestUserPrompt = "";
    self.persistState();
    return previousResult;
  }

  if (await self.detectMutation(context, effectiveIsError)) {
    self.requirementRepairStatusRevision = self.rejectedRequirementDefinitionDraft = undefined;
    const filePath = pathArgument(context.args);
    if (filePath) {
      const relPath = relative(self.sessionManager.getCwd(), resolve(self.sessionManager.getCwd(), filePath));
      self.mutatedSourceFiles.add(relPath);
    }
    if (self.isAuthorizedBaselineTestMutation(context.toolCall.name, context.args)) {
      self.state = {
        ...self.state,
        baseline: { ...self.state.baseline, testSetupChanged: true },
        updatedAt: new Date().toISOString(),
      };
      self.persistState();
      return previousResult;
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
    return previousResult;
  }

  if (!isEvidenceTool(context.toolCall.name)) return previousResult;
  const proofWitnesses = collectProofWitnesses(
    content,
    self.state.requirementAudit.requirements,
    self.state.requirementAudit.requirementSetHash,
    self.state.mutationRevision,
  );
  const proofFrameCount = countProofFrameMarkers(content);
  const recordedProofCount = proofWitnesses?.length ?? 0;
  const proofFrameFeedback =
    proofFrameCount > recordedProofCount
      ? `Recorded ${recordedProofCount} of ${proofFrameCount} P_PROOF_V1 frames; rejected or duplicate frames were not persisted. Compare every frame with the controller proof template before submitting verdicts.`
      : undefined;
  const redactedContent = redactProofFrames(content);
  const evidence: TaskVerificationEvidence = {
    version: 2,
    taskId: self.state.taskId,
    ref: `verification-evidence-${self.nextEvidence++}`,
    toolCallId: context.toolCall.id,
    toolName: context.toolCall.name,
    descriptor,
    outputSummary: summarizeOutput(redactedContent),
    ...(proofWitnesses ? { proofWitnesses } : {}),
    isError: effectiveIsError,
    mutationRevision: self.state.mutationRevision,
    timestamp: new Date().toISOString(),
  };
  self.evidence.set(evidence.ref, evidence);
  self.sessionManager.appendCustomEntry(TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE, evidence);
  const invalidation = invalidateAfterFailedVerification(self, evidence);
  const autoFinalized = self.tryAutoFinalizeExactReplay(evidence) ?? self.tryAutoFinalizeFocusedTest(evidence);
  const acceptanceAudit = autoFinalized ? undefined : self.highRiskAcceptanceAudit(evidence);

  const evidenceText = [
    `Verification evidence handle: ${evidence.ref} (@${evidence.toolCallId}, ${evidence.toolName}, mutation revision ${evidence.mutationRevision}).`,
    proofFrameFeedback,
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
    isError: effectiveIsError,
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
  if (
    !evidence.isError ||
    !isShellTool(evidence.toolName) ||
    (!TEST_PATTERN.test(evidence.descriptor) && !GENERIC_CHECK_PATTERN.test(evidence.descriptor))
  ) {
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
    const afterFingerprint = await captureWorkspaceFingerprint(self.sessionManager.getCwd());
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
    case "status": {
      const requiredRevision = self.requirementRepairStatusRevision;
      const status = self.formatStatus();
      if (requiredRevision && renderedRejectedDefinitionRevision(status, requiredRevision)) {
        self.requirementRepairStatusRevision = undefined;
      }
      return self.updated(status, false);
    }
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
  self.requirementRepairStatusRevision = undefined;
  self.state = {
    ...emptyState(self.state.taskId),
    taskKind: input.task_kind,
    taskSummary,
    taskContext: self.latestUserPrompt.slice(0, 2_000) || undefined,
    taskPrompts: currentPrompts,
    requirementSourceRefs: self.state.requirementSourceRefs ?? [],
    ignoredRequirementSources: self.state.ignoredRequirementSources ?? [],
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

export function do_authorizeBaselineTest(
  self: TaskVerificationController,
  input: VerificationInput,
): VerificationResult {
  if (!self.state.taskKind || !self.state.baseline.required || self.state.baseline.status !== "pending") {
    return self.rejected(
      "Test-only baseline authorization requires a declared task with pending baseline verification.",
    );
  }
  if (self.state.mutationRevision !== 0) {
    return self.rejected("Cannot authorize baseline test edits after production mutation.");
  }
  const requestedPaths = normalizeStrings(input.test_paths);
  if (requestedPaths.length === 0) return self.rejected("authorize_baseline_test requires test_paths.");

  const normalizedPaths: string[] = [];
  for (const filePath of requestedPaths) {
    const portablePath = filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
    if (isAbsolute(filePath) || portablePath.split("/").includes("..") || !TEST_PATH_PATTERN.test(portablePath)) {
      return self.rejected(`Only explicit repository-relative test files may be authorized: ${filePath}`);
    }
    normalizedPaths.push(portablePath);
  }
  self.state = {
    ...self.state,
    baseline: {
      ...self.state.baseline,
      authorizedTestPaths: [...new Set(normalizedPaths)],
      testSetupChanged: false,
    },
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  return self.updated(`Authorized test-only baseline setup for: ${self.state.baseline.authorizedTestPaths.join(", ")}`);
}
