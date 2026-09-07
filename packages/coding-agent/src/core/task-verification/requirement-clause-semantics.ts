import {
  requirementClauseConceptNames,
  uncoveredRequirementClauseConceptNames,
} from "./requirement-clause-concepts.ts";
import {
  behavioralPolaritiesAgree,
  behavioralPolaritiesConflict,
  retainsRequiredBehaviorPolarity,
} from "./requirement-clause-polarity.ts";
import type { RequirementSourceClause } from "./requirement-source-clauses.ts";

const NORMATIVE_PATTERN =
  /\b(?:all|always|any|are|cannot|contains?|every|exactly|export|fail|has|have|is|must|never|no|only|preserve|reject|render|required?|requires?|returns?|shall|should|starts?|throw|validate|write)\b/iu;
const EXAMPLE_PATTERN = /\b(?:e\.g\.|example|for example|illustrat\w*|sample)\b/iu;
const INFORMATIONAL_PATTERN =
  /^(?:background|context|overview)(?:\s+(?:context|information|material))?[.:]?\s*$|\b(?:are|is)\s+(?:below|the following)\b|\b(?:details?|information|material|paragraph|section|text)\s+(?:are|is)\s+(?:background|context|overview)(?:\s+(?:context|information|material))?\b/iu;
const CONFLICT_PATTERN =
  /\b(?:but|do\s+not|don't|dont|instead|no\s+longer|not|override|rather\s+than|replace|supersed)\b/iu;
const EXPLICIT_REPLACEMENT_PATTERN =
  /\b(?:instead\s+of|override|rather\s+than|replace\w*(?:\s+\w+){0,4}\s+with|supersed\w*|switch\w*(?:\s+\w+){0,4}\s+from)\b/iu;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "the",
  "their",
  "this",
  "to",
  "with",
]);

export function isNormativeSourceClause(clause: RequirementSourceClause): boolean {
  if (clause.kind === "heading") return false;
  if (INFORMATIONAL_PATTERN.test(clause.text)) return false;
  return clause.normativeHint === true || NORMATIVE_PATTERN.test(clause.text) || startsWithImperative(clause.text);
}

export function ignoredClauseClassificationError(
  clause: RequirementSourceClause,
  classification: "informational" | "example" | "superseded" | "unsafe_instruction",
): string | undefined {
  if (classification === "informational") {
    if (clause.kind === "heading" || INFORMATIONAL_PATTERN.test(clause.text)) return undefined;
    return isNormativeSourceClause(clause)
      ? `Source clause ${clause.id} is normative and cannot be ignored as informational.`
      : `Source clause ${clause.id} is not structurally informational.`;
  }
  if (classification === "example") {
    if (clause.kind === "code" || EXAMPLE_PATTERN.test(clause.text)) return undefined;
    return isNormativeSourceClause(clause)
      ? `Source clause ${clause.id} is normative and cannot be ignored as example.`
      : `Source clause ${clause.id} is not structurally an example.`;
  }
  return undefined;
}

export function clauseRequirementRelevanceError(
  clause: RequirementSourceClause,
  requirementText: string,
  acceptanceCriterion: string,
): string | undefined {
  const requirement = `${requirementText}\n${acceptanceCriterion}`;
  if (!preservesPrimaryIdentifier(clause.text, requirement)) {
    return `Source clause ${clause.id} does not semantically support the mapped requirement.`;
  }
  if (!preservesMappedCommandIdentity(clause.text, requirement)) {
    return `Source clause ${clause.id} does not semantically support the mapped requirement.`;
  }
  if (!hasEnoughSemanticOverlap(clause.text, requirement)) {
    return `Source clause ${clause.id} does not semantically support the mapped requirement.`;
  }
  const relatedParts = [requirementText, acceptanceCriterion].filter((part) =>
    hasEnoughSemanticOverlap(clause.text, part),
  );
  if (relatedParts.some((part) => behavioralPolaritiesConflict(clause.text, part))) {
    return `Source clause ${clause.id} has behavioral polarity that the mapped requirement reverses.`;
  }
  if (behavioralPolaritiesConflict(clause.text, requirement)) {
    return `Source clause ${clause.id} has behavioral polarity that the mapped requirement reverses.`;
  }
  return undefined;
}

export function sourceClauseConceptCoverageError(
  clause: RequirementSourceClause,
  mappedRequirementTexts: readonly string[],
): string | undefined {
  if (!isNormativeSourceClause(clause)) return undefined;
  const aggregate = mappedRequirementTexts.join("\n");
  const missing = uncoveredRequirementClauseConceptNames(clause.text, aggregate);
  if (missing.length > 0) {
    return `Source clause ${clause.id} has uncovered normative concepts: ${missing.join(", ")}. Map each missing concept with source-exact wording in a separate atomic requirement when it is independently observable.`;
  }
  const relatedMappings = mappedRequirementTexts.filter((mapping) => hasEnoughSemanticOverlap(clause.text, mapping));
  return retainsRequiredBehaviorPolarity(clause.text, relatedMappings)
    ? undefined
    : `Source clause ${clause.id} has behavioral polarity that the mapped requirements omit.`;
}

export function sourceClauseRequiredConcepts(clause: RequirementSourceClause): string[] {
  return isNormativeSourceClause(clause) ? requirementClauseConceptNames(clause.text) : [];
}

export function directPromptSupersedesClause(directPrompt: string, clause: RequirementSourceClause): boolean {
  if (!CONFLICT_PATTERN.test(directPrompt)) return false;
  const promptTokens = semanticTokens(directPrompt);
  const clauseTokens = semanticTokens(clause.text);
  const overlap = [...clauseTokens].filter((token) => promptTokens.has(token)).length;
  if (overlap < Math.min(2, clauseTokens.size)) return false;
  if (behavioralPolaritiesConflict(directPrompt, clause.text)) return true;
  if (behavioralPolaritiesAgree(directPrompt, clause.text)) return false;
  return (
    EXPLICIT_REPLACEMENT_PATTERN.test(directPrompt) &&
    [...promptTokens].some((token) => !clauseTokens.has(token) && !["instead", "override", "rather"].includes(token))
  );
}

function hasEnoughSemanticOverlap(left: string, right: string): boolean {
  const leftTokens = semanticTokens(left, true);
  const rightTokens = semanticTokens(right, true);
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const comparisonSize = Math.min(leftTokens.size, rightTokens.size);
  const minimum = Math.min(2, comparisonSize);
  return leftTokens.size === 0 || (comparisonSize > 0 && overlap >= minimum && overlap / comparisonSize >= 0.4);
}

function startsWithImperative(value: string): boolean {
  return /^(?:(?:do\s+not|don't|never)\s+|add|allow|apply|avoid|create|delete|disable|emit|enable|ensure|export|implement|keep|persist|preserve|prevent|record|reject|remove|render|require|return|store|support|throw|use|validate|write)\b/iu.test(
    value.trim(),
  );
}

function semanticTokens(value: string, splitIdentifierBoundaries = false): Set<string> {
  const tokenizable = splitIdentifierBoundaries ? withIdentifierBoundaries(value) : value;
  const tokens = tokenizable.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(tokens.map(normalizeToken).filter((token) => token.length >= 3 && !STOP_WORDS.has(token)));
}

function preservesPrimaryIdentifier(clause: string, requirement: string): boolean {
  const requirementTokens = new Set(
    (
      withIdentifierBoundaries(requirement)
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? []
    ).map(normalizeToken),
  );
  const identifier = primaryIdentifierParts(clause);
  return !identifier || identifier.map(normalizeToken).every((part) => requirementTokens.has(part));
}

function preservesMappedCommandIdentity(clause: string, requirement: string): boolean {
  const commands = [...clause.matchAll(/`([^`\r\n]+)`/gu)]
    .map((match) => match[1]!.trim())
    .filter((candidate) => /^(?:bun|cargo|go|node|npm|pnpm|yarn)\s+\S/iu.test(candidate))
    .map(normalizeCommandIdentity);
  if (commands.length === 0) return true;
  const normalizedRequirement = normalizeCommandIdentity(requirement);
  return commands.some((command) => normalizedRequirement.includes(command));
}

function normalizeCommandIdentity(value: string): string {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
}

function primaryIdentifierParts(value: string): string[] | undefined {
  for (const match of value.matchAll(/`([^`\r\n]+)`/gu)) {
    const candidate = match[1]!;
    if (/^[_\p{L}][-_\p{L}\p{N}]*$/u.test(candidate)) return identifierParts(candidate);
  }
  for (const token of value.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const parts = identifierParts(token);
    if (parts.length > 1) return parts;
  }
  return undefined;
}

function identifierParts(value: string): string[] {
  return (
    withIdentifierBoundaries(value)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function withIdentifierBoundaries(value: string): string {
  return value
    .replace(/\b(\p{Lu}{2,})s\b/gu, "$1")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2");
}

function normalizeToken(token: string): string {
  const aliases: Record<string, string> = {
    chars: "character",
    characters: "character",
    final: "terminal",
    last: "terminal",
    logs: "log",
    missing: "remove",
    removal: "remove",
    removes: "remove",
    removed: "remove",
    renderer: "render",
    rendered: "render",
    throws: "throw",
    truncated: "truncate",
    truncation: "truncate",
  };
  if (aliases[token]) return aliases[token]!;
  if (token.endsWith("ies") && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ing") && token.length > 6) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 4) return token.slice(0, -1);
  return token;
}
