import { directPromptSupersedesClause, ignoredClauseClassificationError } from "./requirement-clause-semantics.ts";
import { isUnsafeDelegatedInstruction, type RequirementSourceClause } from "./requirement-source-clauses.ts";
import { normalizeText } from "./tool-classification.ts";
import type {
  IgnoredSourceClause,
  IgnoredSourcePrompt,
  RequirementAuditInput,
  TaskVerificationSourcePrompt,
} from "./types.ts";

const IGNORED_CLAUSE_CLASSIFICATIONS = new Set(["informational", "example", "superseded", "unsafe_instruction"]);

export function validateIgnoredClauses(
  prompts: readonly TaskVerificationSourcePrompt[],
  input: RequirementAuditInput,
  clausesById: ReadonlyMap<string, RequirementSourceClause>,
  coveredClauseIds: ReadonlySet<string>,
  coveredPromptIndexes: Set<number>,
  diagnostics: string[],
): IgnoredSourceClause[] {
  const ignoredSourceClauses: IgnoredSourceClause[] = [];
  const ignoredClauseIds = new Set<string>();
  for (const ignored of input.ignored_source_clauses ?? []) {
    const diagnosticCount = diagnostics.length;
    const clauseId = normalizeText(ignored.source_clause_id);
    const reason = normalizeText(ignored.reason);
    const clause = clausesById.get(clauseId);
    if (!clause || !IGNORED_CLAUSE_CLASSIFICATIONS.has(ignored.classification) || !reason) {
      diagnostics.push(`Ignored source clause ${clauseId || "(missing)"} is invalid or lacks a reason.`);
      continue;
    }
    const unsafe = isUnsafeDelegatedInstruction(clause.text);
    if (unsafe && ignored.classification !== "unsafe_instruction") {
      diagnostics.push(`Source clause ${clauseId} must use classification unsafe_instruction.`);
    }
    if (!unsafe && ignored.classification === "unsafe_instruction") {
      diagnostics.push(
        `Source clause ${clauseId} is not a controller-detected unsafe instruction and cannot use unsafe_instruction.`,
      );
    }
    const classificationError = ignoredClauseClassificationError(clause, ignored.classification);
    if (classificationError) diagnostics.push(classificationError);
    validateSupersession(prompts, clause, ignored, diagnostics);
    if (coveredClauseIds.has(clauseId)) {
      diagnostics.push(`Source clause ${clauseId} cannot be both mapped and ignored.`);
    }
    if (ignoredClauseIds.has(clauseId)) diagnostics.push(`Source clause ${clauseId} is ignored twice.`);
    if (diagnostics.length > diagnosticCount) continue;
    ignoredClauseIds.add(clauseId);
    ignoredSourceClauses.push({
      sourceClauseId: clauseId,
      classification: ignored.classification,
      reason,
      ...(ignored.superseded_by_source_prompt_index === undefined
        ? {}
        : { supersededBySourcePromptIndex: ignored.superseded_by_source_prompt_index }),
    });
    coveredPromptIndexes.add(clause.sourcePromptIndex);
  }
  return ignoredSourceClauses;
}

export function validateIgnoredPrompts(
  prompts: readonly TaskVerificationSourcePrompt[],
  input: RequirementAuditInput,
  coveredPromptIndexes: ReadonlySet<number>,
  diagnostics: string[],
): IgnoredSourcePrompt[] {
  const ignoredSourcePrompts: IgnoredSourcePrompt[] = [];
  const ignoredIndexes = new Set<number>();
  for (const ignored of input.ignored_source_prompts ?? []) {
    const diagnosticCount = diagnostics.length;
    const promptIndex = ignored.source_prompt_index;
    const reason = normalizeText(ignored.reason);
    if (!Number.isInteger(promptIndex) || promptIndex < 1 || promptIndex > prompts.length || !reason) {
      diagnostics.push(`Ignored source prompt ${promptIndex} is invalid or lacks a reason.`);
      continue;
    }
    if (prompts[promptIndex - 1]?.kind === "referenced_file") {
      diagnostics.push(`Referenced requirement source ${promptIndex} cannot be ignored.`);
    }
    if (ignoredIndexes.has(promptIndex)) diagnostics.push(`Source prompt ${promptIndex} is ignored twice.`);
    if (coveredPromptIndexes.has(promptIndex)) {
      diagnostics.push(`Source prompt ${promptIndex} cannot be both referenced and ignored.`);
    }
    if (diagnostics.length > diagnosticCount) continue;
    ignoredIndexes.add(promptIndex);
    ignoredSourcePrompts.push({ sourcePromptIndex: promptIndex, reason });
  }
  return ignoredSourcePrompts;
}

function validateSupersession(
  prompts: readonly TaskVerificationSourcePrompt[],
  clause: RequirementSourceClause,
  ignored: NonNullable<RequirementAuditInput["ignored_source_clauses"]>[number],
  diagnostics: string[],
): void {
  const supersededBy = ignored.superseded_by_source_prompt_index;
  if (ignored.classification !== "superseded") {
    if (supersededBy !== undefined) {
      diagnostics.push(
        `Source clause ${clause.id} may name superseded_by_source_prompt_index only with classification superseded.`,
      );
    }
    return;
  }
  if (!Number.isInteger(supersededBy) || supersededBy! < 1 || supersededBy! > prompts.length) {
    diagnostics.push(`Superseded source clause ${clause.id} requires a direct user prompt index.`);
    return;
  }
  const supersedingPrompt = prompts[supersededBy! - 1]!;
  if (supersedingPrompt.kind === "referenced_file" || !directPromptSupersedesClause(supersedingPrompt.text, clause)) {
    diagnostics.push(
      `Direct user prompt ${supersededBy} does not conflict with or supersede source clause ${clause.id}.`,
    );
  }
}
