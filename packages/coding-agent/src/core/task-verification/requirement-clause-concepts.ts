const CRITICAL_CONCEPTS = [
  { name: "command ID", pattern: /\bcommand[-\s]?ids?\b/iu },
  { name: "idempotency record", pattern: /\bidempoten\w*\b/iu },
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

export function requirementClauseConceptNames(value: string): string[] {
  return CRITICAL_CONCEPTS.filter((concept) => concept.pattern.test(value)).map((concept) => concept.name);
}

export function uncoveredRequirementClauseConceptNames(source: string, mappedRequirements: string): string[] {
  return CRITICAL_CONCEPTS.filter(
    (concept) => concept.pattern.test(source) && !concept.pattern.test(mappedRequirements),
  ).map((concept) => concept.name);
}
