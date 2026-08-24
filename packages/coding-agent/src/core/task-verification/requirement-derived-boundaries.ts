import { requirementSourceClauses } from "./requirement-source-clauses.ts";
import { type RequirementSourceFacet, requirementSourceFacets } from "./requirement-source-facets.ts";
import type { RequirementProofPolicy, TaskRequirement, TaskVerificationSourcePrompt } from "./types.ts";

const NEWLINE_TERMINATED_PATTERN = /\bnewline[-\s]?terminat\w*\b/iu;
const UNIVERSAL_TRUNCATION_PATTERN = /\b(?:any|all|every)\s+(?:\w+\s+){0,3}truncat\w*\b/iu;
const TRUNCATION_PATTERN = /\btruncat\w*\b/iu;
const SERIALIZATION_PATTERN = /\b(?:export\w*|jsonl|logs?|manifests?|records?|seriali[sz]\w*)\b/iu;
const TERMINAL_BOUNDARY_PATTERN =
  /\b(?:(?:exact|final|last|terminal)\s+(?:byte|character|newline)|(?:byte|character|newline)\s+(?:at\s+)?(?:the\s+)?(?:end|final|last|terminal))\b/iu;
const UNIVERSAL_PATTERN = /\b(?:all|any|every)\b/iu;
const ARTIFACT_CHANGE_DOMAINS = new Set([
  "artifact",
  "artifacts",
  "byte",
  "bytes",
  "candidate",
  "candidates",
  "data",
  "file",
  "files",
  "log",
  "logs",
  "manifest",
  "manifests",
  "metadata",
  "packet",
  "packets",
  "payload",
  "payloads",
  "record",
  "records",
  "stream",
  "streams",
]);
const ARTIFACT_CHANGE_PREFIXES = ["alter", "chang", "modif", "mutat"] as const;
const PROOF_HANDLER_PREFIXES = [
  "accept",
  "block",
  "check",
  "detect",
  "deny",
  "flag",
  "handle",
  "invalid",
  "quarantin",
  "refus",
  "reject",
  "report",
  "return",
  "skip",
  "throw",
  "validat",
] as const;
const PROOF_OUTCOME_PREFIXES = [...PROOF_HANDLER_PREFIXES, "differ", "fail"] as const;
const PROOF_INTENT_BOUNDARIES = new Set(["and", "before", "but", "or", "without"]);
const FORWARD_PROOF_INTENT_BOUNDARIES = new Set(["after", "if", "unless", "when", "while"]);
const GOVERNED_ARTIFACT_CHANGE_NOUN_PATTERN =
  /\b(?:avoid|prevent)\s+(?:the\s+)?(?:(?:artifacts?|buffers?|bytes?|data|files?|inputs?|logs?|manifests?|metadata|outputs?|packets?|payloads?|records?|state|streams?|values?)\s+)?(?:alteration|change|corruption|modification|mutation|tampering)(?:\s*,?\s*(?:and|nor|or)\s+(?:alteration|change|corruption|modification|mutation|tampering))*(?:\s+of\s+(?:the\s+)?(?:artifacts?|buffers?|bytes?|data|files?|inputs?|logs?|manifests?|metadata|outputs?|packets?|payloads?|records?|state|streams?|values?))?\b/giu;
const NEGATED_ACTIVE_CHANGE_PATTERN =
  /\b(?:avoid|cannot|(?:do(?:es)?|must|shall|should|will)\s+not|never|prevent|without)\s+(?:be(?:ing)?\s+)?(?:alter\w*|chang\w*|corrupt\w*|modif\w*|mutat\w*|tamper\w*)(?:\s+(?:and|nor|or)\s+(?:be(?:ing)?\s+)?(?:alter\w*|chang\w*|corrupt\w*|modif\w*|mutat\w*|tamper\w*))*(?:\s+(?:(?:the|with)\s+)?(?:artifacts?|buffers?|bytes?|data|files?|inputs?|logs?|manifests?|metadata|outputs?|packets?|payloads?|records?|state|streams?|them|values?))?\b/giu;
const NEGATED_PASSIVE_CHANGE_PATTERN =
  /\b(?:artifacts?|buffers?|bytes?|data|files?|inputs?|logs?|manifests?|metadata|outputs?|packets?|payloads?|records?|state|streams?|values?)\s+(?:is|are|was|were)\s+not\s+(?:being\s+)?(?:alter\w*|chang\w*|corrupt\w*|modif\w*|mutat\w*|tamper\w*)(?:\s+(?:and|nor|or)\s+(?:being\s+)?(?:alter\w*|chang\w*|corrupt\w*|modif\w*|mutat\w*|tamper\w*))*\b/giu;
const NO_ARTIFACT_CHANGE_PATTERN =
  /\bno\s+(?:(?:artifacts?|buffers?|bytes?|data|files?|inputs?|logs?|manifests?|metadata|outputs?|packets?|payloads?|records?|state|streams?|values?)\s+)?(?:alteration|change|corruption|modification|mutation|tampering)(?:\s+(?:and|nor|or)\s+(?:alteration|change|corruption|modification|mutation|tampering))*\b/giu;
const FAILURE_PATTERN = /\b(?:error|fail\w*|invalid|reject\w*|rollback|stale|throw\w*)\b/iu;
const PRESERVATION_PATTERN =
  /\b(?:all[-\s]?or[-\s]?nothing|does\s+not\s+(?:advance|append|change|consume)|no\s+partial\s+mutation|preserv\w*|remain\w*|restor\w*|rollback|unchanged)\b/iu;
const ATOMIC_FAILURE_PRESERVATION_PATTERN =
  /\b(?:all[-\s]?or[-\s]?nothing|atomic\w*|either\s+all\b[\s\S]*\bor\s+no\b)\b/iu;
const ARTIFACT_DOMAIN_PATTERNS = [
  /\b(?:exportlog|fromlog|jsonl|logs?)\b/iu,
  /\bmanifests?\b/iu,
  /\b(?:payloads?|records?)\b/iu,
  /\btransactions?\b/iu,
  /\bjournals?\b/iu,
  /\bstreams?\b/iu,
  /\bhistor(?:y|ies)\b/iu,
  /\bpackets?\b/iu,
  /\btraces?\b/iu,
  /\bentr(?:y|ies)\b/iu,
] as const;

export function deriveRequirementProofPolicies(
  sources: readonly TaskVerificationSourcePrompt[],
  requirements: readonly TaskRequirement[],
  inactiveSourceClauseIds: ReadonlySet<string> = new Set(),
): TaskRequirement[] | string {
  const clauses = requirementSourceClauses(sources).filter((clause) => !inactiveSourceClauseIds.has(clause.id));
  const facetsById = new Map(
    clauses.flatMap((clause) => requirementSourceFacets(clause).map((facet) => [facet.id, facet] as const)),
  );
  const policies = new Map(
    requirements.map((requirement) => [requirement.id, new Set(requirement.proofPolicies ?? [])]),
  );
  for (const [sourceOffset, source] of sources.entries()) {
    const sourceIndex = sourceOffset + 1;
    const sourceClauses =
      source.kind === "referenced_file"
        ? clauses.filter((clause) => clause.sourcePromptIndex === sourceIndex)
        : requirementSourceClauses([{ ...source, kind: "referenced_file" }]);
    const serialClauses = sourceClauses.filter(
      (clause) =>
        NEWLINE_TERMINATED_PATTERN.test(clause.text) &&
        (SERIALIZATION_PATTERN.test(clause.text) || hasRecognizedArtifactDomain(clause.text)),
    );
    const truncationClauses = sourceClauses.filter(
      (clause) => TRUNCATION_PATTERN.test(clause.text) && hasSharedArtifactDomain(clause.text, serialClauses),
    );
    if (serialClauses.length === 0 || truncationClauses.length === 0) continue;
    const truncationIds = new Set(truncationClauses.map((clause) => clause.id));
    const sourceIsUniversal = truncationClauses.some((clause) => UNIVERSAL_TRUNCATION_PATTERN.test(clause.text));
    const terminalRequirement = requirements.find((requirement) => {
      const mapped = requirement.sourceClauseIds ?? [];
      const text = `${requirement.text}\n${requirement.acceptanceCriterion}`;
      const mapsTruncationBoundary =
        source.kind === "referenced_file"
          ? mapped.some((id) => truncationIds.has(id))
          : requirement.sourcePromptIndexes.includes(sourceIndex) &&
            truncationClauses.some((clause) => hasSharedArtifactDomain(text, [clause]));
      return (
        mapsTruncationBoundary &&
        TRUNCATION_PATTERN.test(text) &&
        TERMINAL_BOUNDARY_PATTERN.test(text) &&
        FAILURE_PATTERN.test(text) &&
        (!sourceIsUniversal || UNIVERSAL_PATTERN.test(text))
      );
    });
    if (!terminalRequirement) {
      return "A newline-terminated artifact that rejects truncation requires one complete truncation requirement covering exact final byte removal of the terminal newline; preserve any universal qualifier from the source.";
    }
    policies.get(terminalRequirement.id)!.add("remove_exact_final_byte");
  }

  for (const requirement of requirements) {
    const text = `${requirement.text}\n${requirement.acceptanceCriterion}`;
    const mappedDirectText = sources
      .flatMap((source, sourceOffset) =>
        source.kind !== "referenced_file" && requirement.sourcePromptIndexes.includes(sourceOffset + 1)
          ? [source.text]
          : [],
      )
      .join("\n");
    const mappedReferencedText = clauses
      .filter((clause) => requirement.sourceClauseIds?.includes(clause.id))
      .map((clause) => clause.text)
      .join("\n");
    const mappedText = [mappedDirectText, mappedReferencedText].join("\n");
    const semanticText = mappedReferencedText ? `${mappedReferencedText}\n${text}` : text;
    if (hasArtifactChangeSemantics(mappedText) && hasArtifactChangeSemantics(text)) {
      policies.get(requirement.id)!.add("change_artifact_bytes");
    }
    const mappedFacets = (requirement.sourceFacetIds ?? []).flatMap((facetId) => {
      const facet = facetsById.get(facetId);
      return facet ? [facet] : [];
    });
    if (mappedFacets.length > 0) {
      addFacetFailureProofPolicies(mappedFacets, policies.get(requirement.id)!);
      continue;
    }
    const hasFailurePreservation =
      (FAILURE_PATTERN.test(semanticText) && PRESERVATION_PATTERN.test(semanticText)) ||
      ATOMIC_FAILURE_PRESERVATION_PATTERN.test(semanticText);
    if (!hasFailurePreservation) continue;
    if (/\bstate\b/iu.test(text)) policies.get(requirement.id)!.add("preserve_state_on_failure");
    if (/\b(?:event[-\s]?logs?|history|logs?)\b/iu.test(text)) {
      policies.get(requirement.id)!.add("preserve_log_on_failure");
    }
    if (/\bversions?\b/iu.test(text)) policies.get(requirement.id)!.add("preserve_version_on_failure");
    if (/\bpositions?\b/iu.test(text)) policies.get(requirement.id)!.add("preserve_position_on_failure");
    if (/\b(?:command[-\s]?ids?|idempoten\w*)\b/iu.test(text)) {
      policies.get(requirement.id)!.add("preserve_command_identity_on_failure");
    }
  }
  return requirements.map((requirement) => {
    const proofPolicies = [...policies.get(requirement.id)!];
    return proofPolicies.length > 0 ? { ...requirement, proofPolicies } : requirement;
  });
}

function addFacetFailureProofPolicies(
  facets: readonly RequirementSourceFacet[],
  policies: Set<RequirementProofPolicy>,
): void {
  const concepts = new Set(
    facets.filter((facet) => facet.kind === "failure_preservation").flatMap((facet) => facet.requiredConcepts),
  );
  if (concepts.has("state")) policies.add("preserve_state_on_failure");
  if (concepts.has("event log")) policies.add("preserve_log_on_failure");
  if (concepts.has("version")) policies.add("preserve_version_on_failure");
  if (concepts.has("position")) policies.add("preserve_position_on_failure");
  if (concepts.has("command ID") || concepts.has("idempotency record")) {
    policies.add("preserve_command_identity_on_failure");
  }
}

function hasSharedArtifactDomain(truncationClause: string, serializationClauses: readonly { text: string }[]): boolean {
  return ARTIFACT_DOMAIN_PATTERNS.some(
    (domain) => domain.test(truncationClause) && serializationClauses.some((clause) => domain.test(clause.text)),
  );
}

function hasRecognizedArtifactDomain(value: string): boolean {
  return ARTIFACT_DOMAIN_PATTERNS.some((domain) => domain.test(value));
}

function hasArtifactChangeSemantics(value: string): boolean {
  return value.split(/[.!?;\n]+/u).some((clause) => {
    const positiveClause = clause
      .replace(GOVERNED_ARTIFACT_CHANGE_NOUN_PATTERN, " ")
      .replace(NEGATED_ACTIVE_CHANGE_PATTERN, " ")
      .replace(NEGATED_PASSIVE_CHANGE_PATTERN, " ")
      .replace(NO_ARTIFACT_CHANGE_PATTERN, " ");
    return hasBoundArtifactChangeProofIntent(positiveClause);
  });
}

function hasBoundArtifactChangeProofIntent(value: string): boolean {
  const tokens = value.toLocaleLowerCase("en-US").match(/[a-z0-9]+/gu) ?? [];
  return tokens.some(
    (token, index) =>
      isArtifactChangeToken(tokens, token, index) &&
      (hasNearbyProofIntent(tokens, index, -1, PROOF_HANDLER_PREFIXES) ||
        hasNearbyProofIntent(tokens, index, 1, PROOF_OUTCOME_PREFIXES)),
  );
}

function isArtifactChangeToken(tokens: readonly string[], token: string, index: number): boolean {
  if (
    token.startsWith("corrupt") ||
    token.startsWith("tamper") ||
    token === "bitflip" ||
    (token === "bit" && tokens[index + 1]?.startsWith("flip"))
  ) {
    return true;
  }
  if (!ARTIFACT_CHANGE_PREFIXES.some((prefix) => token.startsWith(prefix))) return false;
  return tokens.slice(Math.max(0, index - 2), index + 3).some((candidate) => ARTIFACT_CHANGE_DOMAINS.has(candidate));
}

function hasNearbyProofIntent(
  tokens: readonly string[],
  changeIndex: number,
  direction: -1 | 1,
  prefixes: readonly string[],
): boolean {
  for (let distance = 1; distance <= 6; distance += 1) {
    const token = tokens[changeIndex + distance * direction];
    if (
      !token ||
      PROOF_INTENT_BOUNDARIES.has(token) ||
      (direction === 1 && FORWARD_PROOF_INTENT_BOUNDARIES.has(token))
    ) {
      return false;
    }
    if (prefixes.some((prefix) => token.startsWith(prefix)) || token.endsWith("error")) return true;
  }
  return false;
}
