import { createHash } from "node:crypto";
import type {
  IgnoredSourceClause,
  IgnoredSourcePrompt,
  IgnoredTaskVerificationRequirementSource,
  TaskRequirement,
  TaskVerificationRequirementSourceRef,
  TaskVerificationSourcePrompt,
  TaskVerificationState,
} from "./types.ts";

export const REQUIREMENT_DEFINITION_POLICY_VERSION = 2;

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function sourcePromptsForState(state: TaskVerificationState): TaskVerificationSourcePrompt[] {
  const prompts = state.taskPrompts ?? [];
  if (prompts.length > 0) return prompts;
  if (state.taskContext) return [{ id: "legacy-task-context", text: state.taskContext }];
  if (state.taskSummary) return [{ id: "task-summary", text: state.taskSummary }];
  return [];
}

export function computeUserRequirementsHash(
  prompts: readonly TaskVerificationSourcePrompt[],
  sourceRefs: readonly TaskVerificationRequirementSourceRef[] = [],
  ignoredSources: readonly IgnoredTaskVerificationRequirementSource[] = [],
): string {
  const promptIdentity = prompts.map((prompt) => ({ id: prompt.id, text: prompt.text }));
  if (sourceRefs.length === 0 && ignoredSources.length === 0) return sha256(promptIdentity);
  return sha256({
    prompts: promptIdentity,
    ...(sourceRefs.length > 0 ? { requirementDefinitionPolicyVersion: REQUIREMENT_DEFINITION_POLICY_VERSION } : {}),
    requirementSources: sourceRefs.map((source) => ({
      id: source.id,
      path: source.path,
      sha256: source.sha256,
      byteLength: source.byteLength,
      referencedByPromptIds: source.referencedByPromptIds,
      capturedAtMutationRevision: source.capturedAtMutationRevision,
      origin: source.origin,
      policyVersion: source.policyVersion,
    })),
    ignoredRequirementSources: ignoredSources,
  });
}

export function computeStateUserRequirementsHash(state: TaskVerificationState): string {
  return computeUserRequirementsHash(
    sourcePromptsForState(state),
    state.requirementSourceRefs ?? [],
    state.ignoredRequirementSources ?? [],
  );
}

export function computeRequirementSetHash(
  requirements: readonly TaskRequirement[],
  ignoredSourcePrompts: readonly IgnoredSourcePrompt[],
  ignoredSourceClauses: readonly IgnoredSourceClause[] = [],
): string {
  const legacyPayload = {
    requirements: requirements.map((requirement) => ({
      id: requirement.id,
      type: requirement.type,
      text: requirement.text,
      acceptanceCriterion: requirement.acceptanceCriterion,
      sourcePromptIndexes: requirement.sourcePromptIndexes,
      sourceClauseIds: requirement.sourceClauseIds,
      sourceFacetIds: requirement.sourceFacetIds,
      highRisk: requirement.highRisk,
      highRiskSourcePromptIndexes: requirement.highRiskSourcePromptIndexes,
      proofPolicies: requirement.proofPolicies,
    })),
    ignoredSourcePrompts,
  };
  if (ignoredSourceClauses.length === 0) return sha256(legacyPayload);
  return sha256({
    ...legacyPayload,
    ignoredSourceClauses: ignoredSourceClauses.map((clause) => ({
      sourceClauseId: clause.sourceClauseId,
      classification: clause.classification,
      reason: clause.reason,
      ...(clause.supersededBySourcePromptIndex === undefined
        ? {}
        : { supersededBySourcePromptIndex: clause.supersededBySourcePromptIndex }),
    })),
  });
}

export function requirementDefinitionMatchesState(state: TaskVerificationState): boolean {
  const audit = state.requirementAudit;
  return (
    audit.requirements.length > 0 &&
    audit.userRequirementsHash === computeStateUserRequirementsHash(state) &&
    audit.requirementSetHash ===
      computeRequirementSetHash(audit.requirements, audit.ignoredSourcePrompts, audit.ignoredSourceClauses)
  );
}

export function computeCertificateHash(
  taskId: string,
  mutationRevision: number,
  userRequirementsHash: string,
  requirementSetHash: string,
): string {
  return sha256({ taskId, mutationRevision, userRequirementsHash, requirementSetHash });
}
