import type { RequirementSourceClause } from "./requirement-source-clauses.ts";
import type { TaskRequirement } from "./types.ts";

const INHERITED_CONSTRAINT_PATTERN =
  /\b(?:all|any|each|either|every|one\s+of|exactly\s+[\p{L}\p{N}]+|at\s+(?:least|most)\s+[\p{L}\p{N}]+)\b|(?<![-\p{L}\p{N}_])only(?![-\p{L}\p{N}_])/giu;
const NEGATIVE_SCOPE_PATTERN =
  /\b(?:never|cannot|can't|don't|doesn't|didn't|mustn't|shouldn't|won't|wouldn't|(?:must|shall|should|may|can|do|does|did|is|are|was|were|will|would)\s+not)\b/iu;
const NEGATIVE_SCOPE_PREDICATE_PATTERN =
  /\b(?:never|cannot|can't|don't|doesn't|didn't|mustn't|shouldn't|won't|wouldn't|(?:must|shall|should|may|can|do|does|did|is|are|was|were|will|would)\s+not)\b\s+(?:be\s+)?([\p{L}\p{N}]+)/giu;
const CHOICE_GROUP_PATTERN =
  /\b(?:either|one\s+of|any\s+one\s+of|(?<!-)only\s+one(?:\s+of)?|(?:exactly|at\s+(?:least|most))\s+[\p{L}\p{N}]+\s+of)\b/iu;
const NEGATIVE_SENTENCE_END_PATTERN = /[.!?;\n]/u;
const NEGATIVE_SEMANTIC_BOUNDARY_PATTERN =
  /\b(?:after|and|before|but|except(?:\s+when)?|however|instead|only\s+if|or|provided(?:\s+that)?|assuming(?:\s+that)?|then|unless|until|whenever|when|whereas|while|if|once|yet)\b/giu;
const PROTECTED_BEHAVIOR_DENIAL_PATTERN =
  /\b(?:avoid\w*|ban\w*|block\w*|den(?:y|ies|ied|ying)|disallow\w*|forbid\w*|forbidden|impossible|prevent\w*|prohibit\w*|reject\w*|unchanged)\b|\b(?:not|never)\s+(?:allowed|permitted)\b/iu;
const DENIAL_PREDICATE_PATTERN =
  /^(?:avoid\w*|ban\w*|block\w*|den(?:y|ies|ied|ying)|disallow\w*|forbid\w*|forbidden|impossible|prevent\w*|prohibit\w*|reject\w*|unchanged)$/iu;
const REVERSAL_CLAUSE_BOUNDARY_PATTERN = /\b(?:and|but|however|instead|or|then|whereas|yet)\b/iu;
const PROPOSITION_STOP_WORDS = new Set([
  "a",
  "an",
  "are",
  "be",
  "can",
  "cannot",
  "could",
  "did",
  "do",
  "does",
  "don",
  "doesn",
  "didn",
  "follow",
  "item",
  "is",
  "may",
  "must",
  "mustn",
  "never",
  "not",
  "shall",
  "should",
  "shouldn",
  "the",
  "thes",
  "this",
  "thos",
  "to",
  "was",
  "were",
  "will",
  "won",
  "would",
  "wouldn",
]);

export function effectiveRequirementSourceClause(
  clause: RequirementSourceClause,
  clausesById: ReadonlyMap<string, RequirementSourceClause>,
): RequirementSourceClause {
  if (!clause.introducedByClauseId) return clause;
  const introductionText = requirementIntroductionText(clause, clausesById);
  return {
    ...clause,
    text: `${introductionText} ${clause.text}`,
  };
}

export function effectiveRequirementSourceClauses(
  clauses: readonly RequirementSourceClause[],
): RequirementSourceClause[] {
  const clausesById = new Map(clauses.map((clause) => [clause.id, clause]));
  return clauses.map((clause) => effectiveRequirementSourceClause(clause, clausesById));
}

export function inheritedListConstraintError(
  clause: RequirementSourceClause,
  clausesById: ReadonlyMap<string, RequirementSourceClause>,
  requirementText: string,
): string | undefined {
  if (!clause.introducedByClauseId) return undefined;
  const sourceConstraints = inheritedConstraints(requirementIntroductionText(clause, clausesById));
  const requirementConstraints = inheritedConstraints(requirementText);
  const missing = [...sourceConstraints].filter((constraint) => !requirementConstraints.has(constraint));
  if (missing.length > 0) {
    return `Source clause ${clause.id} has universal qualifiers or quantity constraints missing from the mapped requirement: ${missing.join(", ")}.`;
  }
  const introductionText = requirementIntroductionText(clause, clausesById);
  if (NEGATIVE_SCOPE_PATTERN.test(introductionText)) {
    const proposition = propositionTokens(clause.text);
    if (proposition.size === 0 || !requirementNegatesProposition(requirementText, clause.text, proposition)) {
      return `Source clause ${clause.id} inherits a negative scope that is missing from or bound to a different behavior in the mapped requirement.`;
    }
  }
  return undefined;
}

export function choiceGroupConstraintErrors(
  sourceClauses: readonly RequirementSourceClause[],
  requirements: readonly TaskRequirement[],
  ignoredClauseIds: ReadonlySet<string>,
): string[] {
  const clausesById = new Map(sourceClauses.map((clause) => [clause.id, clause]));
  const childrenByIntroduction = directChildrenByIntroduction(sourceClauses);
  const diagnostics: string[] = [];
  for (const [introductionId, directChildIds] of childrenByIntroduction) {
    const introduction = clausesById.get(introductionId);
    if (!introduction || !CHOICE_GROUP_PATTERN.test(introduction.text)) continue;
    const governedLeafIds = directChildIds
      .flatMap((childId) => terminalDescendantIds(childId, childrenByIntroduction))
      .filter((clauseId) => !ignoredClauseIds.has(clauseId));
    if (governedLeafIds.length < 2) continue;
    const mappedRequirementIndexes = requirements.flatMap((requirement, index) =>
      requirement.sourceClauseIds?.some((clauseId) => governedLeafIds.includes(clauseId)) ? [index + 1] : [],
    );
    const coordinated = mappedRequirementIndexes.filter((index) =>
      governedLeafIds.every((clauseId) => requirements[index - 1]?.sourceClauseIds?.includes(clauseId)),
    );
    if (mappedRequirementIndexes.length !== 1 || coordinated.length !== 1) {
      diagnostics.push(
        `Source clause ${introductionId} introduces a choice/cardinality group whose active alternatives (${governedLeafIds.join(", ")}) must be mapped together in one requirement; independent requirements would assert contradictory or stronger sibling obligations.`,
      );
    }
  }
  return diagnostics;
}

function requirementIntroductionText(
  clause: RequirementSourceClause,
  clausesById: ReadonlyMap<string, RequirementSourceClause>,
): string {
  const introductions: string[] = [];
  const visited = new Set<string>([clause.id]);
  let introductionId: string | undefined = clause.introducedByClauseId;
  while (introductionId && !visited.has(introductionId)) {
    visited.add(introductionId);
    const introduction = clausesById.get(introductionId);
    if (!introduction) break;
    introductions.unshift(introduction.text.replace(/:\s*$/u, ""));
    introductionId = introduction.introducedByClauseId;
  }
  return introductions.join(" ");
}

function requirementNegatesProposition(
  requirementText: string,
  sourceText: string,
  proposition: ReadonlySet<string>,
): boolean {
  const sourceBoundaries = negativeSemanticBoundaries(sourceText);
  let matchedNegative = false;
  for (const segment of requirementText.split(NEGATIVE_SENTENCE_END_PATTERN).filter((value) => value.trim())) {
    if (segmentNegatesProposition(segment, sourceBoundaries, proposition)) {
      matchedNegative = true;
      continue;
    }
    const segmentTokens = propositionTokens(segment);
    if (
      [...proposition].every((token) => segmentTokens.has(token)) &&
      !hasConsistentProtectedBehaviorDenial(segment, proposition)
    ) {
      return false;
    }
  }
  return matchedNegative;
}

function segmentNegatesProposition(
  segment: string,
  sourceBoundaries: readonly string[],
  proposition: ReadonlySet<string>,
): boolean {
  for (const match of segment.matchAll(NEGATIVE_SCOPE_PREDICATE_PATTERN)) {
    if (match[1] === undefined || match.index === undefined) continue;
    const segmentTokens = propositionTokens(segment);
    const negatedPredicate = predicateRoot(match[1]);
    if (!proposition.has(negatedPredicate)) continue;
    if (![...proposition].every((token) => segmentTokens.has(token))) continue;
    if (!sameOrderedValues(sourceBoundaries, negativeSemanticBoundaries(segment))) continue;
    return true;
  }
  return false;
}

function hasConsistentProtectedBehaviorDenial(segment: string, proposition: ReadonlySet<string>): boolean {
  const relevantClauses = segment
    .split(REVERSAL_CLAUSE_BOUNDARY_PATTERN)
    .filter((clause) => [...proposition].every((token) => propositionTokens(clause).has(token)));
  return relevantClauses.length > 0 && relevantClauses.every(hasAffirmativeProtectedBehaviorDenial);
}

function hasAffirmativeProtectedBehaviorDenial(clause: string): boolean {
  if (!PROTECTED_BEHAVIOR_DENIAL_PATTERN.test(clause)) return false;
  return ![...clause.matchAll(NEGATIVE_SCOPE_PREDICATE_PATTERN)].some(
    (match) => match[1] !== undefined && DENIAL_PREDICATE_PATTERN.test(match[1]),
  );
}

function negativeSemanticBoundaries(value: string): string[] {
  return [...value.matchAll(NEGATIVE_SEMANTIC_BOUNDARY_PATTERN)].map((match) =>
    match[0].toLowerCase().replace(/\s+/gu, " "),
  );
}

function propositionTokens(value: string): Set<string> {
  const boundaries = new Set(negativeSemanticBoundaries(value).flatMap((boundary) => boundary.split(" ")));
  return new Set(
    (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((token) => !PROPOSITION_STOP_WORDS.has(token) && !boundaries.has(token))
      .map(predicateRoot)
      .filter((token) => token.length > 1 && !PROPOSITION_STOP_WORDS.has(token)),
  );
}

function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function predicateRoot(value: string): string {
  const normalized = value.toLowerCase();
  const withoutSuffix = normalized.endsWith("ing")
    ? normalized.slice(0, -3)
    : normalized.endsWith("ed")
      ? normalized.slice(0, -2)
      : normalized.endsWith("s") && !/(?:ews|ies|is|ss|us)$/u.test(normalized)
        ? normalized.slice(0, -1)
        : normalized;
  return withoutSuffix.length > 4 && withoutSuffix.endsWith("e") ? withoutSuffix.slice(0, -1) : withoutSuffix;
}

export function completeIntroductionClauseIds(
  sourceClauses: readonly RequirementSourceClause[],
  validRequirementClauseIds: ReadonlySet<string>,
): Set<string> {
  const childrenByIntroduction = new Map<string, string[]>();
  for (const clause of sourceClauses) {
    if (!clause.introducedByClauseId) continue;
    const children = childrenByIntroduction.get(clause.introducedByClauseId) ?? [];
    children.push(clause.id);
    childrenByIntroduction.set(clause.introducedByClauseId, children);
  }
  const covered = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [introductionId, childIds] of childrenByIntroduction) {
      if (covered.has(introductionId)) continue;
      if (!childIds.every((childId) => validRequirementClauseIds.has(childId) || covered.has(childId))) continue;
      covered.add(introductionId);
      changed = true;
    }
  }
  return covered;
}

function directChildrenByIntroduction(sourceClauses: readonly RequirementSourceClause[]): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const clause of sourceClauses) {
    if (!clause.introducedByClauseId) continue;
    const directChildren = children.get(clause.introducedByClauseId) ?? [];
    directChildren.push(clause.id);
    children.set(clause.introducedByClauseId, directChildren);
  }
  return children;
}

function terminalDescendantIds(clauseId: string, childrenByIntroduction: ReadonlyMap<string, string[]>): string[] {
  const children = childrenByIntroduction.get(clauseId);
  return children && children.length > 0
    ? children.flatMap((childId) => terminalDescendantIds(childId, childrenByIntroduction))
    : [clauseId];
}

function inheritedConstraints(value: string): Set<string> {
  return new Set(
    [...value.matchAll(INHERITED_CONSTRAINT_PATTERN)].map((match) => match[0].toLowerCase().replace(/\s+/gu, " ")),
  );
}
