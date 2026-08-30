import { choiceGroupConstraintErrors } from "./requirement-clause-context.ts";
import { clauseRequirementRelevanceError, sourceClauseConceptCoverageError } from "./requirement-clause-semantics.ts";
import type { RequirementSourceClause } from "./requirement-source-clauses.ts";
import {
  type RequirementSourceFacet,
  requirementFacetConstraintError,
  requirementSourceFacets,
} from "./requirement-source-facets.ts";
import type { TaskRequirement } from "./types.ts";

export interface RequirementFacetIndex {
  facetsById: ReadonlyMap<string, RequirementSourceFacet>;
  facetsByClauseId: ReadonlyMap<string, readonly RequirementSourceFacet[]>;
}

export function createRequirementFacetIndex(clauses: readonly RequirementSourceClause[]): RequirementFacetIndex {
  const entries = clauses.map((clause) => [clause.id, requirementSourceFacets(clause)] as const);
  return {
    facetsById: new Map(entries.flatMap(([, facets]) => facets.map((facet) => [facet.id, facet]))),
    facetsByClauseId: new Map(entries),
  };
}

export function validateRequirementFacetMappings(
  requirementIndex: number,
  text: string,
  acceptanceCriterion: string,
  requestedFacetIds: readonly string[],
  sourceClauseIds: readonly string[],
  clausesById: ReadonlyMap<string, RequirementSourceClause>,
  index: RequirementFacetIndex,
  validateSemantics: boolean,
  diagnostics: string[],
): string[] {
  const uniqueFacetIds = [...new Set(requestedFacetIds)];
  const duplicateFacetIds = uniqueFacetIds.filter(
    (facetId) => requestedFacetIds.filter((candidate) => candidate === facetId).length > 1,
  );
  if (duplicateFacetIds.length > 0) {
    diagnostics.push(
      `Requirement ${requirementIndex + 1} maps duplicate source facets: ${duplicateFacetIds.join(", ")}. Map each facet exactly once.`,
    );
  }
  const validFacetIds = uniqueFacetIds.filter((facetId) => index.facetsById.has(facetId));
  if (validFacetIds.length !== requestedFacetIds.length) {
    diagnostics.push(`Requirement ${requirementIndex + 1} references an invalid source_facet_id.`);
  }
  if (validFacetIds.length > 1) {
    diagnostics.push(
      `Requirement ${requirementIndex + 1} maps multiple source facets; use one facet per atomic requirement.`,
    );
  }
  const mappedFacetClauseIds = new Set(validFacetIds.map((facetId) => index.facetsById.get(facetId)!.sourceClauseId));
  const missingFacetMappings = sourceClauseIds.filter(
    (clauseId) => (index.facetsByClauseId.get(clauseId)?.length ?? 0) > 0 && !mappedFacetClauseIds.has(clauseId),
  );
  if (missingFacetMappings.length > 0) {
    diagnostics.push(
      `Requirement ${requirementIndex + 1} maps faceted source clauses without source_facet_ids: ${missingFacetMappings.join(", ")}.`,
    );
  }
  if (!validateSemantics) return validFacetIds;
  const requirement = `${text}\n${acceptanceCriterion}`;
  for (const facetId of validFacetIds) {
    const facet = index.facetsById.get(facetId)!;
    const clause = clausesById.get(facet.sourceClauseId)!;
    const relevanceError = clauseRequirementRelevanceError(
      { ...clause, id: facet.id, text: facet.text },
      text,
      acceptanceCriterion,
    );
    if (relevanceError) diagnostics.push(`Requirement ${requirementIndex + 1}: ${relevanceError}`);
    const constraintError = requirementFacetConstraintError(facet, requirement);
    if (constraintError) diagnostics.push(`Requirement ${requirementIndex + 1}: ${constraintError}`);
  }
  return validFacetIds;
}

export function sourceClauseFacetCoverageErrors(
  clause: RequirementSourceClause,
  mappedRequirements: readonly TaskRequirement[],
): string[] | undefined {
  const facets = requirementSourceFacets(clause);
  if (facets.length === 0) return undefined;
  const mapped = mappedRequirements.flatMap((requirement) => requirement.sourceFacetIds ?? []);
  const duplicate = facets.filter((facet) => mapped.filter((facetId) => facetId === facet.id).length > 1);
  const covered = new Set(mapped);
  const missing = facets.filter((facet) => !covered.has(facet.id));
  return [
    ...(duplicate.length > 0
      ? [
          `Source clause ${clause.id} has duplicate source facet mappings: ${duplicate.map((facet) => facet.id).join(", ")}. Map each facet exactly once.`,
        ]
      : []),
    ...(missing.length > 0
      ? [
          `Source clause ${clause.id} has uncovered source facets: ${missing.map((facet) => facet.id).join(", ")}. Parent clause: ${JSON.stringify(clause.text)}. Required repairs: ${missing.map((facet) => `${facet.id}=${JSON.stringify(facet.text)}`).join("; ")}. Map each listed facet exactly once with source_facet_ids.`,
        ]
      : []),
  ];
}

export function validateRequirementClauseCoverage(
  sourceClauses: readonly RequirementSourceClause[],
  requirements: readonly TaskRequirement[],
  ignoredClauseIds: ReadonlySet<string>,
  invalidOnlyClauseIds: ReadonlySet<string>,
  unevaluableOnlyClauseIds: ReadonlySet<string>,
  coveredIntroductionClauseIds: ReadonlySet<string>,
  diagnostics: string[],
): void {
  diagnostics.push(...choiceGroupConstraintErrors(sourceClauses, requirements, ignoredClauseIds));
  for (const clause of sourceClauses) {
    if (ignoredClauseIds.has(clause.id) || coveredIntroductionClauseIds.has(clause.id)) continue;
    const mapped = requirements.filter((requirement) => requirement.sourceClauseIds?.includes(clause.id));
    const facetErrors = sourceClauseFacetCoverageErrors(clause, mapped);
    if (facetErrors !== undefined) {
      if (!unevaluableOnlyClauseIds.has(clause.id)) diagnostics.push(...facetErrors);
      continue;
    }
    if (invalidOnlyClauseIds.has(clause.id)) continue;
    const conceptError = sourceClauseConceptCoverageError(
      clause,
      mapped.flatMap((requirement) => [requirement.text, requirement.acceptanceCriterion]),
    );
    if (conceptError) diagnostics.push(conceptError);
  }
}
