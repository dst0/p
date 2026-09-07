import { effectiveRequirementSourceClause } from "./requirement-clause-context.ts";
import type { RequirementDefinitionRepairTarget } from "./requirement-definition-repair-target.ts";
import {
  type RequirementSourceClauseCatalogEntry,
  requirementSourceClauseCatalog,
} from "./requirement-source-clauses.ts";
import { type RequirementSourceFacet, requirementSourceFacets } from "./requirement-source-facets.ts";
import type { RequirementAuditInput, TaskVerificationSourcePrompt } from "./types.ts";

type RequirementInput = NonNullable<RequirementAuditInput["requirements"]>[number];

export const REQUIREMENT_REPAIR_IDENTITY_GUIDANCE =
  "The selected_repair_target envelope is controller-authoritative. Never infer, renumber, or reuse an unlisted source mapping; request status if another exact source item is needed.";

interface RepairSourceContext {
  source_prompt_index: number;
  source_id: string;
  source_kind: "user_prompt" | "referenced_file";
  source_path?: string;
  source_sha256?: string;
  source_clause_id?: string;
  clause_kind?: RequirementSourceClauseCatalogEntry["kind"];
  clause_text?: string;
  clause_line?: number;
  clause_part?: number;
  source_facet_id?: string;
  facet_text?: string;
  facet_kind?: RequirementSourceFacet["kind"];
  facet_branch?: RequirementSourceFacet["branch"];
  facet_qualifiers?: string[];
  prompt_text?: string;
}

export interface RequirementDefinitionRepairContext {
  text: string;
  identityResolved: boolean;
}

export function formatRequirementDefinitionRepairContext(
  target: RequirementDefinitionRepairTarget,
  sourcePrompts: readonly TaskVerificationSourcePrompt[],
  requirements: readonly RequirementInput[],
): string {
  return renderRequirementDefinitionRepairContext(target, sourcePrompts, requirements).text;
}

export function renderRequirementDefinitionRepairContext(
  target: RequirementDefinitionRepairTarget,
  sourcePrompts: readonly TaskVerificationSourcePrompt[],
  requirements: readonly RequirementInput[],
): RequirementDefinitionRepairContext {
  const selectedRequirementIndexes = targetRequirementIndexes(target);
  const selectedRequirements = selectedRequirementIndexes.flatMap((index) => {
    const requirement = requirements[index - 1];
    return requirement ? [{ requirement_index: index, requirement }] : [];
  });
  const clauses = requirementSourceClauseCatalog(sourcePrompts);
  const clausesById = new Map(clauses.map((clause) => [clause.id, clause]));
  const clauseIds = selectedClauseIds(target, selectedRequirements);
  const facetIds = selectedFacetIds(target, selectedRequirements);
  const facetClauseIds = new Set(facetIds.map((facetId) => facetId.replace(/-F\d+$/u, "")));
  const promptIndexes = selectedPromptIndexes(target, selectedRequirements);
  const sourceContexts = [
    ...clauseIds
      .filter((clauseId) => !facetClauseIds.has(clauseId))
      .flatMap((clauseId) => clauseSourceContext(clauseId, clauses, sourcePrompts)),
    ...facetIds.flatMap((facetId) => facetSourceContext(facetId, clauses, clausesById, sourcePrompts)),
    ...promptIndexes.flatMap((promptIndex) => directPromptContext(promptIndex, sourcePrompts)),
  ];
  const unresolvedSourceIds = clauseIds.filter(
    (clauseId) => !sourceContexts.some((context) => context.source_clause_id === clauseId),
  );
  const unresolvedPromptIndexes = promptIndexes.filter(
    (promptIndex) =>
      !sourceContexts.some(
        (context) => context.source_prompt_index === promptIndex && context.source_kind === "user_prompt",
      ),
  );
  const unresolvedFacetIds = facetIds.filter(
    (facetId) => !sourceContexts.some((context) => context.source_facet_id === facetId),
  );
  const identityResolved = targetIdentityResolved(
    target,
    selectedRequirements.length,
    unresolvedSourceIds,
    unresolvedPromptIndexes,
    unresolvedFacetIds,
  );
  return {
    text: `selected_repair_target: ${JSON.stringify({
      target_key: repairTargetKey(target),
      target_kind: target.kind,
      diagnostic_index: 1,
      diagnostic: target.diagnostic,
      identity_resolved: identityResolved,
      ...(selectedRequirements.length > 0 ? { selected_requirements: selectedRequirements } : {}),
      source_contexts: sourceContexts,
      ...(unresolvedSourceIds.length > 0 ? { unresolved_source_clause_ids: unresolvedSourceIds } : {}),
      ...(unresolvedFacetIds.length > 0 ? { unresolved_source_facet_ids: unresolvedFacetIds } : {}),
      ...(unresolvedPromptIndexes.length > 0 ? { unresolved_source_prompt_indexes: unresolvedPromptIndexes } : {}),
    })}`,
    identityResolved,
  };
}

function targetRequirementIndexes(target: RequirementDefinitionRepairTarget): number[] {
  if (target.kind === "requirement") return [target.requirementIndex];
  if (target.kind !== "duplicate_consolidation") return [];
  return [target.preservedRequirementIndex, ...target.removedRequirementIndexes];
}

function selectedClauseIds(
  target: RequirementDefinitionRepairTarget,
  selectedRequirements: readonly { requirement: RequirementInput }[],
): string[] {
  const ids = new Set<string>();
  if (
    target.kind === "ignored_clause_removal" ||
    target.kind === "clause_addition" ||
    target.kind === "clause_classify_or_add"
  ) {
    ids.add(target.sourceClauseId);
  }
  for (const match of target.diagnostic.matchAll(/\bS\d+-C\d+\b/gu)) ids.add(match[0]);
  for (const { requirement } of selectedRequirements) {
    for (const clauseId of requirement.source_clause_ids ?? []) ids.add(clauseId);
    for (const facetId of requirement.source_facet_ids ?? []) ids.add(facetId.replace(/-F\d+$/u, ""));
  }
  return [...ids];
}

function selectedPromptIndexes(
  target: RequirementDefinitionRepairTarget,
  selectedRequirements: readonly { requirement: RequirementInput }[],
): number[] {
  const indexes = new Set<number>();
  if (target.kind === "prompt_classify_or_add") indexes.add(target.sourcePromptIndex);
  for (const { requirement } of selectedRequirements) {
    for (const promptIndex of requirement.source_prompt_indexes ?? []) indexes.add(promptIndex);
  }
  return [...indexes];
}

function selectedFacetIds(
  target: RequirementDefinitionRepairTarget,
  selectedRequirements: readonly { requirement: RequirementInput }[],
): string[] {
  const ids = new Set<string>();
  for (const match of target.diagnostic.matchAll(/\bS\d+-C\d+-F\d+\b/gu)) ids.add(match[0]);
  for (const { requirement } of selectedRequirements) {
    for (const facetId of requirement.source_facet_ids ?? []) ids.add(facetId);
  }
  return [...ids];
}

function clauseSourceContext(
  clauseId: string,
  clauses: readonly RequirementSourceClauseCatalogEntry[],
  sourcePrompts: readonly TaskVerificationSourcePrompt[],
): RepairSourceContext[] {
  const clause = clauses.find((candidate) => candidate.id === clauseId);
  if (!clause) return [];
  const source = sourcePrompts[clause.sourcePromptIndex - 1];
  if (!source) return [];
  return [
    {
      source_prompt_index: clause.sourcePromptIndex,
      source_id: source.id,
      source_kind: source.kind ?? "user_prompt",
      ...(source.path ? { source_path: source.path } : {}),
      ...(source.sha256 ? { source_sha256: source.sha256 } : {}),
      source_clause_id: clause.id,
      clause_kind: clause.kind,
      clause_text: clause.text,
      clause_line: clause.line,
      clause_part: clause.part,
    },
  ];
}

function facetSourceContext(
  facetId: string,
  clauses: readonly RequirementSourceClauseCatalogEntry[],
  clausesById: ReadonlyMap<string, RequirementSourceClauseCatalogEntry>,
  sourcePrompts: readonly TaskVerificationSourcePrompt[],
): RepairSourceContext[] {
  const clauseId = facetId.replace(/-F\d+$/u, "");
  const clause = clauses.find((candidate) => candidate.id === clauseId);
  const effectiveClause = clause ? effectiveRequirementSourceClause(clause, clausesById) : undefined;
  const facet = effectiveClause
    ? requirementSourceFacets(effectiveClause).find((candidate) => candidate.id === facetId)
    : undefined;
  if (!clause || !facet) return [];
  const source = sourcePrompts[clause.sourcePromptIndex - 1];
  if (!source) return [];
  return [
    {
      source_prompt_index: clause.sourcePromptIndex,
      source_id: source.id,
      source_kind: source.kind ?? "user_prompt",
      ...(source.path ? { source_path: source.path } : {}),
      ...(source.sha256 ? { source_sha256: source.sha256 } : {}),
      source_clause_id: clause.id,
      clause_kind: clause.kind,
      clause_text: clause.text,
      clause_line: clause.line,
      clause_part: clause.part,
      source_facet_id: facet.id,
      facet_text: facet.text,
      facet_kind: facet.kind,
      facet_branch: facet.branch,
      facet_qualifiers: facet.qualifiers,
    },
  ];
}

function directPromptContext(
  promptIndex: number,
  sourcePrompts: readonly TaskVerificationSourcePrompt[],
): RepairSourceContext[] {
  const source = sourcePrompts[promptIndex - 1];
  if (!source || source.kind === "referenced_file") return [];
  return [
    {
      source_prompt_index: promptIndex,
      source_id: source.id,
      source_kind: source.kind ?? "user_prompt",
      prompt_text: source.text,
    },
  ];
}

function repairTargetKey(target: RequirementDefinitionRepairTarget): string {
  if (target.kind === "requirement") return `requirement:${target.requirementIndex}`;
  if (target.kind === "duplicate_consolidation") return `duplicate:${target.removedRequirementIndexes.join(",")}`;
  if (target.kind === "prompt_classify_or_add") return `source_prompt:${target.sourcePromptIndex}`;
  if (target.kind === "diagnostic_only") return "diagnostic:1";
  return `source_clause:${target.sourceClauseId}`;
}

function targetIdentityResolved(
  target: RequirementDefinitionRepairTarget,
  selectedRequirementCount: number,
  unresolvedSourceIds: readonly string[],
  unresolvedPromptIndexes: readonly number[],
  unresolvedFacetIds: readonly string[],
): boolean {
  if (target.kind === "requirement") return selectedRequirementCount === 1;
  if (target.kind === "duplicate_consolidation") {
    return selectedRequirementCount === 1 + target.removedRequirementIndexes.length;
  }
  if (target.kind === "prompt_classify_or_add") return unresolvedPromptIndexes.length === 0;
  if (target.kind === "diagnostic_only") {
    return unresolvedSourceIds.length === 0 && unresolvedPromptIndexes.length === 0 && unresolvedFacetIds.length === 0;
  }
  return unresolvedSourceIds.length === 0;
}
