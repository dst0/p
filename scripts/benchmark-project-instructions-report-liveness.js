import { escapeMarkdownText, markdownCodeSpan } from "./benchmark-markdown.js";

export function formatRequirementDefinitionCount(liveness) {
  return formatAttemptCount(
    liveness?.requirementDefinitionAttemptCount,
    liveness?.observedRequirementDefinitionAttemptCount,
  );
}

function formatRequirementRepairCount(liveness) {
  return formatAttemptCount(
    liveness?.requirementDefinitionRepairAttemptCount,
    liveness?.observedRequirementDefinitionRepairAttemptCount,
  );
}

function formatAttemptCount(exact, observed) {
  if (Number.isSafeInteger(exact) && exact >= 0) return exact.toLocaleString("en-US");
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
    `sparse repairs: ${formatRequirementRepairCount(liveness)}; ` +
    `Semantic evidence available: ${formatBoolean(liveness.semanticEvidenceAvailable)}; ` +
    `complete: ${formatBoolean(liveness.semanticEvidenceComplete)}; ` +
    `Progress evidence: ${formatProgressEvidence(liveness.progressEvidence)}.\n\n`
  );
}
