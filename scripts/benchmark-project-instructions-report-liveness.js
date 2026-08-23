import { escapeMarkdownText, markdownCodeSpan } from "./benchmark-markdown.js";

function formatDefinitionCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString("en-US") : "n/a";
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
    `${escapeMarkdownText("Gate liveness")}: Requirement definitions: ${formatDefinitionCount(liveness.requirementDefinitionAttemptCount)}; ` +
    `Semantic evidence available: ${formatBoolean(liveness.semanticEvidenceAvailable)}; ` +
    `complete: ${formatBoolean(liveness.semanticEvidenceComplete)}; ` +
    `Progress evidence: ${formatProgressEvidence(liveness.progressEvidence)}.\n\n`
  );
}
