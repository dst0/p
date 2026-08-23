import { requirementSourceClauses } from "./requirement-source-clauses.ts";
import type { TaskRequirement, TaskVerificationSourcePrompt } from "./types.ts";

const NEWLINE_TERMINATED_PATTERN = /\bnewline[-\s]?terminat\w*\b/iu;
const UNIVERSAL_TRUNCATION_PATTERN = /\b(?:any|all|every)\s+(?:\w+\s+){0,3}truncat\w*\b/iu;
const TRUNCATION_PATTERN = /\btruncat\w*\b/iu;
const SERIALIZATION_PATTERN = /\b(?:export\w*|jsonl|logs?|manifests?|records?|seriali[sz]\w*)\b/iu;
const TERMINAL_BOUNDARY_PATTERN =
  /\b(?:(?:exact|final|last|terminal)\s+(?:byte|character|newline)|(?:byte|character|newline)\s+(?:at\s+)?(?:the\s+)?(?:end|final|last|terminal))\b/iu;
const UNIVERSAL_PATTERN = /\b(?:all|any|every)\b/iu;
const CORRUPTED_ARTIFACT_PATTERN = /\b(?:alter\w*|bit[-\s]?flip\w*|corrupt\w*|mutat\w*|tamper\w*)\b/iu;
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
      return "A newline-terminated artifact that rejects truncation requires one complete truncation requirement covering exact final-byte removal of the terminal newline; preserve any universal qualifier from the source.";
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
    if (CORRUPTED_ARTIFACT_PATTERN.test(mappedText) && CORRUPTED_ARTIFACT_PATTERN.test(text)) {
      policies.get(requirement.id)!.add("change_artifact_bytes");
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

function hasSharedArtifactDomain(truncationClause: string, serializationClauses: readonly { text: string }[]): boolean {
  return ARTIFACT_DOMAIN_PATTERNS.some(
    (domain) => domain.test(truncationClause) && serializationClauses.some((clause) => domain.test(clause.text)),
  );
}

function hasRecognizedArtifactDomain(value: string): boolean {
  return ARTIFACT_DOMAIN_PATTERNS.some((domain) => domain.test(value));
}
