import { escapeMarkdownText, markdownCodeSpan } from "../harness/markdown.ts";

type BenchmarkLiveness = {
  requirementDefinitionAttemptCount?: number | null;
  observedRequirementDefinitionAttemptCount?: number;
  requirementDefinitionRepairAttemptCount?: number | null;
  observedRequirementDefinitionRepairAttemptCount?: number;
  semanticEvidenceAvailable?: unknown;
  semanticEvidenceComplete?: unknown;
  progressEvidence?: unknown;
};

export function formatRequirementDefinitionCount(liveness: BenchmarkLiveness | undefined): string {
  return formatAttemptCount(
    liveness?.requirementDefinitionAttemptCount,
    liveness?.observedRequirementDefinitionAttemptCount,
  );
}

function formatRequirementRepairCount(liveness: BenchmarkLiveness | undefined): string {
  return formatAttemptCount(
    liveness?.requirementDefinitionRepairAttemptCount,
    liveness?.observedRequirementDefinitionRepairAttemptCount,
  );
}

function formatAttemptCount(exact: number | null | undefined, observed: number | undefined): string {
  if (typeof exact === "number" && Number.isSafeInteger(exact) && exact >= 0) return exact.toLocaleString("en-US");
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
    `sparse repairs: ${formatRequirementRepairCount(liveness)}; ` +
    `Semantic evidence available: ${formatBoolean(liveness.semanticEvidenceAvailable)}; ` +
    `complete: ${formatBoolean(liveness.semanticEvidenceComplete)}; ` +
    `Progress evidence: ${formatProgressEvidence(liveness.progressEvidence)}.\n\n`
  );
}
