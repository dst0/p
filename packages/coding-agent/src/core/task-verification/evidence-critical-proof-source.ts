import { requirementSourceClauseCatalog } from "./requirement-source-clauses.ts";

const NEWLINE_TERMINATED_PATTERN =
  /\bnewline[-\s]?terminat\w*\b|\bends?\s+with\s+(?:(?:exactly|precisely)\s+)?(?:(?:a|one|1)\s+)?(?:final\s+|terminal\s+)?(?:lf|newline)(?:\s+bytes?)?\b/iu;
const UNIVERSAL_TRUNCATION_SCOPE_PATTERN =
  /\b(?:any|all|every)\s+(?:\w+\s+){0,3}truncat\w*\b|\btruncat\w*\b[^.\n]{0,80}\b(?:always|must|should|shall|universally)\b/iu;
const FINAL_BOUNDARY_PATTERN = /\b(?:final|terminal)\s+(?:lf|newline)(?:\s+bytes?)?\b/iu;
const NEGATED_REJECTION_PREFIX_PATTERN =
  /\b(?:(?:(?:do|does|did|is|are|was|were|will|would|should|must|shall|may|might|can|could|need)\s+not|never|without|(?:there\s+is\s+)?no\s+requirement\s+to)\s+(?:be\s+)?|it\s+is\s+false\s+that\b[^.\n]{0,48})$/iu;
const CONTRAST_BOUNDARY_PATTERN = /\b(?:but|however|whereas|while)\b/giu;
const REJECTION_ACTION_PATTERN = /\b(?:reject|fail|throw)\w*\b/giu;
const ACCEPTANCE_ACTION_PATTERN = /\b(?:accept|allow|permit)\w*\b/giu;
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
  const newlineSerializationClauses = clauses.filter(
    (clause) =>
      NEWLINE_TERMINATED_PATTERN.test(clause.text) &&
      (SERIALIZATION_PATTERN.test(clause.text) || artifactDomains(clause.text).length > 0),
  );
  const serializationDomains = new Set(newlineSerializationClauses.flatMap((clause) => artifactDomains(clause.text)));
  const genericSerializationClauses = newlineSerializationClauses.filter(
    (clause) => SERIALIZATION_PATTERN.test(clause.text) && artifactDomains(clause.text).length === 0,
  );
  for (const clause of genericSerializationClauses) {
    if (SERIALIZATION_PATTERN.test(clause.text)) {
      for (const token of genericArtifactTokens(clause.text)) genericSerializationTokens.add(token);
    }
  }
  if (serializationDomains.size === 0 && genericSerializationClauses.length === 0) return [];
  const matched = new Set<string>();
  for (const clause of clauses) {
    const rejectsUniversalTruncation = hasPositiveUniversalTruncationRejection(clause.text);
    const rejectsExplicitFinalBoundary = hasExplicitFinalBoundaryRejection(clause.text);
    if (!rejectsUniversalTruncation && !rejectsExplicitFinalBoundary) continue;
    const directDomains = rejectsExplicitFinalBoundary
      ? explicitFinalBoundaryDomains(clause.text)
      : artifactDomains(clause.text);
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
    if (rejectsExplicitFinalBoundary && directDomains.length === 0) {
      if (serializationDomains.size === 1) matched.add([...serializationDomains][0]!);
      if (serializationDomains.size === 0 && genericSerializationClauses.length === 1) {
        matched.add(GENERIC_SERIALIZED_ARTIFACT_DOMAIN);
      }
    }
  }
  return [...matched].sort();
}

function explicitFinalBoundaryDomains(value: string): string[] {
  const referenceIndex = explicitFinalBoundaryReference(value);
  if (referenceIndex === undefined) return [];
  let rejectionStart = 0;
  let rejectionEnd = 0;
  for (const action of value.matchAll(/\b(?:reject|fail|throw)\w*\b/giu)) {
    if (action.index === undefined || action.index >= referenceIndex) break;
    rejectionStart = action.index;
    rejectionEnd = action.index + action[0].length;
  }
  const subject = rejectionEnd > 0 ? value.slice(0, rejectionStart) : "";
  let localStart = rejectionEnd;
  for (const delimiter of value.slice(rejectionEnd, referenceIndex).matchAll(/[,;]|\b(?:and|but)\b/giu)) {
    if (delimiter.index !== undefined) localStart = rejectionEnd + delimiter.index + delimiter[0].length;
  }
  return artifactDomains(`${subject} ${value.slice(localStart)}`);
}

function hasExplicitFinalBoundaryRejection(value: string): boolean {
  const referenceIndex = explicitFinalBoundaryReference(value);
  if (referenceIndex === undefined) return false;
  return hasPositiveRejectionNear(value, referenceIndex);
}

function hasPositiveUniversalTruncationRejection(value: string): boolean {
  const scope = UNIVERSAL_TRUNCATION_SCOPE_PATTERN.exec(value);
  return scope?.index !== undefined && hasPositiveRejectionNear(value, scope.index);
}

function hasPositiveRejectionNear(value: string, referenceIndex: number): boolean {
  const segment = contrastSegmentAt(value, referenceIndex);
  const rejectionDistance = nearestActionDistance(
    segment.text,
    segment.referenceIndex,
    REJECTION_ACTION_PATTERN,
    false,
  );
  const acceptanceDistance = nearestActionDistance(
    segment.text,
    segment.referenceIndex,
    ACCEPTANCE_ACTION_PATTERN,
    false,
  );
  const negatedRejectionDistance = nearestActionDistance(
    segment.text,
    segment.referenceIndex,
    REJECTION_ACTION_PATTERN,
    true,
  );
  const opposingDistance = minimumDefinedDistance(acceptanceDistance, negatedRejectionDistance);
  return (
    rejectionDistance !== undefined &&
    rejectionDistance <= 180 &&
    (opposingDistance === undefined || rejectionDistance < opposingDistance)
  );
}

function contrastSegmentAt(value: string, referenceIndex: number): { text: string; referenceIndex: number } {
  let start = 0;
  let end = value.length;
  for (const boundary of value.matchAll(CONTRAST_BOUNDARY_PATTERN)) {
    if (boundary.index === undefined) continue;
    if (boundary.index < referenceIndex) start = boundary.index + boundary[0].length;
    else {
      end = boundary.index;
      break;
    }
  }
  return { text: value.slice(start, end), referenceIndex: referenceIndex - start };
}

function nearestActionDistance(
  value: string,
  referenceIndex: number,
  pattern: RegExp,
  requireNegated: boolean,
): number | undefined {
  let nearest: number | undefined;
  for (const action of value.matchAll(pattern)) {
    if (action.index === undefined) continue;
    const prefix = value.slice(Math.max(0, action.index - 48), action.index);
    if (NEGATED_REJECTION_PREFIX_PATTERN.test(prefix) !== requireNegated) continue;
    const distance = Math.abs(action.index - referenceIndex);
    if (nearest === undefined || distance < nearest) nearest = distance;
  }
  return nearest;
}

function minimumDefinedDistance(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

function explicitFinalBoundaryReference(value: string): number | undefined {
  const finalBoundary = FINAL_BOUNDARY_PATTERN.exec(value);
  if (!finalBoundary || finalBoundary.index === undefined) return undefined;
  let nearestIndex: number | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const reference of value.matchAll(/\b(?:remov(?:al|e|ing)|missing)\b/giu)) {
    if (reference.index === undefined) continue;
    const distance = Math.abs(reference.index - finalBoundary.index);
    if (distance > 60 || distance >= nearestDistance) continue;
    nearestIndex = reference.index;
    nearestDistance = distance;
  }
  return nearestIndex === undefined ? undefined : Math.min(finalBoundary.index, nearestIndex);
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
