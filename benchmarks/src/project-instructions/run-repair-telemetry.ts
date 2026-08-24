import { randomBytes } from "node:crypto";
import type { DiagnosticFingerprint, DiagnosticLineage, DiagnosticSet } from "./run-repair-diagnostics.ts";
import { diagnosticSet, lineage } from "./run-repair-diagnostics.ts";

export type { DiagnosticFingerprint, DiagnosticLineage } from "./run-repair-diagnostics.ts";

const DEFINITION_ACTIONS = new Set(["define", "repair_definition"]);
const REVISION_PATTERN = /\bdefinition_revision:\s*([0-9a-f-]+)\b/iu;
const ACTIVE_DRAFT_PATTERN = /ACTIVE REJECTED DEFINITION BATCH/u;
const FULL_RESTART_PATTERN =
  /REQUIREMENT AUDIT — DEFINE AUTHORITATIVE USER REQUIREMENTS|Call record_requirement_audit with action ["']define["']/u;

export type RequirementStatusRecord = {
  event: "requirement_definition_status_settled";
  action: "status";
  actionOrder: number;
  settledOrder: number;
  startedElapsedMs: number;
  settledElapsedMs: number;
  recordingOrdinal: number | null;
  resultStatus: string;
  statusRecovery: "active_rejected_definition_batch" | "full_definition_restart" | "other";
};

export type RequirementDefinitionRecord = {
  event: "requirement_definition_settled";
  action: string;
  actionOrder: number;
  settledOrder: number;
  startedElapsedMs: number;
  settledElapsedMs: number;
  recordingOrdinal: number | null;
  resultStatus: string;
  definitionOutcome: string;
  submittedRequirementCount: number | null;
  currentDraftRequirementCount: number | null;
  repairEntryCount: number;
  replacementCount: number;
  diagnosticTotal: number | null;
  diagnosticClassHistogram: Record<string, number>;
  diagnosticFingerprints: DiagnosticFingerprint[];
  diagnosticLineage: DiagnosticLineage;
  diagnosticsComplete: boolean;
  diagnosticsComparable: boolean;
};

export type RequirementTelemetryRecord = RequirementStatusRecord | RequirementDefinitionRecord;

export type RequirementRepairTelemetry = {
  start: (event: unknown, key: string, elapsedMs: number) => void;
  end: (event: unknown, key: string, elapsedMs: number) => RequirementTelemetryRecord | undefined;
  resetReplayState: () => void;
};

type ActiveTracking = {
  action: string;
  actionOrder: number;
  startedElapsedMs: number;
  recordingOrdinal: number | null;
  submittedRequirementCount: number | null;
  candidateDraftCount: number | null;
  repairEntryCount: number;
  replacementCount: number;
  submittedDefinitionRevision: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resultText(result: unknown): string {
  if (!isRecord(result)) return "";
  const content = result.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is Record<string, unknown> => isRecord(part) && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

function resultStatus(event: Record<string, unknown>): string {
  const result = isRecord(event.result) ? event.result : undefined;
  const details = isRecord(result?.details) ? result.details : undefined;
  const status = details?.status;
  if (typeof status === "string" && ["updated", "needs_action", "unchanged"].includes(status)) return status;
  return event.isError === true ? "error" : "unknown";
}

function acceptedRequirementCount(event: Record<string, unknown>): number | null {
  const result = isRecord(event.result) ? event.result : undefined;
  const details = isRecord(result?.details) ? result.details : undefined;
  const state = isRecord(details?.state) ? details.state : undefined;
  const audit = isRecord(state?.requirementAudit) ? state.requirementAudit : undefined;
  const requirements = audit?.requirements;
  return Array.isArray(requirements) ? requirements.length : null;
}

export function createRequirementRepairTelemetry(): RequirementRepairTelemetry {
  const fingerprintKey = randomBytes(32);
  const emitted = new Set<string>();
  let active = new Map<string, ActiveTracking>();
  let currentDraftRequirementCount: number | null = null;
  let currentDefinitionRevision: string | null = null;
  let previousDiagnostics: DiagnosticSet = { total: 0, complete: true, fingerprints: new Map(), classes: {} };
  let actionOrder = 0;
  let settledOrder = 0;

  function start(event: unknown, key: string, elapsedMs: number): void {
    if (!isRecord(event) || typeof event.toolName !== "string") return;
    const args = isRecord(event.args) ? event.args : undefined;
    const action = typeof args?.action === "string" ? args.action : undefined;
    const tracked =
      (event.toolName === "record_requirement_audit" && typeof action === "string" && DEFINITION_ACTIONS.has(action)) ||
      (event.toolName === "record_task_verification" && action === "status");
    if (!tracked || !action) return;
    actionOrder += 1;
    const requirements = Array.isArray(args?.requirements) ? args.requirements : undefined;
    const repairs = Array.isArray(args?.requirement_repairs) ? args.requirement_repairs : [];
    const replacementCount = repairs.reduce(
      (sum, repair) => sum + (isRecord(repair) && Array.isArray(repair.replacements) ? repair.replacements.length : 0),
      0,
    );
    const candidateDraftCount =
      action === "define"
        ? (requirements?.length ?? null)
        : action === "repair_definition" && currentDraftRequirementCount !== null
          ? currentDraftRequirementCount - repairs.length + replacementCount
          : null;
    const ordinal =
      typeof event.benchmarkEventOrdinal === "number" && Number.isSafeInteger(event.benchmarkEventOrdinal)
        ? event.benchmarkEventOrdinal
        : null;
    active.set(key, {
      action,
      actionOrder,
      startedElapsedMs: elapsedMs,
      recordingOrdinal: ordinal,
      submittedRequirementCount: requirements?.length ?? null,
      candidateDraftCount,
      repairEntryCount: action === "repair_definition" ? repairs.length : 0,
      replacementCount: action === "repair_definition" ? replacementCount : 0,
      submittedDefinitionRevision:
        action === "repair_definition" && typeof args?.definition_revision === "string"
          ? args.definition_revision
          : null,
    });
  }

  function end(event: unknown, key: string, elapsedMs: number): RequirementTelemetryRecord | undefined {
    if (!isRecord(event)) return undefined;
    const pending = active.get(key);
    if (!pending) return undefined;
    active.delete(key);
    settledOrder += 1;
    const emissionKey = `${key}\0${pending.action}`;
    const status = resultStatus(event);
    const content = resultText(event.result);
    if (pending.action === "status") {
      const statusRecovery = ACTIVE_DRAFT_PATTERN.test(content)
        ? "active_rejected_definition_batch"
        : FULL_RESTART_PATTERN.test(content)
          ? "full_definition_restart"
          : "other";
      const record: RequirementStatusRecord = {
        event: "requirement_definition_status_settled",
        action: "status",
        actionOrder: pending.actionOrder,
        settledOrder,
        startedElapsedMs: pending.startedElapsedMs,
        settledElapsedMs: elapsedMs,
        recordingOrdinal: pending.recordingOrdinal,
        resultStatus: status,
        statusRecovery,
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
    const resultDetails = isRecord(event.result) && isRecord(event.result.details) ? event.result.details : undefined;
    const parsedDiagnostics = diagnosticSet(resultDetails?.message, hasRevision, fingerprintKey);
    const outcome = accepted
      ? "accepted"
      : appliedRejection
        ? "rejected"
        : status === "needs_action" || status === "updated"
          ? "protocol_rejected"
          : status;
    const currentDiagnostics =
      outcome === "accepted"
        ? { total: 0, complete: true, fingerprints: new Map<string, number>(), classes: {} }
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
    const record: RequirementDefinitionRecord = {
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
      diagnosticFingerprints: [...currentDiagnostics.fingerprints].map(([hmacSha256, count]) => ({
        hmacSha256,
        count,
      })),
      diagnosticLineage,
      diagnosticsComplete: currentDiagnostics.complete,
      diagnosticsComparable,
    };
    if (emitted.has(emissionKey)) return undefined;
    emitted.add(emissionKey);
    return record;
  }

  function resetReplayState(): void {
    active = new Map();
    currentDraftRequirementCount = null;
    currentDefinitionRevision = null;
    previousDiagnostics = { total: 0, complete: true, fingerprints: new Map(), classes: {} };
    actionOrder = 0;
    settledOrder = 0;
  }

  return { start, end, resetReplayState };
}
