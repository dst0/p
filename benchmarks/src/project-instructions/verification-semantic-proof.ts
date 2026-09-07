export type TaskVerificationSemanticEvidence = {
  readinessAttemptCount: number;
  evidenceCertificateCount: number;
  auditToolCallCount: number;
  auditDefinitionAttemptCount: number;
  auditRepairAttemptCount: number;
  auditVerdictAttemptCount: number;
  auditCertificateCount: number;
  finishCertificateSubmissionCount: number;
  acceptedFinishCount: number;
  acceptedTerminalCompletionCount: number;
};

type SemanticEvent = Record<string, unknown>;
type PendingCall = { action?: string; submittedCertificate: boolean; toolName: string };

const TOKEN_PATTERN = /\bverification_token:\s*\S+/u;
const MAX_PENDING_CALLS = 8_192;
const MAX_PENDING_CALL_ID_BYTES = 16 * 1024 * 1024;
interface TaskVerificationTrackerOptions {
  maxPendingCallIdBytes?: number;
  maxPendingCalls?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function verificationAction(value: unknown): string | undefined {
  return value === "define" || value === "repair_definition" || value === "verdict" || value === "ready_to_finish"
    ? value
    : undefined;
}

function resultText(result: unknown): string {
  if (!isRecord(result)) return "";
  if (typeof result.content === "string") return result.content;
  if (!Array.isArray(result.content)) return "";
  return result.content
    .filter((part): part is Record<string, unknown> => isRecord(part) && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

function hasVerifiedCompletionMarker(result: unknown): boolean {
  if (!isRecord(result) || !isRecord(result.details) || !isRecord(result.details.verifiedCompletion)) return false;
  const completion = result.details.verifiedCompletion;
  const keys = Object.keys(completion).sort();
  return (
    JSON.stringify(keys) ===
      JSON.stringify(["certificate_hash", "files_changed", "kind", "status", "summary", "version"]) &&
    completion.kind === "task_verification_completion" &&
    completion.version === 1 &&
    completion.status === "success" &&
    typeof completion.summary === "string" &&
    completion.summary.trim().length > 0 &&
    Array.isArray(completion.files_changed) &&
    completion.files_changed.every((filePath) => typeof filePath === "string") &&
    typeof completion.certificate_hash === "string" &&
    /^[a-f0-9]{64}$/u.test(completion.certificate_hash)
  );
}

function emptyEvidence(): TaskVerificationSemanticEvidence {
  return {
    readinessAttemptCount: 0,
    evidenceCertificateCount: 0,
    auditToolCallCount: 0,
    auditDefinitionAttemptCount: 0,
    auditRepairAttemptCount: 0,
    auditVerdictAttemptCount: 0,
    auditCertificateCount: 0,
    finishCertificateSubmissionCount: 0,
    acceptedFinishCount: 0,
    acceptedTerminalCompletionCount: 0,
  };
}

export function createTaskVerificationSemanticTracker(options: TaskVerificationTrackerOptions = {}) {
  const maxPendingCalls = options.maxPendingCalls ?? MAX_PENDING_CALLS;
  const maxPendingCallIdBytes = options.maxPendingCallIdBytes ?? MAX_PENDING_CALL_ID_BYTES;
  let evidence = emptyEvidence();
  const pending = new Map<string, PendingCall>();
  const pendingKeyBytes = new Map<string, number>();
  let pendingBytes = 0;
  const clearPending = (): void => {
    pending.clear();
    pendingKeyBytes.clear();
    pendingBytes = 0;
  };
  return {
    start(event: SemanticEvent): void {
      if (event.type !== "tool_execution_start" || typeof event.toolName !== "string") return;
      const args = isRecord(event.args) ? event.args : {};
      const action = verificationAction(args.action);
      const key = typeof event.toolCallId === "string" ? event.toolCallId : "";
      const issuedCertificate = evidence.evidenceCertificateCount > 0 || evidence.auditCertificateCount > 0;
      const submittedCertificate =
        event.toolName === "finish_work" &&
        args.status === "success" &&
        ((typeof args.verification_token === "string" && args.verification_token.trim().length > 0) ||
          issuedCertificate);
      if (event.toolName === "record_task_verification" && action === "ready_to_finish") {
        evidence.readinessAttemptCount += 1;
      }
      if (event.toolName === "record_requirement_audit") {
        evidence.auditToolCallCount += 1;
        if (action === "define") evidence.auditDefinitionAttemptCount += 1;
        if (action === "repair_definition") evidence.auditRepairAttemptCount += 1;
        if (action === "verdict") evidence.auditVerdictAttemptCount += 1;
      }
      if (submittedCertificate) evidence.finishCertificateSubmissionCount += 1;
      const relevant =
        event.toolName === "finish_work" ||
        event.toolName === "record_requirement_audit" ||
        event.toolName === "record_task_verification";
      if (key && relevant) {
        const previousBytes = pendingKeyBytes.get(key) ?? 0;
        if (previousBytes === 0 && pending.size >= maxPendingCalls) {
          throw new BenchmarkCollectionOverflowError(
            "task verification pending calls",
            maxPendingCalls,
            pending.size + 1,
          );
        }
        const keyBytes = Buffer.byteLength(key, "utf8");
        const observedBytes = pendingBytes - previousBytes + keyBytes;
        if (observedBytes > maxPendingCallIdBytes) {
          throw new BenchmarkOutputOverflowError(
            "task verification pending call IDs",
            maxPendingCallIdBytes,
            observedBytes,
          );
        }
        pendingBytes = observedBytes;
        pendingKeyBytes.set(key, keyBytes);
        pending.set(key, { action, submittedCertificate, toolName: event.toolName });
      }
    },
    end(event: SemanticEvent): void {
      if (event.type !== "tool_execution_end" || typeof event.toolCallId !== "string") return;
      const call = pending.get(event.toolCallId);
      if (!call) return;
      pending.delete(event.toolCallId);
      pendingBytes -= pendingKeyBytes.get(event.toolCallId) ?? 0;
      pendingKeyBytes.delete(event.toolCallId);
      if (event.toolName !== call.toolName) return;
      if (event.isError !== false) return;
      const hasCertificate = TOKEN_PATTERN.test(resultText(event.result));
      if (call.toolName === "record_task_verification" && call.action === "ready_to_finish" && hasCertificate) {
        evidence.evidenceCertificateCount += 1;
      }
      if (call.toolName === "record_requirement_audit" && call.action === "verdict" && hasCertificate) {
        evidence.auditCertificateCount += 1;
      }
      if (call.toolName === "finish_work" && call.submittedCertificate) evidence.acceptedFinishCount += 1;
      if (
        call.toolName === "record_requirement_audit" &&
        call.action === "verdict" &&
        hasVerifiedCompletionMarker(event.result)
      ) {
        evidence.acceptedTerminalCompletionCount += 1;
      }
    },
    snapshot(): TaskVerificationSemanticEvidence {
      return { ...evidence };
    },
    endTurn(): void {
      clearPending();
    },
    reset(): void {
      evidence = emptyEvidence();
      clearPending();
    },
  };
}

export function taskVerificationSemanticFailure(
  mode: "evidence" | "audit" | "off",
  evidence: TaskVerificationSemanticEvidence,
): string | undefined {
  if (mode === "off") {
    return Object.values(evidence).some((count) => count !== 0)
      ? "off profile emitted task-verification semantic events"
      : undefined;
  }
  if (evidence.readinessAttemptCount < 1) return "task-verification readiness path was not observed";
  const acceptedFinish = evidence.finishCertificateSubmissionCount > 0 && evidence.acceptedFinishCount > 0;
  if (!acceptedFinish && evidence.acceptedTerminalCompletionCount < 1) {
    return "task-verification completion was not accepted by finish_work or the trusted controller terminal";
  }
  if (mode === "evidence") {
    if (evidence.evidenceCertificateCount < 1) return "evidence completion certificate path was not observed";
    if (
      evidence.auditToolCallCount > 0 ||
      evidence.auditDefinitionAttemptCount > 0 ||
      evidence.auditRepairAttemptCount > 0 ||
      evidence.auditVerdictAttemptCount > 0 ||
      evidence.auditCertificateCount > 0
    ) {
      return "evidence profile emitted an audit tool call, definition, repair, verdict, or certificate";
    }
    return undefined;
  }
  if (
    evidence.auditVerdictAttemptCount < 1 ||
    (evidence.auditCertificateCount < 1 && evidence.acceptedTerminalCompletionCount < 1)
  ) {
    return "audit verdict and certificate or trusted terminal path was not observed";
  }
  return undefined;
}

import { BenchmarkCollectionOverflowError, BenchmarkOutputOverflowError } from "../harness/output-capture.ts";
