import type { RequirementSourceClause } from "./requirement-source-clauses.ts";
import {
  requirementClauseConceptNames,
  uncoveredRequirementClauseConceptNames,
} from "./requirement-clause-concepts.ts";

const NORMATIVE_PATTERN =
  /\b(?:all|always|any|are|cannot|contains?|every|exactly|export|fail|has|have|is|must|never|no|only|preserve|reject|render|required?|requires?|returns?|shall|should|starts?|throw|validate|write)\b/iu;
const EXAMPLE_PATTERN = /\b(?:e\.g\.|example|for example|illustrat\w*|sample)\b/iu;
const INFORMATIONAL_PATTERN =
  /^(?:background|context|overview)(?:\s+(?:context|information|material))?[.:]?\s*$|\b(?:are|is)\s+(?:below|the following)\b|\b(?:details?|information|material|paragraph|section|text)\s+(?:are|is)\s+(?:background|context|overview)(?:\s+(?:context|information|material))?\b/iu;
const CONFLICT_PATTERN =
  /\b(?:but|do\s+not|don't|dont|instead|no\s+longer|not|override|rather\s+than|replace|supersed)\b/iu;
const EXPLICIT_REPLACEMENT_PATTERN =
  /\b(?:instead\s+of|override|rather\s+than|replace\w*(?:\s+\w+){0,4}\s+with|supersed\w*|switch\w*(?:\s+\w+){0,4}\s+from)\b/iu;
const REJECT_PATTERN = /\b(?:block\w*|den(?:y|ies|ied|ying)|fail\w*|reject\w*|throw\w*)\b/iu;
const ACCEPT_PATTERN = /\b(?:accept\w*|allow\w*|permit\w*)\b/iu;
const PRESERVE_PATTERN = /\b(?:include\w*|keep\w*|preserv\w*|retain\w*|same|unchanged)\b|\bend\w*\s+with\b/iu;
const REMOVE_PATTERN = /\b(?:different|discard\w*|drop\w*|missing|new|omit\w*|remov\w*|replac\w*|without)\b/iu;
const REQUIRE_PATTERN = /\b(?:must|need\w*|requir\w*|shall)\b/iu;
const OPTIONAL_PATTERN = /\b(?:may|optional|optionally)\b/iu;
const NEGATED_REJECT_PATTERN =
  /\b(?:do\s+not|don't|dont|never|no\s+longer|not\s+to)\s+(?:\w+\s+){0,2}(?:block|deny|fail|reject|throw)\w*\b/iu;
const NEGATED_ACCEPT_PATTERN =
  /\b(?:do\s+not|don't|dont|never|no\s+longer|not\s+to)\s+(?:\w+\s+){0,2}(?:accept|allow|permit)\w*\b/iu;
const NEGATED_PRESERVE_PATTERN =
  /\b(?:do\s+not|don't|dont|never|no\s+longer|not\s+to)\s+(?:\w+\s+){0,2}(?:include|keep|preserve|retain)\w*\b/iu;
const NEGATED_REMOVE_PATTERN =
  /\b(?:do\s+not|don't|dont|never|no\s+longer|not\s+to)\s+(?:\w+\s+){0,2}(?:discard|drop|omit|remove|replace)\w*\b/iu;
const NEGATED_REQUIRE_PATTERN =
  /\b(?:do\s+not|don't|dont|never|no\s+longer|not\s+to)\s+(?:\w+\s+){0,2}(?:need|require)\w*\b/iu;
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
  if (hasPolarityConflict(clause.text, requirement)) {
    return `Source clause ${clause.id} has behavioral polarity that the mapped requirement reverses.`;
  }
  if (!preservesPrimaryIdentifier(clause.text, requirement)) {
    return `Source clause ${clause.id} does not semantically support the mapped requirement.`;
  }
  if (!preservesMappedCommandIdentity(clause.text, requirement)) {
    return `Source clause ${clause.id} does not semantically support the mapped requirement.`;
  }
  const clauseTokens = semanticTokens(clause.text, true);
  const requirementTokens = semanticTokens(requirement, true);
  const overlap = [...clauseTokens].filter((token) => requirementTokens.has(token)).length;
  const comparisonSize = Math.min(clauseTokens.size, requirementTokens.size);
  const minimum = Math.min(2, comparisonSize);
  const enoughConcepts =
    clauseTokens.size === 0 || (comparisonSize > 0 && overlap >= minimum && overlap / comparisonSize >= 0.4);
  if (!enoughConcepts) {
    return `Source clause ${clause.id} does not semantically support the mapped requirement.`;
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
  return missing.length > 0
    ? `Source clause ${clause.id} has uncovered normative concepts: ${missing.join(", ")}. Map each missing concept with source-exact wording in a separate atomic requirement when it is independently observable.`
    : undefined;
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
  const promptPolarity = behaviorPolarity(directPrompt);
  const clausePolarity = behaviorPolarity(clause.text);
  if (polaritiesConflict(promptPolarity, clausePolarity)) return true;
  if (polaritiesAgree(promptPolarity, clausePolarity)) return false;
  return (
    EXPLICIT_REPLACEMENT_PATTERN.test(directPrompt) &&
    [...promptTokens].some((token) => !clauseTokens.has(token) && !["instead", "override", "rather"].includes(token))
  );
}

interface BehaviorPolarity {
  reject: boolean;
  accept: boolean;
  preserve: boolean;
  remove: boolean;
  require: boolean;
  optional: boolean;
}

function hasPolarityConflict(left: string, right: string): boolean {
  return polaritiesConflict(behaviorPolarity(left), behaviorPolarity(right));
}

function behaviorPolarity(value: string): BehaviorPolarity {
  const negatedReject = NEGATED_REJECT_PATTERN.test(value);
  const negatedAccept = NEGATED_ACCEPT_PATTERN.test(value);
  const negatedPreserve = NEGATED_PRESERVE_PATTERN.test(value);
  const negatedRemove = NEGATED_REMOVE_PATTERN.test(value);
  const negatedRequire = NEGATED_REQUIRE_PATTERN.test(value);
  return {
    reject: negatedAccept || (REJECT_PATTERN.test(value) && !negatedReject),
    accept: negatedReject || (ACCEPT_PATTERN.test(value) && !negatedAccept),
    preserve: negatedRemove || (PRESERVE_PATTERN.test(value) && !negatedPreserve),
    remove: negatedPreserve || (REMOVE_PATTERN.test(value) && !negatedRemove),
    require: REQUIRE_PATTERN.test(value) && !negatedRequire,
    optional: negatedRequire || OPTIONAL_PATTERN.test(value),
  };
}

function polaritiesConflict(left: BehaviorPolarity, right: BehaviorPolarity): boolean {
  return (
    polarityPairConflicts(left, right, "reject", "accept") ||
    polarityPairConflicts(left, right, "preserve", "remove") ||
    polarityPairConflicts(left, right, "require", "optional")
  );
}

function polarityPairConflicts(
  left: BehaviorPolarity,
  right: BehaviorPolarity,
  positive: keyof BehaviorPolarity,
  negative: keyof BehaviorPolarity,
): boolean {
  return (
    (left[positive] && !left[negative] && right[negative] && !right[positive]) ||
    (left[negative] && !left[positive] && right[positive] && !right[negative])
  );
}

function polaritiesAgree(left: BehaviorPolarity, right: BehaviorPolarity): boolean {
  return (Object.keys(left) as Array<keyof BehaviorPolarity>).some((key) => left[key] && right[key]);
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
