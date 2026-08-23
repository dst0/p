import { preparedRequirementSourceMatches } from "../referenced-requirement-sources.ts";
import { computeStateUserRequirementsHash } from "../requirement-audit-hashing.ts";
import { emptyReadiness } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";

export function auditContextError(self: TaskVerificationController): string | undefined {
  const readiness = self.state.readiness ?? emptyReadiness();
  if (readiness.status !== "evidence_ready" || readiness.verifiedMutationRevision !== self.state.mutationRevision) {
    return 'Requirement audit is not active. Complete record_task_verification(action: "ready_to_finish") first.';
  }
  const currentHash = computeStateUserRequirementsHash(self.state);
  if (!readiness.userRequirementsHash || readiness.userRequirementsHash !== currentHash) {
    return "The accumulated user requirements changed. Call ready_to_finish again before continuing the audit.";
  }
  return undefined;
}

export function definitionContextError(self: TaskVerificationController): string | undefined {
  const references = self.state.requirementSourceRefs ?? [];
  if (references.length === 0) {
    if (!self.state.taskKind || !self.state.taskSummary || self.state.mutationRevision !== 0) {
      return auditContextError(self);
    }
    return "Pre-mutation definition requires prepared referenced requirement sources.";
  }
  if (!self.state.taskKind || !self.state.taskSummary) return "Declare the task before defining requirements.";
  const currentRevisionReferences = references.filter(
    (reference) => reference.capturedAtMutationRevision === self.state.mutationRevision,
  );
  if (
    currentRevisionReferences.some(
      (reference) => !preparedRequirementSourceMatches(self.sessionManager.getCwd(), reference),
    )
  ) {
    return "A referenced requirement source changed after preparation. Ask the user whether to adopt the changed specification before continuing.";
  }
  return undefined;
}
