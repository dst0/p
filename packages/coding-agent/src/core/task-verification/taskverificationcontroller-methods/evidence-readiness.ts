import { randomUUID } from "node:crypto";
import type { BeforeToolCallResult } from "@dst0/p-agent-core";
import { TYPECHECK_PATTERN } from "../constants.ts";
import { frozenSourceOutputRestoreError } from "../critical-proof-source-output-revalidation.ts";
import { revalidateCriticalProofSources } from "../evidence-critical-proof-observation.ts";
import { testsRequested, typecheckRequested } from "../requirement-checks.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { isShellTool, normalizeStrings } from "../tool-classification.ts";
import type { EvidenceVerificationInput, TaskVerificationEvidence, VerificationResult } from "../types.ts";
import { normalizedFilesChanged } from "../workspace-effect-state.ts";
import { currentCompletionChecklist } from "./completion-checklist.ts";
import {
  validateCriticalProofEvidence,
  validateHighRiskChecklistEvidence,
} from "./evidence-focused-proof-validation.ts";
import { selectEvidenceForReadiness } from "./evidence-readiness-selection.ts";
import { computeTaskEffectStateHash } from "./task-effect-state-hash.ts";
import { commandContainsTestInvocation } from "./test-command-invocation.ts";
import { evidenceHasPositivePassingTestResult } from "./test-evidence-outcome.ts";
import { zeroEffectCompletionGate } from "./zero-effect-completion-gate.ts";

export function readyToFinishWithEvidence(
  self: TaskVerificationController,
  input: EvidenceVerificationInput,
): VerificationResult {
  if (self.state.mutationRevision === 0) {
    return self.rejected("ready_to_finish requires at least one successful effect.");
  }
  if (self.state.taskOwnedPathTrackingFailed) {
    return self.rejected(
      "ready_to_finish is blocked because the controller could not identify the actual task-owned workspace paths for every successful mutation.",
    );
  }
  if (self.state.effectTrackingFailed) {
    return self.rejected(
      "ready_to_finish is blocked because the controller could not persist a metadata-only receipt for every successful external effect.",
    );
  }
  if (self.state.taskOwnedPathOverflow) {
    return self.rejected("ready_to_finish is blocked because the task-owned workspace path ledger exceeded its bound.");
  }
  if (self.state.externalEffectReceiptOverflow) {
    return self.rejected("ready_to_finish is blocked because the external-effect receipt ledger exceeded its bound.");
  }
  const taskOwnedPaths = self.state.taskOwnedPaths ?? [];
  const externalEffectReceipts = self.state.externalEffectReceipts ?? [];
  if (taskOwnedPaths.length === 0 && externalEffectReceipts.length === 0) {
    return self.rejected("ready_to_finish requires at least one recorded workspace or external effect.");
  }
  const effectStateHash = computeTaskEffectStateHash(self);
  if (!effectStateHash) {
    return self.rejected("ready_to_finish could not hash the current task effect state.");
  }
  if (
    self.activeMutationAttempts.size > 0 ||
    self.testMutationReservations.size > 0 ||
    self.workspaceTestSnapshots.size > 0 ||
    self.workspaceSourceSnapshots.size > 0
  ) {
    return self.rejected("ready_to_finish is blocked while workspace mutation calls are still in flight.");
  }
  const pendingTestPaths = self.state.unverifiedTestPaths ?? [];
  if (pendingTestPaths.length > 0 || self.state.unverifiedTestPathOverflow) {
    return self.rejected(
      `Changed tests still need a direct successful ${self.state.unverifiedTestPathOverflow ? "broad " : ""}test run${pendingTestPaths.length ? `: ${pendingTestPaths.join(", ")}` : ""}.`,
    );
  }
  if (normalizeStrings(input.unresolved_failures).length > 0) {
    return self.rejected("ready_to_finish cannot pass with unresolved_failures.");
  }
  const criticalSourceError = sourceRevalidationError(self);
  if (criticalSourceError) return self.rejected(criticalSourceError);

  const checklist = currentCompletionChecklist(self);
  if (typeof checklist === "string") return self.rejected(checklist);
  const mapped = selectEvidenceForReadiness(self, checklist.criteria);
  if (typeof mapped === "string") return self.rejected(mapped);
  const criticalProofError = validateCriticalProofEvidence(self, mapped.checks, mapped.evidence);
  if (criticalProofError) return self.rejected(criticalProofError);
  const focusedEvidenceError = validateHighRiskChecklistEvidence(self, mapped.checks, mapped.evidence);
  if (focusedEvidenceError) return self.rejected(focusedEvidenceError);
  const failedVerifications = self.latestFailedVerificationEvidence();
  if (failedVerifications.length > 0) {
    return self.rejected(
      [
        "ready_to_finish is blocked by verification commands whose latest execution still failed:",
        ...failedVerifications.map((item) => `- ${item.descriptor}: ${item.outputSummary || "failed"}`),
        "Repair the implementation and rerun each exact command successfully.",
      ].join("\n"),
    );
  }

  const requestedEvidenceFailure = requestedEvidenceError(self, mapped.evidence);
  if (requestedEvidenceFailure) return self.rejected(requestedEvidenceFailure);

  const token = randomUUID();
  self.state = {
    ...self.state,
    readiness: {
      status: "completion_ready",
      token,
      acceptanceChecks: mapped.checks,
      verifiedMutationRevision: self.state.mutationRevision,
      effectStateHash,
    },
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  return self.updated(
    [
      `Evidence readiness passed for mutation revision ${self.state.mutationRevision}.`,
      `verification_token: ${token}`,
      `Recorded task-owned paths: ${taskOwnedPaths.join(", ") || "none"}.`,
      "Call finish_work minimally with status success; verification_token and omitted files_changed are filled from controller-owned state.",
    ].join("\n"),
    false,
  );
}

export function publishGateWithEvidence(
  self: TaskVerificationController,
  action: string,
): BeforeToolCallResult | undefined {
  if (self.restoreError) return self.blocked(`Cannot ${action}: ${self.restoreError}`);
  if (self.state.mutationRevision === 0) return undefined;
  const readinessError = evidenceReadinessError(self, action);
  return readinessError ? self.blocked(readinessError) : undefined;
}

export function completionGateWithEvidence(
  self: TaskVerificationController,
  action: string,
  verificationToken?: string,
  filesChanged?: unknown,
): BeforeToolCallResult | undefined {
  const publishError = publishGateWithEvidence(self, action);
  if (publishError) return publishError;
  if (self.state.mutationRevision === 0) {
    return zeroEffectCompletionGate(self, action, verificationToken, filesChanged);
  }
  const token = self.state.readiness?.token;
  if (verificationToken !== undefined && verificationToken !== token) {
    return self.blocked(
      `Cannot ${action}: pass the exact verification_token returned for mutation revision ${self.state.mutationRevision}.`,
    );
  }
  const expected = [...(self.state.taskOwnedPaths ?? [])].sort();
  const normalized = filesChanged === undefined ? expected : normalizedFilesChanged(filesChanged);
  if (
    !normalized ||
    normalized.length !== expected.length ||
    normalized.some((filePath, index) => filePath !== expected[index])
  ) {
    return self.blocked(
      `Cannot ${action}: files_changed must exactly match the recorded task-owned paths (${expected.join(", ")}).`,
    );
  }
  return undefined;
}

function evidenceReadinessError(self: TaskVerificationController, action: string): string | undefined {
  const criticalSourceError = sourceRevalidationError(self);
  if (criticalSourceError) return `Cannot ${action}: ${criticalSourceError}`;
  const checklist = currentCompletionChecklist(self);
  if (typeof checklist === "string") return `Cannot ${action}: ${checklist}.`;
  const readiness = self.state.readiness;
  if (
    readiness?.status !== "completion_ready" ||
    readiness.verifiedMutationRevision !== self.state.mutationRevision ||
    !readiness.token ||
    !readiness.effectStateHash ||
    readiness.acceptanceChecks.length === 0
  ) {
    return `Cannot ${action}: collect fresh verification evidence, then call record_task_verification with action "ready_to_finish"; the controller selects the evidence batch automatically.`;
  }
  const currentHash = computeTaskEffectStateHash(self);
  if (!currentHash || currentHash !== readiness.effectStateHash) {
    self.state = {
      ...self.state,
      readiness: { status: "pending", acceptanceChecks: [] },
      updatedAt: new Date().toISOString(),
    };
    self.persistState();
    return `Cannot ${action}: the task effect hash changed after readiness; collect fresh evidence and call ready_to_finish again.`;
  }
  if (
    readiness.acceptanceChecks.length !== checklist.criteria.length ||
    readiness.acceptanceChecks.some((check, index) => check.criterion !== checklist.criteria[index])
  ) {
    return `Cannot ${action}: the completion checklist changed after readiness; collect fresh evidence and call ready_to_finish again.`;
  }
  const revalidated = selectEvidenceForReadiness(self, checklist.criteria);
  if (typeof revalidated === "string") return `Cannot ${action}: ${revalidated}`;
  const criticalProofError = validateCriticalProofEvidence(self, revalidated.checks, revalidated.evidence);
  if (criticalProofError) return `Cannot ${action}: ${criticalProofError}`;
  const focusedEvidenceError = validateHighRiskChecklistEvidence(self, revalidated.checks, revalidated.evidence);
  if (focusedEvidenceError) return `Cannot ${action}: ${focusedEvidenceError}`;
  const requestedEvidenceFailure = requestedEvidenceError(self, revalidated.evidence);
  if (requestedEvidenceFailure) return `Cannot ${action}: ${requestedEvidenceFailure}`;
  if (self.latestFailedVerificationEvidence().length > 0) {
    return `Cannot ${action}: rerun the latest failed verification successfully first.`;
  }
  return undefined;
}

function sourceRevalidationError(self: TaskVerificationController): string | undefined {
  return frozenSourceOutputRestoreError(self) ?? revalidateCriticalProofSources(self);
}

function requestedEvidenceError(
  self: TaskVerificationController,
  evidence: ReadonlyMap<string, TaskVerificationEvidence>,
): string | undefined {
  const taskText = self.taskText();
  const mappedEvidence = [...evidence.values()];
  if (
    testsRequested(taskText) &&
    !mappedEvidence.some(
      (item) =>
        isShellTool(item.toolName) &&
        commandContainsTestInvocation(item.descriptor) &&
        evidenceHasPositivePassingTestResult(item),
    )
  ) {
    return "The task explicitly requires tests, but no successful current-revision test evidence is available.";
  }
  if (
    typecheckRequested(taskText) &&
    !mappedEvidence.some((item) => isShellTool(item.toolName) && TYPECHECK_PATTERN.test(item.descriptor))
  ) {
    return "The task explicitly requires type checking, but no successful current-revision typecheck evidence is available.";
  }
  return undefined;
}
