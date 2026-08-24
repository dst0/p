import { escapeMarkdownText, markdownCodeSpan } from "./benchmark-markdown.js";

export function formatRequirementDefinitionCount(liveness) {
  if (Number.isSafeInteger(liveness?.requirementDefinitionAttemptCount) && liveness.requirementDefinitionAttemptCount >= 0) {
    return liveness.requirementDefinitionAttemptCount.toLocaleString("en-US");
  }
  const observed = liveness?.observedRequirementDefinitionAttemptCount;
  return Number.isSafeInteger(observed) && observed > 0 ? `at least ${observed.toLocaleString("en-US")}` : "n/a";
}

function formatBoolean(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unknown";
}

function formatProgressEvidence(value) {
  if (typeof value !== "string" || value.length === 0) return "n/a";
  return markdownCodeSpan(value);
}

export function renderGateFailureLiveness(liveness) {
  if (!liveness) return "";
  return (
    `${escapeMarkdownText("Gate liveness")}: Requirement definitions: ${formatRequirementDefinitionCount(liveness)}; ` +
    `Semantic evidence available: ${formatBoolean(liveness.semanticEvidenceAvailable)}; ` +
    `complete: ${formatBoolean(liveness.semanticEvidenceComplete)}; ` +
    `Progress evidence: ${formatProgressEvidence(liveness.progressEvidence)}.\n\n`
  );
}
