import { randomUUID } from "node:crypto";
import { DEFAULT_TASK_VERIFICATION_MODE, type TaskVerificationMode } from "./mode.ts";
import type { TaskVerificationState } from "./types.ts";

export function emptyReadiness(): NonNullable<TaskVerificationState["readiness"]> {
  return {
    status: "pending",
    acceptanceChecks: [],
  };
}

export function emptyRequirementAudit(): TaskVerificationState["requirementAudit"] {
  return {
    status: "pending",
    requirements: [],
    ignoredSourcePrompts: [],
    ignoredSourceClauses: [],
    nextRequirementIndex: 0,
  };
}

export function emptyState(
  taskId: string = randomUUID(),
  mode: TaskVerificationMode = DEFAULT_TASK_VERIFICATION_MODE,
): TaskVerificationState {
  return {
    version: 2,
    mode,
    taskId,
    mutationRevision: 0,
    taskPrompts: [],
    unverifiedTestPaths: [],
    unverifiedTestPathOverflow: false,
    mutatedSourcePaths: [],
    mutatedSourcePathOverflow: false,
    taskOwnedPaths: [],
    taskOwnedPathBaselines: [],
    taskOwnedPathOverflow: false,
    taskOwnedPathTrackingFailed: false,
    externalEffectReceipts: [],
    externalEffectReceiptOverflow: false,
    effectTrackingFailed: false,
    baseline: {
      required: false,
      status: "not_required",
      evidenceRefs: [],
      authorizedTestPaths: [],
      testSetupChanged: false,
    },
    final: { status: "pending", evidenceRefs: [], unresolvedFailures: [] },
    readiness: emptyReadiness(),
    requirementAudit: emptyRequirementAudit(),
    updatedAt: new Date().toISOString(),
  };
}
