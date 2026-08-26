import { HIGH_RISK_PATTERN, HIGH_RISK_REQUIREMENT_PATTERN } from "./constants.ts";
import {
  hasRollbackOperationSemantics,
  withoutRollbackTerms,
  withoutStaticRollbackPropertyValues,
} from "./requirement-rollback-semantics.ts";
import type { RequirementSourceClause } from "./requirement-source-clauses.ts";

export interface RequirementRisk {
  highRisk: boolean;
  sourcePromptIndexes: number[];
}

export function requirementRisk(
  text: string,
  acceptanceCriterion: string,
  sourcePromptIndexes: readonly number[],
  sourceClauseIds: readonly string[],
  sourceClauses: readonly RequirementSourceClause[],
): RequirementRisk {
  const requirementText = `${text}\n${acceptanceCriterion}`;
  const sourceMatches = sourceClauses
    .filter((clause) => sourceClauseIds.includes(clause.id) && isHighRiskText(clause.text))
    .map((clause) => clause.sourcePromptIndex)
    .filter((sourceIndex) => sourcePromptIndexes.includes(sourceIndex));
  return {
    highRisk: isHighRiskText(requirementText) || sourceMatches.length > 0,
    sourcePromptIndexes: [...new Set(sourceMatches)].sort((left, right) => left - right),
  };
}

export function isHighRiskText(value: string): boolean {
  const semanticText = withoutStaticRollbackPropertyValues(value);
  const nonRollbackText = withoutRollbackTerms(semanticText);
  return (
    HIGH_RISK_PATTERN.test(nonRollbackText) ||
    HIGH_RISK_REQUIREMENT_PATTERN.test(nonRollbackText) ||
    hasRollbackOperationSemantics(semanticText)
  );
}
