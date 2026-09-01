import { requirementSourceClauseCatalog } from "./requirement-source-clauses.ts";

const NEWLINE_TERMINATED_PATTERN = /\bnewline[-\s]?terminat\w*\b|\bends?\s+with\s+(?:a\s+)?(?:lf|newline)\b/iu;
const UNIVERSAL_TRUNCATION_PATTERN =
  /\b(?:any|all|every)\s+(?:\w+\s+){0,3}truncat\w*\b|\btruncat\w*\b[^.\n]{0,80}\b(?:always|must|universally)\b[^.\n]{0,40}\b(?:reject|fail|throw)\w*\b/iu;
const SERIALIZATION_PATTERN = /\b(?:export\w*|jsonl|logs?|manifests?|records?|seriali[sz]\w*)\b/iu;
const STRONG_EVENT_LOG_PATTERN = /\b(?:exportlog|fromlog|jsonl|event[-\s]+logs?)\b/iu;
const GENERIC_SERIALIZED_ARTIFACT_DOMAIN = "serialized-artifact";
const GENERIC_ARTIFACT_TOKEN_EXCLUSION =
  /^(?:all|always|an|and|any|are|artifact|be|byte|bytes|content|data|document|end|ending|ends|every|export|exported|exports|extra|fail|fails|file|files|final|format|from|input|is|last|lf|missing|must|newline|of|or|output|reject|rejected|rejects|remove|removed|removing|serialize|serialized|serializes|serialization|should|terminal|the|throw|throws|to|truncated|truncates|truncation|universally|with|without)$/iu;
const ARTIFACT_DOMAINS = [
  { id: "event-log", pattern: /\b(?:exportlog|fromlog|jsonl|logs?)\b/iu },
  { id: "manifest", pattern: /\bmanifests?\b/iu },
  { id: "record", pattern: /\b(?:payloads?|records?)\b/iu },
  { id: "transaction", pattern: /\btransactions?\b/iu },
  { id: "journal", pattern: /\bjournals?\b/iu },
  { id: "stream", pattern: /\bstreams?\b/iu },
  { id: "history", pattern: /\bhistor(?:y|ies)\b/iu },
  { id: "packet", pattern: /\bpackets?\b/iu },
  { id: "image", pattern: /\b(?:images?|media|pictures?)\b/iu },
  { id: "trace", pattern: /\btraces?\b/iu },
  { id: "entry", pattern: /\bentr(?:y|ies)\b/iu },
] as const;

export function sourceRequiresExactFinalByteProof(text: string): boolean {
  return exactFinalByteProofDomains(text).length > 0;
}

export function exactFinalByteProofDomains(text: string): string[] {
  const clauses = requirementSourceClauseCatalog([{ id: "evidence-source", text, kind: "referenced_file" }]);
  const genericSerializationTokens = new Set<string>();
  const serializationDomains = new Set(
    clauses
      .filter(
        (clause) =>
          NEWLINE_TERMINATED_PATTERN.test(clause.text) &&
          (SERIALIZATION_PATTERN.test(clause.text) || artifactDomains(clause.text).length > 0),
      )
      .flatMap((clause) => artifactDomains(clause.text)),
  );
  for (const clause of clauses) {
    if (
      NEWLINE_TERMINATED_PATTERN.test(clause.text) &&
      SERIALIZATION_PATTERN.test(clause.text) &&
      artifactDomains(clause.text).length === 0
    ) {
      for (const token of genericArtifactTokens(clause.text)) genericSerializationTokens.add(token);
    }
  }
  if (serializationDomains.size === 0 && genericSerializationTokens.size === 0) return [];
  const matched = new Set<string>();
  for (const clause of clauses) {
    if (!UNIVERSAL_TRUNCATION_PATTERN.test(clause.text)) continue;
    const directDomains = artifactDomains(clause.text);
    const truncationDomains =
      directDomains.length > 0
        ? directDomains
        : artifactDomains(
            clauses
              .filter((candidate) => candidate.line === clause.line && candidate.part <= clause.part)
              .map((candidate) => candidate.text)
              .join(" "),
          );
    for (const domain of truncationDomains) {
      if (serializationDomains.has(domain)) matched.add(domain);
    }
    if (
      directDomains.length === 0 &&
      genericArtifactTokens(clause.text).some((token) => genericSerializationTokens.has(token))
    ) {
      matched.add(GENERIC_SERIALIZED_ARTIFACT_DOMAIN);
    }
  }
  return [...matched].sort();
}

function genericArtifactTokens(value: string): string[] {
  return [
    ...new Set(
      (value.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []).filter(
        (token) => token.length >= 3 && !GENERIC_ARTIFACT_TOKEN_EXCLUSION.test(token),
      ),
    ),
  ];
}

function artifactDomains(value: string): string[] {
  if (STRONG_EVENT_LOG_PATTERN.test(value)) return ["event-log"];
  const matched = ARTIFACT_DOMAINS.flatMap(({ id, pattern }) => (pattern.test(value) ? [id] : []));
  const specific = matched.filter((id) => id !== "event-log");
  return specific.length > 0 ? specific : matched;
}
