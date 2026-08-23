import { randomUUID } from "node:crypto";
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

export function emptyState(taskId: string = randomUUID()): TaskVerificationState {
  return {
    version: 2,
    taskId,
    mutationRevision: 0,
    taskPrompts: [],
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
