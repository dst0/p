interface CriticalConcept {
  name: string;
  occurs: (value: string) => boolean;
}

function regexConcept(name: string, pattern: RegExp): CriticalConcept {
  return { name, occurs: (value) => pattern.test(value) };
}

const CRITICAL_CONCEPTS: CriticalConcept[] = [
  regexConcept("command ID", /\bcommand[-\s]?ids?\b/iu),
  regexConcept("idempotency record", /\bidempoten\w*\b/iu),
  regexConcept("state", /\bstate\b/iu),
  { name: "event log", occurs: eventLogOccurs },
  regexConcept("version", /\bversions?\b/iu),
  regexConcept("position", /\bpositions?\b/iu),
  regexConcept("hash", /\bhash(?:es|ed|ing)?\b/iu),
  regexConcept("manifest", /\bmanifest\b/iu),
  regexConcept("lease fencing", /\b(?:fenc\w*|leases?|tokens?)\b/iu),
  regexConcept("retry", /\b(?:attempts?|backoff|retr(?:y|ies|ied|ying))\b/iu),
  regexConcept("compensation", /\bcompensat\w*\b/iu),
  regexConcept("time", /\b(?:clock|time|timing)\b/iu),
  regexConcept("deep copy", /\bdeep[-\s]+cop(?:y|ies)\b/iu),
  regexConcept("transition", /\btransitions?\b/iu),
  { name: "dependency graph", occurs: dependencyGraphOccurs },
  regexConcept("truncation", /\btruncat\w*\b/iu),
  regexConcept("tampering", /\b(?:corrupt\w*|tamper\w*)\b/iu),
];

export function requirementClauseConceptNames(value: string): string[] {
  return CRITICAL_CONCEPTS.filter((concept) => concept.occurs(value)).map((concept) => concept.name);
}

export function uncoveredRequirementClauseConceptNames(source: string, mappedRequirements: string): string[] {
  return CRITICAL_CONCEPTS.filter((concept) => concept.occurs(source) && !concept.occurs(mappedRequirements)).map(
    (concept) => concept.name,
  );
}

function eventLogOccurs(value: string): boolean {
  if (/\bevent[-\s]?logs?\b/iu.test(value)) return true;
  return [...value.matchAll(/\b(?:history|logs?)\b/giu)].some(
    (match) => match.index !== undefined && !isPathTokenOccurrence(value, match.index, match[0].length),
  );
}

function dependencyGraphOccurs(value: string): boolean {
  if (
    /\b(?:dependenc(?:y|ies)[-\s]+(?:graphs?|dags?|cycles?|order(?:ed|ing)?)|self[-\s]?dependencies|dependsOn|cycles?\s+(?:in|among)\s+dependencies|dependencies\s+(?:(?:must|should)\s+)?(?:be|are|remain)\s+(?:a?cyclic|cycle[-\s]?free)|(?:all\s+)?dependencies\s+(?:succeed|complete|are\s+satisfied)|(?:missing|unknown)\s+dependencies|topological(?:ly)?\s+(?:order(?:ed|ing)?\s+)?dependencies)\b/iu.test(
      value,
    )
  ) {
    return true;
  }
  return [...value.matchAll(/\bdags?\b/giu)].some(
    (match) => match.index !== undefined && !isPathTokenOccurrence(value, match.index, match[0].length),
  );
}

function isPathTokenOccurrence(value: string, matchStart: number, matchLength: number): boolean {
  let start = matchStart;
  let end = matchStart + matchLength;
  while (start > 0 && /[\p{L}\p{N}._~@%+:/-]/u.test(value[start - 1]!)) start -= 1;
  while (end < value.length && /[\p{L}\p{N}._~@%+:/-]/u.test(value[end]!)) end += 1;
  const token = value.slice(start, end).replace(/[.:]+$/u, "");
  return token.includes("/") || token.includes("\\") || /\.[\p{L}\p{N}]{1,10}$/u.test(token);
}
