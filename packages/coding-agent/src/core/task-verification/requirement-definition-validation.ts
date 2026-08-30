import { REQUIREMENT_TYPES } from "./constants.ts";
import {
  completeIntroductionClauseIds,
  effectiveRequirementSourceClauses,
  inheritedListConstraintError,
} from "./requirement-clause-context.ts";
import { controllerIgnoredSourceClause } from "./requirement-clause-controller-classification.ts";
import { clauseRequirementRelevanceError } from "./requirement-clause-semantics.ts";
import { compoundHighRiskRequirementError } from "./requirement-definition-atomicity.ts";
import { validateIgnoredClauses, validateIgnoredPrompts } from "./requirement-definition-classification-validation.ts";
import {
  createRequirementFacetIndex,
  validateRequirementClauseCoverage,
  validateRequirementFacetMappings,
} from "./requirement-definition-facet-validation.ts";
import { validateReferencedSourceMappings } from "./requirement-definition-source-mapping-validation.ts";
import { deriveRequirementProofPolicies } from "./requirement-derived-boundaries.ts";
import { validateDirectHighRiskSourceCoverage } from "./requirement-direct-source-risk-validation.ts";
import { pureDelegationPromptIndexes, unclassifiedDirectPromptGuidance } from "./requirement-prompt-classification.ts";
import { isProductInvariantRequirementType, requirementRisk } from "./requirement-risk.ts";
import {
  isUnsafeDelegatedInstruction,
  type RequirementSourceClause,
  requirementSourceClauses,
} from "./requirement-source-clauses.ts";
import { normalizeText } from "./tool-classification.ts";
import type {
  IgnoredSourceClause,
  IgnoredSourcePrompt,
  RequirementAuditInput,
  TaskRequirement,
  TaskVerificationSourcePrompt,
} from "./types.ts";

export {
  formatRequirementDefinitionDiagnostics,
  MAX_REQUIREMENT_DEFINITION_DIAGNOSTIC_BYTES,
} from "./requirement-definition-diagnostics.ts";
export interface ValidatedRequirementDefinition {
  requirements: TaskRequirement[];
  ignoredSourcePrompts: IgnoredSourcePrompt[];
  ignoredSourceClauses: IgnoredSourceClause[];
}

export type RequirementDefinitionValidation =
  | { diagnostics: string[]; definition?: undefined }
  | { diagnostics: []; definition: ValidatedRequirementDefinition };
export function validateRequirementDefinition(
  prompts: readonly TaskVerificationSourcePrompt[],
  input: RequirementAuditInput,
): RequirementDefinitionValidation {
  const sourceClauses = effectiveRequirementSourceClauses(requirementSourceClauses(prompts));
  const clausesById = new Map(sourceClauses.map((clause) => [clause.id, clause]));
  const facetIndex = createRequirementFacetIndex(sourceClauses);
  const diagnostics: string[] = [];
  const requirements: TaskRequirement[] = [];
  const promptIndexesWithClauses = new Set(sourceClauses.map((clause) => clause.sourcePromptIndex));
  const pureDelegationIndexes = pureDelegationPromptIndexes(prompts);
  const coveredPromptIndexes = new Set(
    prompts.flatMap((prompt, index) =>
      prompt.kind === "referenced_file" && !promptIndexesWithClauses.has(index + 1) ? [index + 1] : [],
    ),
  );
  const declaredMappedClauseIds = new Set<string>();
  const evaluableMappedClauseIds = new Set<string>();
  const seenRequirements = new Map<string, number>();
  for (const [index, item] of (input.requirements ?? []).entries()) {
    const requirementDiagnosticStart = diagnostics.length;
    const text = normalizeText(item.text);
    const acceptanceCriterion = normalizeText(item.acceptance_criterion);
    const typeSupported = (REQUIREMENT_TYPES as readonly string[]).includes(item.type);
    if (!typeSupported) diagnostics.push(`Requirement ${index + 1} has an unsupported type.`);
    if (!text || !acceptanceCriterion) {
      diagnostics.push(`Requirement ${index + 1} needs concrete text and acceptance_criterion.`);
    } else {
      const atomicityError = compoundHighRiskRequirementError(text, acceptanceCriterion);
      if (atomicityError) diagnostics.push(`Requirement ${index + 1} is compound: ${atomicityError}.`);
    }

    if (typeSupported && text && acceptanceCriterion) {
      const duplicateKey = `${item.type}\n${text.toLowerCase()}\n${acceptanceCriterion.toLowerCase()}`;
      const preservedRequirementIndex = seenRequirements.get(duplicateKey);
      if (preservedRequirementIndex === undefined) {
        seenRequirements.set(duplicateKey, index + 1);
      } else {
        diagnostics.push(
          `Duplicate requirement: Requirement ${index + 1} duplicates Requirement ${preservedRequirementIndex}: ${text}`,
        );
      }
    }
    const requestedFacetIds = [...(item.source_facet_ids ?? [])].sort();
    const facetClauseIds = requestedFacetIds.flatMap((facetId) => {
      const facet = facetIndex.facetsById.get(facetId);
      return facet ? [facet.sourceClauseId] : [];
    });
    const requestedClauseIds = [...new Set([...(item.source_clause_ids ?? []), ...facetClauseIds])].sort();
    const validSourceClauseIds = requestedClauseIds.filter((clauseId) => clausesById.has(clauseId));
    if (text && acceptanceCriterion) {
      for (const clauseId of validSourceClauseIds) evaluableMappedClauseIds.add(clauseId);
    }
    const derivedPromptIndexes = validSourceClauseIds.map((clauseId) => clausesById.get(clauseId)!.sourcePromptIndex);
    const sourcePromptIndexes = [...new Set([...(item.source_prompt_indexes ?? []), ...derivedPromptIndexes])].sort(
      (left, right) => left - right,
    );
    const mappedPureDelegationIndexes = (item.source_prompt_indexes ?? []).filter((promptIndex) =>
      pureDelegationIndexes.has(promptIndex),
    );
    for (const promptIndex of mappedPureDelegationIndexes) {
      diagnostics.push(
        `Requirement ${index + 1} maps pure delegation/workflow prompt index ${promptIndex} as product provenance; remove that index while preserving any referenced source-clause provenance, then classify the prompt through ignored_source_prompts (ignored_source_prompt_upserts during repair).`,
      );
    }
    const validPromptIndexes =
      sourcePromptIndexes.length > 0 &&
      sourcePromptIndexes.every(
        (promptIndex) => Number.isInteger(promptIndex) && promptIndex >= 1 && promptIndex <= prompts.length,
      );
    if (!validPromptIndexes) {
      diagnostics.push(`Requirement ${index + 1} references an invalid source_prompt_index.`);
    }
    for (const clauseId of validSourceClauseIds) {
      declaredMappedClauseIds.add(clauseId);
      coveredPromptIndexes.add(clausesById.get(clauseId)!.sourcePromptIndex);
    }
    if (validSourceClauseIds.length !== requestedClauseIds.length) {
      diagnostics.push(`Requirement ${index + 1} references an invalid source_clause_id.`);
    }
    const validFacetIds = validateRequirementFacetMappings(
      index,
      text,
      acceptanceCriterion,
      requestedFacetIds,
      validSourceClauseIds,
      clausesById,
      facetIndex,
      Boolean(text && acceptanceCriterion),
      diagnostics,
    );
    const facetMappedClauseIds = new Set(
      validFacetIds.map((facetId) => facetIndex.facetsById.get(facetId)!.sourceClauseId),
    );
    validateMappedClauses(
      index,
      text,
      acceptanceCriterion,
      sourcePromptIndexes,
      validSourceClauseIds,
      clausesById,
      Boolean(text && acceptanceCriterion),
      validPromptIndexes,
      facetMappedClauseIds,
      diagnostics,
    );
    if (validPromptIndexes) {
      validateReferencedSourceMappings(index, prompts, item.source_prompt_indexes ?? [], diagnostics);
      for (const promptIndex of sourcePromptIndexes) {
        if (!mappedPureDelegationIndexes.includes(promptIndex)) coveredPromptIndexes.add(promptIndex);
      }
    }
    if (
      !typeSupported ||
      !text ||
      !acceptanceCriterion ||
      !validPromptIndexes ||
      diagnostics.length > requirementDiagnosticStart
    ) {
      continue;
    }
    const risk = requirementRisk(text, acceptanceCriterion, sourcePromptIndexes, validSourceClauseIds, sourceClauses);
    if (!isProductInvariantRequirementType(item.type) && risk.highRisk) {
      diagnostics.push(
        `Requirement ${index + 1} asserts a high-risk product/runtime invariant and must use behavior, constraint, or deliverable instead of ${item.type}. Keep any separate process or evidence step in its own ${item.type} requirement.`,
      );
      continue;
    }
    requirements.push({
      id: `R${index + 1}`,
      type: item.type,
      text,
      acceptanceCriterion,
      sourcePromptIndexes,
      sourceClauseIds: validSourceClauseIds.length > 0 ? validSourceClauseIds : undefined,
      sourceFacetIds: validFacetIds.length > 0 ? validFacetIds : undefined,
      highRisk: risk.highRisk || undefined,
      highRiskSourcePromptIndexes: risk.sourcePromptIndexes.length > 0 ? risk.sourcePromptIndexes : undefined,
    });
  }
  validateDirectHighRiskSourceCoverage(prompts, requirements, pureDelegationIndexes, diagnostics);
  const validRequirementClauseIds = new Set(requirements.flatMap((requirement) => requirement.sourceClauseIds ?? []));
  const coveredIntroductionClauseIds = completeIntroductionClauseIds(sourceClauses, validRequirementClauseIds);
  const invalidOnlyClauseIds = new Set(
    [...declaredMappedClauseIds].filter((clauseId) => !validRequirementClauseIds.has(clauseId)),
  );
  const unevaluableOnlyClauseIds = new Set(
    [...declaredMappedClauseIds].filter((clauseId) => !evaluableMappedClauseIds.has(clauseId)),
  );
  const coveredClauseIds = new Set([...declaredMappedClauseIds, ...coveredIntroductionClauseIds]);
  const modelIgnoredClauseIds = new Set(
    (input.ignored_source_clauses ?? []).map((clause) => normalizeText(clause.source_clause_id)),
  );
  const controllerIgnoredSourceClauses = sourceClauses.flatMap((clause) => {
    if (coveredClauseIds.has(clause.id) || modelIgnoredClauseIds.has(clause.id)) return [];
    const ignored = controllerIgnoredSourceClause(clause);
    return ignored ? [ignored] : [];
  });
  for (const clause of controllerIgnoredSourceClauses) {
    coveredPromptIndexes.add(clausesById.get(clause.sourceClauseId)!.sourcePromptIndex);
  }
  const modelIgnoredSourceClauses = validateIgnoredClauses(
    prompts,
    input,
    clausesById,
    coveredClauseIds,
    coveredPromptIndexes,
    diagnostics,
  );
  const ignoredSourceClauses = [...controllerIgnoredSourceClauses, ...modelIgnoredSourceClauses];
  const ignoredClauseIds = new Set(ignoredSourceClauses.map((clause) => clause.sourceClauseId));
  const missingClauseIds = sourceClauses
    .map((clause) => clause.id)
    .filter((clauseId) => !coveredClauseIds.has(clauseId) && !ignoredClauseIds.has(clauseId));
  for (const clauseId of missingClauseIds) {
    diagnostics.push(
      `Every referenced-file clause must be mapped or explicitly ignored; unclassified source_clause_ids: ${clauseId}.`,
    );
  }
  validateRequirementClauseCoverage(
    sourceClauses,
    requirements,
    ignoredClauseIds,
    invalidOnlyClauseIds,
    unevaluableOnlyClauseIds,
    coveredIntroductionClauseIds,
    diagnostics,
  );

  const inactiveClauseIds = new Set([...ignoredClauseIds, ...invalidOnlyClauseIds]);
  const proofPolicyResult = deriveRequirementProofPolicies(prompts, requirements, inactiveClauseIds);
  if (typeof proofPolicyResult === "string") diagnostics.push(proofPolicyResult);
  const validatedRequirements = typeof proofPolicyResult === "string" ? requirements : proofPolicyResult;
  const ignoredSourcePrompts = validateIgnoredPrompts(prompts, input, coveredPromptIndexes, diagnostics);
  const ignoredPromptIndexes = new Set(ignoredSourcePrompts.map((prompt) => prompt.sourcePromptIndex));
  const unclassifiedPromptIndexes = prompts
    .map((_prompt, index) => index + 1)
    .filter((index) => !coveredPromptIndexes.has(index) && !ignoredPromptIndexes.has(index));
  for (const promptIndex of unclassifiedPromptIndexes) {
    const directPromptIndexes = prompts[promptIndex - 1]?.kind === "referenced_file" ? [] : [promptIndex];
    diagnostics.push(
      `Every source prompt must be referenced or explicitly ignored; unclassified indexes: ${promptIndex}.${unclassifiedDirectPromptGuidance(directPromptIndexes, pureDelegationIndexes)}`,
    );
  }

  const uniqueDiagnostics = [...new Set(diagnostics)];
  return uniqueDiagnostics.length > 0
    ? { diagnostics: uniqueDiagnostics }
    : {
        diagnostics: [],
        definition: { requirements: validatedRequirements, ignoredSourcePrompts, ignoredSourceClauses },
      };
}

function validateMappedClauses(
  requirementIndex: number,
  text: string,
  acceptanceCriterion: string,
  sourcePromptIndexes: readonly number[],
  sourceClauseIds: readonly string[],
  clausesById: ReadonlyMap<string, RequirementSourceClause>,
  validateRelevance: boolean,
  validatePromptMappings: boolean,
  facetMappedClauseIds: ReadonlySet<string>,
  diagnostics: string[],
): void {
  for (const clauseId of sourceClauseIds) {
    const clause = clausesById.get(clauseId)!;
    if (isUnsafeDelegatedInstruction(clause.text)) {
      diagnostics.push(
        `Source clause ${clause.id} is an unsafe delegated instruction and must be classified in ignored_source_clauses.`,
      );
    }
    if (validatePromptMappings && !sourcePromptIndexes.includes(clause.sourcePromptIndex)) {
      diagnostics.push(
        `Requirement ${requirementIndex + 1} maps source clause ${clauseId} without its source_prompt_index.`,
      );
    }
    if (validateRelevance) {
      if (!facetMappedClauseIds.has(clauseId)) {
        const relevanceError = clauseRequirementRelevanceError(clause, text, acceptanceCriterion);
        if (relevanceError) diagnostics.push(`Requirement ${requirementIndex + 1}: ${relevanceError}`);
      }
      const qualifierError = inheritedListConstraintError(clause, clausesById, `${text}\n${acceptanceCriterion}`);
      if (qualifierError) diagnostics.push(`Requirement ${requirementIndex + 1}: ${qualifierError}`);
    }
  }
}
