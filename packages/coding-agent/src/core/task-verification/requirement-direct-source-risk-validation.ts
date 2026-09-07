import {
  clauseRequirementRelevanceError,
  isNormativeSourceClause,
  sourceClauseConceptCoverageError,
} from "./requirement-clause-semantics.ts";
import { splitSourceClauses } from "./requirement-literal-boundaries.ts";
import { isHighRiskText, isProductInvariantRequirementType } from "./requirement-risk.ts";
import type { RequirementSourceClause } from "./requirement-source-clauses.ts";
import type { TaskRequirement, TaskVerificationSourcePrompt } from "./types.ts";

export function validateDirectHighRiskSourceCoverage(
  prompts: readonly TaskVerificationSourcePrompt[],
  requirements: readonly TaskRequirement[],
  pureDelegationPromptIndexes: ReadonlySet<number>,
  diagnostics: string[],
): void {
  for (const [promptOffset, prompt] of prompts.entries()) {
    const promptIndex = promptOffset + 1;
    if (
      prompt.kind === "referenced_file" ||
      pureDelegationPromptIndexes.has(promptIndex) ||
      !isHighRiskText(prompt.text)
    ) {
      continue;
    }
    const mappedRequirements = requirements.filter(
      (requirement) =>
        requirement.sourcePromptIndexes.includes(promptIndex) &&
        isProductInvariantRequirementType(requirement.type) &&
        isHighRiskText(`${requirement.text}\n${requirement.acceptanceCriterion}`),
    );
    for (const [clauseOffset, clause] of directPromptClauses(prompt.text).entries()) {
      if (clause.kind !== "prose" || !isHighRiskText(clause.text)) continue;
      const sourceClause: RequirementSourceClause = {
        id: `direct-prompt-${promptIndex}-clause-${clauseOffset + 1}`,
        sourcePromptIndex: promptIndex,
        kind: "prose",
        text: clause.text,
        normativeHint: true,
      };
      const relevantMappedTexts = mappedRequirements.flatMap((requirement) => {
        const relevanceError = clauseRequirementRelevanceError(
          sourceClause,
          requirement.text,
          requirement.acceptanceCriterion,
        );
        if (relevanceError?.includes("behavioral polarity")) {
          diagnostics.push(`Direct source prompt index ${promptIndex} clause ${clauseOffset + 1}: ${relevanceError}`);
        }
        return relevanceError === undefined ? [requirement.text, requirement.acceptanceCriterion] : [];
      });
      const coverageError = sourceClauseConceptCoverageError(sourceClause, relevantMappedTexts);
      if (relevantMappedTexts.length > 0 && coverageError === undefined) continue;
      if (coverageError) {
        diagnostics.push(`Direct source prompt index ${promptIndex} clause ${clauseOffset + 1}: ${coverageError}`);
      }
      diagnostics.push(
        `Direct source prompt index ${promptIndex} clause ${clauseOffset + 1} asserts a high-risk product/runtime invariant; a semantically relevant mapped requirement must retain that invariant and must use behavior, constraint, or deliverable. Keep any separate process or evidence step in its own workflow or verification requirement.`,
      );
    }
  }
}

interface DirectPromptClause {
  kind: RequirementSourceClause["kind"];
  text: string;
}

function directPromptClauses(text: string): DirectPromptClause[] {
  const clauses: DirectPromptClause[] = [];
  let inFence = false;
  for (const rawLine of text.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (/^```/u.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (!trimmed) continue;
    if (inFence) {
      clauses.push({ kind: "code", text: trimmed });
      continue;
    }
    const markdownHeading = trimmed.match(/^#{1,6}\s+(.+)$/u);
    if (markdownHeading) {
      const headingText = markdownHeading[1]!.trim();
      clauses.push({ kind: isNormativeDirectText(headingText) ? "prose" : "heading", text: headingText });
      continue;
    }
    const withoutListMarker = trimmed.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/u, "");
    const heading = standaloneDirectHeading(withoutListMarker);
    if (heading) {
      clauses.push({ kind: "heading", text: heading });
      continue;
    }
    for (const part of splitSourceClauses(withoutListMarker)) {
      const normalized = part.trim();
      if (normalized) clauses.push({ kind: "prose", text: normalized });
    }
  }
  return clauses;
}

function standaloneDirectHeading(value: string): string | undefined {
  const normalized = value
    .trim()
    .replace(/^(?:\*{1,2}|_{1,2})\s*/u, "")
    .replace(/\s*(?:\*{1,2}|_{1,2})$/u, "");
  if (!normalized.endsWith(":")) return undefined;
  const label = normalized.slice(0, -1).trim();
  if (!label) return undefined;
  return isNormativeDirectText(label) ? undefined : label;
}

function isNormativeDirectText(text: string): boolean {
  const candidate: RequirementSourceClause = {
    id: "direct-heading-candidate",
    sourcePromptIndex: 0,
    kind: "prose",
    text,
  };
  return isNormativeSourceClause(candidate);
}
