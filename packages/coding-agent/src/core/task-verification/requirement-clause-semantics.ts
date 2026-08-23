import type { RequirementSourceClause } from "./requirement-source-clauses.ts";

const NORMATIVE_PATTERN =
  /\b(?:all|always|any|are|cannot|contains?|every|exactly|export|fail|has|have|is|must|never|no|only|preserve|reject|render|required?|requires?|returns?|shall|should|starts?|throw|validate|write)\b/iu;
const EXAMPLE_PATTERN = /\b(?:e\.g\.|example|for example|illustrat\w*|sample)\b/iu;
const INFORMATIONAL_PATTERN =
  /^(?:background|context|overview)\s*:?\s*$|\b(?:are|is)\s+(?:below|the following)\b|\b(?:details?|information|material|paragraph|section|text)\s+(?:are|is)\s+(?:background|context|overview)(?:\s+(?:context|information|material))?\b/iu;
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
const CRITICAL_CONCEPTS = [
  { name: "command identity", pattern: /\b(?:command[-\s]?ids?|idempoten\w*)\b/iu },
  { name: "state", pattern: /\bstate\b/iu },
  { name: "event log", pattern: /\b(?:event[-\s]?logs?|history|logs?)\b/iu },
  { name: "version", pattern: /\bversions?\b/iu },
  { name: "position", pattern: /\bpositions?\b/iu },
  { name: "hash", pattern: /\bhash(?:es|ed|ing)?\b/iu },
  { name: "manifest", pattern: /\bmanifest\b/iu },
  { name: "lease fencing", pattern: /\b(?:fenc\w*|leases?|tokens?)\b/iu },
  { name: "retry", pattern: /\b(?:attempts?|backoff|retr(?:y|ies|ied|ying))\b/iu },
  { name: "compensation", pattern: /\bcompensat\w*\b/iu },
  { name: "time", pattern: /\b(?:clock|time|timing)\b/iu },
  { name: "deep copy", pattern: /\bdeep[-\s]+cop(?:y|ies)\b/iu },
  { name: "transition", pattern: /\btransitions?\b/iu },
  { name: "dependency graph", pattern: /\b(?:cycles?|dag|dependencies|dependency)\b/iu },
  { name: "truncation", pattern: /\btruncat\w*\b/iu },
  { name: "tampering", pattern: /\b(?:corrupt\w*|tamper\w*)\b/iu },
] as const;
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
    if (clause.kind === "heading" || !isNormativeSourceClause(clause)) return undefined;
    return `Source clause ${clause.id} is normative and cannot be ignored as informational.`;
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
  const clauseTokens = semanticTokens(clause.text);
  const requirementTokens = semanticTokens(requirement);
  const overlap = [...clauseTokens].filter((token) => requirementTokens.has(token)).length;
  const minimum = Math.min(2, clauseTokens.size);
  const enoughConcepts =
    clauseTokens.size === 0 || (overlap >= minimum && (clauseTokens.size > 8 || overlap / clauseTokens.size >= 0.4));
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
  const missing = CRITICAL_CONCEPTS.find(
    (concept) => concept.pattern.test(clause.text) && !concept.pattern.test(aggregate),
  );
  return missing ? `Source clause ${clause.id} has an uncovered normative concept: ${missing.name}.` : undefined;
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

function semanticTokens(value: string): Set<string> {
  const tokens = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(tokens.map(normalizeToken).filter((token) => token.length >= 3 && !STOP_WORDS.has(token)));
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
