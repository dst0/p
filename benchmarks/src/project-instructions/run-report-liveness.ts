import { escapeMarkdownText, markdownCodeSpan } from "../harness/markdown.ts";

type BenchmarkLiveness = {
  requirementDefinitionAttemptCount?: number | null;
  observedRequirementDefinitionAttemptCount?: number;
  semanticEvidenceAvailable?: unknown;
  semanticEvidenceComplete?: unknown;
  progressEvidence?: unknown;
};

export function formatRequirementDefinitionCount(liveness: BenchmarkLiveness | undefined): string {
  if (
    typeof liveness?.requirementDefinitionAttemptCount === "number" &&
    Number.isSafeInteger(liveness.requirementDefinitionAttemptCount) &&
    liveness.requirementDefinitionAttemptCount >= 0
  ) {
    return liveness.requirementDefinitionAttemptCount.toLocaleString("en-US");
  }
  const observed = liveness?.observedRequirementDefinitionAttemptCount;
  return typeof observed === "number" && Number.isSafeInteger(observed) && observed > 0
    ? `at least ${observed.toLocaleString("en-US")}`
    : "n/a";
}

function formatBoolean(value: unknown): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unknown";
}

function formatProgressEvidence(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "n/a";
  return markdownCodeSpan(value);
}

export function renderGateFailureLiveness(liveness: BenchmarkLiveness | undefined): string {
  if (!liveness) return "";
  return (
    `${escapeMarkdownText("Gate liveness")}: Requirement definitions: ${formatRequirementDefinitionCount(liveness)}; ` +
    `Semantic evidence available: ${formatBoolean(liveness.semanticEvidenceAvailable)}; ` +
    `complete: ${formatBoolean(liveness.semanticEvidenceComplete)}; ` +
    `Progress evidence: ${formatProgressEvidence(liveness.progressEvidence)}.\n\n`
  );
}
