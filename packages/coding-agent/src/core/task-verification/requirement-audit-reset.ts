import { emptyRequirementAudit } from "./state-factories.ts";
import type { TaskRequirementAuditState } from "./types.ts";

export function resetRequirementAuditAfterMutation(audit: TaskRequirementAuditState): TaskRequirementAuditState {
  const requirements = audit.requirements.map((requirement) => ({
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
  }));
  if (requirements.length === 0) return emptyRequirementAudit();
  return {
    ...audit,
    status: "pending",
    requirements,
    nextRequirementIndex: 0,
    verifiedMutationRevision: undefined,
  };
}
