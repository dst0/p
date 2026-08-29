import {
  preparedRequirementSourceMatches,
  referencedRequirementCandidates,
  requirementSourceSelectionMatches,
} from "../referenced-requirement-sources.ts";
import { computeStateUserRequirementsHash, sourcePromptsForState } from "../requirement-audit-hashing.ts";
import {
  deferredReferencedSourceDefinition,
  requirementDefinitionPolicyActive,
} from "../requirement-definition-policy.ts";
import { emptyReadiness } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { formatRequirementSourcePreparationGuidance } from "./requirement-source-preparation-guidance.ts";

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
  if (!self.state.taskKind || !self.state.taskSummary) return "Declare the task before defining requirements.";
  const references = self.state.requirementSourceRefs ?? [];
  if (references.length > 0) {
    const referencesToValidate =
      self.state.requirementAudit.requirements.length === 0
        ? references
        : references.filter((reference) => reference.capturedAtMutationRevision === self.state.mutationRevision);
    if (
      referencesToValidate.some(
        (reference) => !preparedRequirementSourceMatches(self.sessionManager.getCwd(), reference),
      )
    ) {
      return "A referenced requirement source changed after preparation. Ask the user whether to adopt the changed specification before continuing.";
    }
    return deferredReferencedSourceDefinition(self.state)
      ? auditContextError(self)
      : preMutationDefinitionContextError(self);
  }
  if (requirementDefinitionPolicyActive(self.state)) {
    return preMutationDefinitionContextError(self);
  }
  return auditContextError(self);
}

function preMutationDefinitionContextError(self: TaskVerificationController): string | undefined {
  if (!self.state.taskKind || !self.state.taskSummary) return "Declare the task before defining requirements.";
  const prompts = sourcePromptsForState(self.state);
  const candidates = referencedRequirementCandidates(prompts);
  const references = self.state.requirementSourceRefs ?? [];
  const ignored = self.state.ignoredRequirementSources ?? [];
  if (candidates.length > 0 && !requirementSourceSelectionMatches(prompts, references, ignored)) {
    return formatRequirementSourcePreparationGuidance(candidates.map((candidate) => candidate.path));
  }
  if (references.some((reference) => !preparedRequirementSourceMatches(self.sessionManager.getCwd(), reference))) {
    return "A referenced requirement source changed after preparation. Ask the user whether to adopt the changed specification before continuing.";
  }
  return undefined;
}
