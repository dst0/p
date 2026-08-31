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
};

type SemanticEvent = Record<string, unknown>;
type PendingCall = { action?: string; submittedCertificate: boolean; toolName: string };

const TOKEN_PATTERN = /\bverification_token:\s*\S+/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  };
}

export function createTaskVerificationSemanticTracker() {
  let evidence = emptyEvidence();
  const pending = new Map<string, PendingCall>();
  return {
    start(event: SemanticEvent): void {
      if (event.type !== "tool_execution_start" || typeof event.toolName !== "string") return;
      const args = isRecord(event.args) ? event.args : {};
      const action = typeof args.action === "string" ? args.action : undefined;
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
      if (key) pending.set(key, { action, submittedCertificate, toolName: event.toolName });
    },
    end(event: SemanticEvent): void {
      if (event.type !== "tool_execution_end" || typeof event.toolCallId !== "string") return;
      const call = pending.get(event.toolCallId);
      if (!call) return;
      pending.delete(event.toolCallId);
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
    },
    snapshot(): TaskVerificationSemanticEvidence {
      return { ...evidence };
    },
    endTurn(): void {
      pending.clear();
    },
    reset(): void {
      evidence = emptyEvidence();
      pending.clear();
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
  if (evidence.finishCertificateSubmissionCount < 1 || evidence.acceptedFinishCount < 1) {
    return "task-verification certificate was not accepted by finish_work";
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
  if (evidence.auditVerdictAttemptCount < 1 || evidence.auditCertificateCount < 1) {
    return "audit verdict and certificate path was not observed";
  }
  return undefined;
}
