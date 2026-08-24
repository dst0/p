import { createHmac, randomBytes } from "node:crypto";

const DEFINITION_ACTIONS = new Set(["define", "repair_definition"]);
const REVISION_PATTERN = /\bdefinition_revision:\s*([0-9a-f-]+)\b/iu;
const ACTIVE_DRAFT_PATTERN = /ACTIVE REJECTED DEFINITION BATCH/u;
const FULL_RESTART_PATTERN =
  /REQUIREMENT AUDIT — DEFINE AUTHORITATIVE USER REQUIREMENTS|Call record_requirement_audit with action ["']define["']/u;
const ORDINARY_HEADER = /^Requirement definition has (\d+) deterministic validation errors:\s*$/u;
const BOUNDED_HEADER = /^Requirement definition has (\d+) deterministic validation errors across (\d+) repair classes;/u;
const NUMBERED_DIAGNOSTIC = /^\d+\.\s+(.*)$/u;
const GROUPED_DIAGNOSTIC = /^\[(\d+)\s+instances?\]\s+(.*)$/u;
const CLASS_PATTERNS = [
  ["unsupported_type", /has an unsupported type\./u],
  ["missing_text", /needs concrete text and acceptance_criterion\./u],
  ["compound", /is compound:/u],
  ["duplicate_requirement", /Duplicate requirement:/u],
  ["invalid_prompt_index", /references an invalid source_prompt_index\./u],
  ["invalid_clause_id", /references an invalid source_clause_id\./u],
  ["invalid_facet_id", /references an invalid source_facet_id\./u],
  ["multiple_facets", /maps multiple source facets/u],
  ["missing_facet_mapping", /maps faceted source clauses without source_facet_ids:/u],
  ["unsafe_mapped_clause", /is an unsafe delegated instruction/u],
  ["clause_prompt_mismatch", /maps source clause .* without its source_prompt_index\./u],
  ["polarity_reversal", /has behavioral polarity that the mapped requirement reverses\./u],
  ["semantic_mismatch", /does not semantically support the mapped requirement\./u],
  ["facet_constraint", /Source facet .* is missing/u],
  ["referenced_source_mapping", /must map every referenced-file source index/u],
  ["invalid_ignored_clause", /Ignored source clause .* is invalid or lacks a reason\./u],
  ["unsafe_classification_required", /must use classification unsafe_instruction\./u],
  ["unsafe_classification_invalid", /cannot use unsafe_instruction\./u],
  ["normative_informational", /cannot be ignored as informational\./u],
  ["invalid_example", /cannot be ignored as example\.|is not structurally an example\./u],
  ["invalid_supersession_field", /may name superseded_by_source_prompt_index only/u],
  ["invalid_supersession_index", /requires a direct user prompt index\./u],
  ["invalid_supersession", /does not conflict with or supersede source clause/u],
  ["mapped_and_ignored_clause", /cannot be both mapped and ignored\./u],
  ["duplicate_ignored_clause", /Source clause .* is ignored twice\./u],
  ["unclassified_clause", /unclassified source_clause_ids:/u],
  ["uncovered_concept", /has uncovered normative concepts?:/u],
  ["uncovered_facet", /has uncovered source facets:/u],
  ["derived_proof_boundary", /newline-terminated artifact that rejects truncation/u],
  ["invalid_ignored_prompt", /Ignored source prompt .* is invalid or lacks a reason\./u],
  ["referenced_prompt_ignored", /Referenced requirement source .* cannot be ignored\./u],
  ["duplicate_ignored_prompt", /Source prompt .* is ignored twice\./u],
  ["referenced_and_ignored_prompt", /Source prompt .* cannot be both referenced and ignored\./u],
  ["unclassified_prompt", /unclassified indexes:/u],
];

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function resultText(result) {
  const content = result?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => typeof part?.text === "string").map((part) => part.text).join("\n");
}

function normalizedDiagnostic(value) {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\bRequirement\s+\d+\b/giu, "Requirement #")
    .replace(/\s+/gu, " ")
    .trim();
}

function diagnosticClass(value) {
  return CLASS_PATTERNS.find((entry) => entry[1].test(value))?.[0] ?? "other";
}

function diagnosticSet(message, hasRevision, fingerprintKey) {
  const lines = String(message ?? "").split(/\r?\n/u);
  const ordinary = lines[0]?.match(ORDINARY_HEADER);
  const bounded = lines[0]?.match(BOUNDED_HEADER);
  const entries = [];
  for (const line of lines.slice(ordinary || bounded ? 1 : 0)) {
    const numbered = line.match(NUMBERED_DIAGNOSTIC)?.[1];
    if (!numbered) continue;
    const grouped = numbered.match(GROUPED_DIAGNOSTIC);
    entries.push({ text: grouped?.[2] ?? numbered, count: grouped ? Number(grouped[1]) : 1 });
  }
  if (!ordinary && !bounded && hasRevision && String(message ?? "").trim()) {
    entries.push({ text: String(message), count: 1 });
  }
  const total = ordinary ? Number(ordinary[1]) : bounded ? Number(bounded[1]) : hasRevision ? entries.length : null;
  const complete = total !== null && !bounded && entries.reduce((sum, entry) => sum + entry.count, 0) === total;
  const fingerprintCounts = new Map();
  const classCounts = new Map();
  for (const entry of entries) {
    const normalized = normalizedDiagnostic(entry.text);
    const fingerprint = createHmac("sha256", fingerprintKey).update(normalized).digest("hex");
    fingerprintCounts.set(fingerprint, (fingerprintCounts.get(fingerprint) ?? 0) + entry.count);
    const category = diagnosticClass(normalized);
    classCounts.set(category, (classCounts.get(category) ?? 0) + entry.count);
  }
  return {
    total,
    complete,
    fingerprints: new Map([...fingerprintCounts].sort(([left], [right]) => left.localeCompare(right))),
    classes: Object.fromEntries([...classCounts].sort(([left], [right]) => left.localeCompare(right))),
  };
}

function lineage(previous, current) {
  let resolved = 0;
  let persisting = 0;
  let introduced = 0;
  for (const [hash, count] of previous.fingerprints) {
    const next = current.fingerprints.get(hash) ?? 0;
    persisting += Math.min(count, next);
    resolved += Math.max(0, count - next);
  }
  for (const [hash, count] of current.fingerprints) {
    introduced += Math.max(0, count - (previous.fingerprints.get(hash) ?? 0));
  }
  return { resolved, persisting, introduced, complete: previous.complete && current.complete };
}

function resultStatus(event) {
  const status = event.result?.details?.status;
  if (["updated", "needs_action", "unchanged"].includes(status)) return status;
  return event.isError === true ? "error" : "unknown";
}

function acceptedRequirementCount(event) {
  const requirements = event.result?.details?.state?.requirementAudit?.requirements;
  return Array.isArray(requirements) ? requirements.length : null;
}

export function createRequirementRepairTelemetry() {
  const fingerprintKey = randomBytes(32);
  const emitted = new Set();
  let active = new Map();
  let currentDraftRequirementCount = null;
  let currentDefinitionRevision = null;
  let previousDiagnostics = { total: 0, complete: true, fingerprints: new Map(), classes: {} };
  let actionOrder = 0;
  let settledOrder = 0;

  function start(event, key, elapsedMs) {
    const action = event.args?.action;
    const tracked =
      (event.toolName === "record_requirement_audit" && DEFINITION_ACTIONS.has(action)) ||
      (event.toolName === "record_task_verification" && action === "status");
    if (!tracked) return;
    actionOrder += 1;
    const requirements = Array.isArray(event.args?.requirements) ? event.args.requirements : undefined;
    const repairs = Array.isArray(event.args?.requirement_repairs) ? event.args.requirement_repairs : [];
    const replacementCount = repairs.reduce(
      (sum, repair) => sum + (Array.isArray(repair?.replacements) ? repair.replacements.length : 0),
      0,
    );
    const candidateDraftCount =
      action === "define"
        ? (requirements?.length ?? null)
        : action === "repair_definition" && currentDraftRequirementCount !== null
          ? currentDraftRequirementCount - repairs.length + replacementCount
          : null;
    active.set(key, {
      action,
      actionOrder,
      startedElapsedMs: elapsedMs,
      recordingOrdinal: Number.isSafeInteger(event.benchmarkEventOrdinal) ? event.benchmarkEventOrdinal : null,
      submittedRequirementCount: requirements?.length ?? null,
      candidateDraftCount,
      repairEntryCount: action === "repair_definition" ? repairs.length : 0,
      replacementCount: action === "repair_definition" ? replacementCount : 0,
      submittedDefinitionRevision:
        action === "repair_definition" && typeof event.args?.definition_revision === "string"
          ? event.args.definition_revision
          : null,
    });
  }

  function end(event, key, elapsedMs) {
    const pending = active.get(key);
    if (!pending) return undefined;
    active.delete(key);
    settledOrder += 1;
    const emissionKey = `${key}\0${pending.action}`;
    const status = resultStatus(event);
    const content = resultText(event.result);
    if (pending.action === "status") {
      const record = {
        event: "requirement_definition_status_settled",
        action: "status",
        actionOrder: pending.actionOrder,
        settledOrder,
        startedElapsedMs: pending.startedElapsedMs,
        settledElapsedMs: elapsedMs,
        recordingOrdinal: pending.recordingOrdinal,
        resultStatus: status,
        statusRecovery: ACTIVE_DRAFT_PATTERN.test(content)
          ? "active_rejected_definition_batch"
          : FULL_RESTART_PATTERN.test(content)
            ? "full_definition_restart"
            : "other",
      };
      if (emitted.has(emissionKey)) return undefined;
      emitted.add(emissionKey);
      return record;
    }
    const responseRevision = content.match(REVISION_PATTERN)?.[1] ?? null;
    const hasRevision = responseRevision !== null;
    const repairRevisionMatches =
      pending.action !== "repair_definition" ||
      (currentDefinitionRevision !== null && pending.submittedDefinitionRevision === currentDefinitionRevision);
    const accepted = status === "updated" && repairRevisionMatches;
    const appliedRejection =
      status === "needs_action" &&
      hasRevision &&
      (pending.action === "define" ||
        (repairRevisionMatches &&
          currentDefinitionRevision !== null &&
          responseRevision !== currentDefinitionRevision));
    const parsedDiagnostics = diagnosticSet(event.result?.details?.message, hasRevision, fingerprintKey);
    const outcome =
      accepted
        ? "accepted"
        : appliedRejection
          ? "rejected"
          : status === "needs_action" || status === "updated"
            ? "protocol_rejected"
            : status;
    const currentDiagnostics =
      outcome === "accepted"
        ? { total: 0, complete: true, fingerprints: new Map(), classes: {} }
        : outcome === "rejected"
          ? parsedDiagnostics
          : previousDiagnostics;
    const acceptedCount = outcome === "accepted" ? acceptedRequirementCount(event) : null;
    if (outcome === "accepted" || outcome === "rejected") {
      currentDraftRequirementCount = acceptedCount ?? pending.candidateDraftCount;
      currentDefinitionRevision = outcome === "rejected" ? responseRevision : null;
    }
    const diagnosticsComparable = outcome === "accepted" || outcome === "rejected";
    const diagnosticLineage = diagnosticsComparable
      ? lineage(previousDiagnostics, currentDiagnostics)
      : { resolved: null, persisting: null, introduced: null, complete: false };
    if (outcome === "accepted" || outcome === "rejected") previousDiagnostics = currentDiagnostics;
    const record = {
      event: "requirement_definition_settled",
      action: pending.action,
      actionOrder: pending.actionOrder,
      settledOrder,
      startedElapsedMs: pending.startedElapsedMs,
      settledElapsedMs: elapsedMs,
      recordingOrdinal: pending.recordingOrdinal,
      resultStatus: status,
      definitionOutcome: outcome,
      submittedRequirementCount: pending.submittedRequirementCount,
      currentDraftRequirementCount,
      repairEntryCount: pending.repairEntryCount,
      replacementCount: pending.replacementCount,
      diagnosticTotal: currentDiagnostics.total,
      diagnosticClassHistogram: currentDiagnostics.classes,
      diagnosticFingerprints: [...currentDiagnostics.fingerprints].map(([hmacSha256, count]) => ({ hmacSha256, count })),
      diagnosticLineage,
      diagnosticsComplete: currentDiagnostics.complete,
      diagnosticsComparable,
    };
    if (emitted.has(emissionKey)) return undefined;
    emitted.add(emissionKey);
    return record;
  }

  function resetReplayState() {
    active = new Map();
    currentDraftRequirementCount = null;
    currentDefinitionRevision = null;
    previousDiagnostics = { total: 0, complete: true, fingerprints: new Map(), classes: {} };
    actionOrder = 0;
    settledOrder = 0;
  }

  return { start, end, resetReplayState };
}
