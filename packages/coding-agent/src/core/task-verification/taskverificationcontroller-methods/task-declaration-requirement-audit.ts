import { requirementDefinitionMatchesState } from "../requirement-audit-hashing.ts";
import { requirementDefinitionSources } from "../requirement-source-storage.ts";
import { emptyRequirementAudit } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { TaskRequirement, TaskRequirementAuditState, TaskVerificationSourcePrompt } from "../types.ts";

export function requirementAuditAfterTaskDeclaration(
  self: TaskVerificationController,
  taskSummary: string,
  taskPrompts: TaskVerificationSourcePrompt[],
): TaskRequirementAuditState {
  const audit = self.state.requirementAudit;
  const prospectiveState = {
    ...self.state,
    taskSummary,
    taskContext: self.latestUserPrompt.slice(0, 2_000) || undefined,
    taskPrompts,
  };
  const sourcesAvailable =
    !self.restoreError &&
    typeof requirementDefinitionSources(prospectiveState, self.requirementSourceTexts) !== "string";
  const preparedSourcesAvailable = sourcesAvailable && (prospectiveState.requirementSourceRefs?.length ?? 0) > 0;
  if (audit.status === "awaiting_definition") {
    return preparedSourcesAvailable ? structuredClone(audit) : emptyRequirementAudit();
  }
  if (!sourcesAvailable || !requirementDefinitionMatchesState(prospectiveState)) {
    return preparedSourcesAvailable
      ? { ...emptyRequirementAudit(), status: "awaiting_definition" }
      : emptyRequirementAudit();
  }
  return {
    status: "verifying",
    requirements: audit.requirements.map(requirementDefinition),
    ignoredSourcePrompts: structuredClone(audit.ignoredSourcePrompts),
    ignoredSourceClauses: structuredClone(audit.ignoredSourceClauses ?? []),
    nextRequirementIndex: 0,
    userRequirementsHash: audit.userRequirementsHash,
    requirementSetHash: audit.requirementSetHash,
  };
}

function requirementDefinition(requirement: TaskRequirement): TaskRequirement {
  return {
    id: requirement.id,
    type: requirement.type,
    text: requirement.text,
    acceptanceCriterion: requirement.acceptanceCriterion,
    sourcePromptIndexes: structuredClone(requirement.sourcePromptIndexes),
    sourceClauseIds: structuredClone(requirement.sourceClauseIds),
    sourceFacetIds: structuredClone(requirement.sourceFacetIds),
    highRisk: requirement.highRisk,
    highRiskSourcePromptIndexes: structuredClone(requirement.highRiskSourcePromptIndexes),
    proofPolicies: structuredClone(requirement.proofPolicies),
  };
}
