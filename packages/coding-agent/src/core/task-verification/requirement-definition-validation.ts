import { REQUIREMENT_TYPES } from "./constants.ts";
import { clauseRequirementRelevanceError, sourceClauseConceptCoverageError } from "./requirement-clause-semantics.ts";
import { compoundHighRiskRequirementError } from "./requirement-definition-atomicity.ts";
import { validateIgnoredClauses, validateIgnoredPrompts } from "./requirement-definition-classification-validation.ts";
import { deriveRequirementProofPolicies } from "./requirement-derived-boundaries.ts";
import { requirementRisk } from "./requirement-risk.ts";
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
  const sourceClauses = requirementSourceClauses(prompts);
  const clausesById = new Map(sourceClauses.map((clause) => [clause.id, clause]));
  const diagnostics: string[] = [];
  const requirements: TaskRequirement[] = [];
  const promptIndexesWithClauses = new Set(sourceClauses.map((clause) => clause.sourcePromptIndex));
  const coveredPromptIndexes = new Set(
    prompts.flatMap((prompt, index) =>
      prompt.kind === "referenced_file" && !promptIndexesWithClauses.has(index + 1) ? [index + 1] : [],
    ),
  );
  const declaredMappedClauseIds = new Set<string>();
  const seenRequirements = new Set<string>();

  for (const [index, item] of (input.requirements ?? []).entries()) {
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
      if (seenRequirements.has(duplicateKey)) diagnostics.push(`Duplicate requirement: ${text}`);
      seenRequirements.add(duplicateKey);
    }

    const sourcePromptIndexes = [...new Set(item.source_prompt_indexes)].sort((left, right) => left - right);
    const validPromptIndexes =
      sourcePromptIndexes.length > 0 &&
      sourcePromptIndexes.every(
        (promptIndex) => Number.isInteger(promptIndex) && promptIndex >= 1 && promptIndex <= prompts.length,
      );
    if (!validPromptIndexes) {
      diagnostics.push(`Requirement ${index + 1} references an invalid source_prompt_index.`);
    }
    const requestedClauseIds = [...new Set(item.source_clause_ids ?? [])].sort();
    const validSourceClauseIds = requestedClauseIds.filter((clauseId) => clausesById.has(clauseId));
    for (const clauseId of validSourceClauseIds) {
      declaredMappedClauseIds.add(clauseId);
      coveredPromptIndexes.add(clausesById.get(clauseId)!.sourcePromptIndex);
    }
    if (validSourceClauseIds.length !== requestedClauseIds.length) {
      diagnostics.push(`Requirement ${index + 1} references an invalid source_clause_id.`);
    }
    validateMappedClauses(
      index,
      text,
      acceptanceCriterion,
      sourcePromptIndexes,
      validSourceClauseIds,
      clausesById,
      Boolean(text && acceptanceCriterion),
      validPromptIndexes,
      diagnostics,
    );
    if (validPromptIndexes) {
      validateReferencedSourceMappings(
        index,
        prompts,
        sourcePromptIndexes,
        validSourceClauseIds,
        clausesById,
        diagnostics,
      );
      for (const promptIndex of sourcePromptIndexes) coveredPromptIndexes.add(promptIndex);
    }
    if (!typeSupported || !text || !acceptanceCriterion || !validPromptIndexes) continue;
    const risk = requirementRisk(text, acceptanceCriterion, sourcePromptIndexes, validSourceClauseIds, sourceClauses);
    requirements.push({
      id: `R${index + 1}`,
      type: item.type,
      text,
      acceptanceCriterion,
      sourcePromptIndexes,
      sourceClauseIds: validSourceClauseIds.length > 0 ? validSourceClauseIds : undefined,
      highRisk: risk.highRisk || undefined,
      highRiskSourcePromptIndexes: risk.sourcePromptIndexes.length > 0 ? risk.sourcePromptIndexes : undefined,
    });
  }

  const validRequirementClauseIds = new Set(requirements.flatMap((requirement) => requirement.sourceClauseIds ?? []));
  const malformedOnlyClauseIds = new Set(
    [...declaredMappedClauseIds].filter((clauseId) => !validRequirementClauseIds.has(clauseId)),
  );
  const coveredClauseIds = declaredMappedClauseIds;
  const ignoredSourceClauses = validateIgnoredClauses(
    prompts,
    input,
    clausesById,
    coveredClauseIds,
    coveredPromptIndexes,
    diagnostics,
  );
  const ignoredClauseIds = new Set(ignoredSourceClauses.map((clause) => clause.sourceClauseId));
  const missingClauseIds = sourceClauses
    .map((clause) => clause.id)
    .filter((clauseId) => !coveredClauseIds.has(clauseId) && !ignoredClauseIds.has(clauseId));
  if (missingClauseIds.length > 0) {
    diagnostics.push(
      `Every referenced-file clause must be mapped or explicitly ignored; unclassified source_clause_ids: ${missingClauseIds.join(", ")}.`,
    );
  }
  validateClauseConceptCoverage(sourceClauses, requirements, ignoredClauseIds, malformedOnlyClauseIds, diagnostics);

  const inactiveClauseIds = new Set([...ignoredClauseIds, ...malformedOnlyClauseIds]);
  const proofPolicyResult = deriveRequirementProofPolicies(prompts, requirements, inactiveClauseIds);
  if (typeof proofPolicyResult === "string") diagnostics.push(proofPolicyResult);
  const validatedRequirements = typeof proofPolicyResult === "string" ? requirements : proofPolicyResult;
  const ignoredSourcePrompts = validateIgnoredPrompts(prompts, input, coveredPromptIndexes, diagnostics);
  const ignoredPromptIndexes = new Set(ignoredSourcePrompts.map((prompt) => prompt.sourcePromptIndex));
  const unclassifiedPromptIndexes = prompts
    .map((_prompt, index) => index + 1)
    .filter((index) => !coveredPromptIndexes.has(index) && !ignoredPromptIndexes.has(index));
  if (unclassifiedPromptIndexes.length > 0) {
    diagnostics.push(
      `Every source prompt must be referenced or explicitly ignored; unclassified indexes: ${unclassifiedPromptIndexes.join(", ")}.`,
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
      const relevanceError = clauseRequirementRelevanceError(clause, text, acceptanceCriterion);
      if (relevanceError) diagnostics.push(`Requirement ${requirementIndex + 1}: ${relevanceError}`);
    }
  }
}

function validateReferencedSourceMappings(
  requirementIndex: number,
  prompts: readonly TaskVerificationSourcePrompt[],
  sourcePromptIndexes: readonly number[],
  sourceClauseIds: readonly string[],
  clausesById: ReadonlyMap<string, RequirementSourceClause>,
  diagnostics: string[],
): void {
  const missingMapping = sourcePromptIndexes.some(
    (promptIndex) =>
      prompts[promptIndex - 1]?.kind === "referenced_file" &&
      !sourceClauseIds.some((clauseId) => clausesById.get(clauseId)?.sourcePromptIndex === promptIndex),
  );
  if (missingMapping) {
    diagnostics.push(
      `Requirement ${requirementIndex + 1} must map every referenced-file source index to at least one source_clause_id.`,
    );
  }
}

function validateClauseConceptCoverage(
  sourceClauses: readonly RequirementSourceClause[],
  requirements: readonly TaskRequirement[],
  ignoredClauseIds: ReadonlySet<string>,
  malformedOnlyClauseIds: ReadonlySet<string>,
  diagnostics: string[],
): void {
  for (const clause of sourceClauses) {
    if (ignoredClauseIds.has(clause.id) || malformedOnlyClauseIds.has(clause.id)) continue;
    const mapped = requirements.filter((requirement) => requirement.sourceClauseIds?.includes(clause.id));
    const error = sourceClauseConceptCoverageError(
      clause,
      mapped.map((requirement) => `${requirement.text}\n${requirement.acceptanceCriterion}`),
    );
    if (error) diagnostics.push(error);
  }
}
