import { randomUUID } from "node:crypto";
import type { BeforeToolCallResult } from "@dst0/p-agent-core";
import { TEST_PATTERN, TYPECHECK_PATTERN } from "../constants.ts";
import { requiredAcceptanceCheckCount, testsRequested, typecheckRequested } from "../requirement-checks.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { isShellTool, normalizeStrings, normalizeText } from "../tool-classification.ts";
import type {
  TaskVerificationAcceptanceCheck,
  TaskVerificationEvidence,
  VerificationInput,
  VerificationResult,
} from "../types.ts";
import { normalizedFilesChanged } from "../workspace-effect-state.ts";
import { computeTaskEffectStateHash } from "./task-effect-state-hash.ts";
import { evidenceHasPositivePassingTestResult } from "./test-evidence-outcome.ts";

export function readyToFinishWithEvidence(
  self: TaskVerificationController,
  input: VerificationInput,
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

  const requestedChecks = input.acceptance_checks ?? [];
  const requiredCheckCount = requiredAcceptanceCheckCount(self.taskText());
  if (requestedChecks.length < requiredCheckCount) {
    return self.rejected(
      `ready_to_finish requires at least ${requiredCheckCount} distinct acceptance_checks for the explicit guarantees in this task; received ${requestedChecks.length}.`,
    );
  }
  const mapped = validateCompletionChecklist(self, requestedChecks);
  if (typeof mapped === "string") return self.rejected(mapped);
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

  const taskText = self.taskText();
  const mappedEvidence = [...mapped.evidence.values()];
  if (
    testsRequested(taskText) &&
    !mappedEvidence.some(
      (item) =>
        isShellTool(item.toolName) && TEST_PATTERN.test(item.descriptor) && evidenceHasPositivePassingTestResult(item),
    )
  ) {
    return self.rejected(
      "The task explicitly requires tests, but the completion checklist maps no successful current-revision test evidence.",
    );
  }
  if (
    typecheckRequested(taskText) &&
    !mappedEvidence.some((item) => isShellTool(item.toolName) && TYPECHECK_PATTERN.test(item.descriptor))
  ) {
    return self.rejected(
      "The task explicitly requires type checking, but the completion checklist maps no successful current-revision typecheck evidence.",
    );
  }

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
      "Call finish_work minimally; the controller binds this certificate to the successful completion.",
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
  if (publishError || self.state.mutationRevision === 0) return publishError;
  const token = self.state.readiness?.token;
  if (verificationToken !== undefined && verificationToken !== token) {
    return self.blocked(
      `Cannot ${action}: pass the exact verification_token returned for mutation revision ${self.state.mutationRevision}.`,
    );
  }
  const expected = [...(self.state.taskOwnedPaths ?? [])].sort();
  const normalized = filesChanged === undefined && expected.length === 0 ? [] : normalizedFilesChanged(filesChanged);
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

export function formatEvidenceStatus(self: TaskVerificationController): string {
  const readiness = self.state.readiness;
  return [
    self.formatNextRequirement(),
    "Verification mode: evidence",
    `Mutation revision: ${self.state.mutationRevision}`,
    `Readiness: ${readiness?.status ?? "pending"}`,
    `Unverified test paths: ${(self.state.unverifiedTestPaths ?? []).join(", ") || "none"}`,
    `Recent failed verification commands: ${self.latestFailedVerificationEvidence().length}`,
  ].join("\n");
}

function validateCompletionChecklist(
  self: TaskVerificationController,
  requestedChecks: readonly { criterion: string; evidence_refs: string[] }[],
): { checks: TaskVerificationAcceptanceCheck[]; evidence: Map<string, TaskVerificationEvidence> } | string {
  if (requestedChecks.length === 0) {
    return "ready_to_finish requires one model-generated completion checklist with evidence-backed acceptance_checks.";
  }
  const checks: TaskVerificationAcceptanceCheck[] = [];
  const evidence = new Map<string, TaskVerificationEvidence>();
  const seenCriteria = new Set<string>();
  for (const requestedCheck of requestedChecks) {
    const criterion = normalizeText(requestedCheck.criterion);
    if (!criterion) return "Every completion checklist item requires a concrete criterion.";
    const criterionKey = criterion.toLowerCase();
    if (seenCriteria.has(criterionKey)) return `Duplicate completion checklist criterion: ${criterion}`;
    seenCriteria.add(criterionKey);
    const resolved = self.resolveEvidence(requestedCheck.evidence_refs);
    if (typeof resolved === "string") return `${criterion}: ${resolved}`;
    if (resolved.some((item) => item.mutationRevision !== self.state.mutationRevision)) {
      return `${criterion}: all evidence must come from mutation revision ${self.state.mutationRevision}.`;
    }
    if (resolved.some((item) => item.isError)) return `${criterion}: failed evidence cannot prove readiness.`;
    for (const item of resolved) evidence.set(item.ref, item);
    checks.push({ criterion, evidenceRefs: resolved.map((item) => item.ref) });
  }
  return { checks, evidence };
}

function evidenceReadinessError(self: TaskVerificationController, action: string): string | undefined {
  const readiness = self.state.readiness;
  if (
    readiness?.status !== "completion_ready" ||
    readiness.verifiedMutationRevision !== self.state.mutationRevision ||
    !readiness.token ||
    !readiness.effectStateHash ||
    readiness.acceptanceChecks.length === 0
  ) {
    return `Cannot ${action}: call record_task_verification with action "ready_to_finish" and map the completion checklist to fresh evidence first.`;
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
  for (const check of readiness.acceptanceChecks) {
    const evidence = self.resolveEvidence(check.evidenceRefs);
    if (
      typeof evidence === "string" ||
      evidence.some((item) => item.isError || item.mutationRevision !== self.state.mutationRevision)
    ) {
      return `Cannot ${action}: completion evidence for "${check.criterion}" is missing, failed, or stale.`;
    }
  }
  if (self.latestFailedVerificationEvidence().length > 0) {
    return `Cannot ${action}: rerun the latest failed verification successfully first.`;
  }
  return undefined;
}
