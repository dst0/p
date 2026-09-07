import type { AgentMessage } from "@dst0/p-agent-core";
import { REQUIREMENT_AUDIT_TOOL_NAME } from "./constants.ts";
import type { TaskVerificationCompletionPayload, TaskVerificationState, VerificationResult } from "./types.ts";

const DEFAULT_COMPLETION_SUMMARY = "Completed the requested work with controller-verified evidence.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTaskVerificationFinalizer(mode: "audit" | "evidence", toolName: string, args: unknown): boolean {
  return mode === "audit" && isRecord(args) && toolName === REQUIREMENT_AUDIT_TOOL_NAME && args.action === "verdict";
}

export function createTaskVerificationCompletionPayload(
  args: unknown,
  state: TaskVerificationState,
  certificateHash: string,
): TaskVerificationCompletionPayload {
  const requestedSummary =
    isRecord(args) && typeof args.completion_summary === "string" ? args.completion_summary.trim() : "";
  const readinessSummary = state.readiness?.completionSummary?.trim() ?? "";
  const taskSummary = state.taskSummary?.trim() ?? "";
  return {
    kind: "task_verification_completion",
    version: 1,
    status: "success",
    summary: requestedSummary || readinessSummary || taskSummary || DEFAULT_COMPLETION_SUMMARY,
    files_changed: [...(state.taskOwnedPaths ?? [])].sort(),
    certificate_hash: certificateHash,
  };
}

export function isTaskVerificationCompletionPayload(value: unknown): value is TaskVerificationCompletionPayload {
  return (
    isRecord(value) &&
    value.kind === "task_verification_completion" &&
    value.version === 1 &&
    value.status === "success" &&
    typeof value.summary === "string" &&
    value.summary.trim().length > 0 &&
    Array.isArray(value.files_changed) &&
    value.files_changed.every((filePath) => typeof filePath === "string") &&
    typeof value.certificate_hash === "string" &&
    /^[a-f0-9]{64}$/u.test(value.certificate_hash)
  );
}

export function getTaskVerificationCompletionPayload(
  messages: readonly AgentMessage[],
): TaskVerificationCompletionPayload | undefined {
  const message = messages[messages.length - 1];
  if (message?.role !== "toolResult" || message.toolName !== REQUIREMENT_AUDIT_TOOL_NAME || message.isError !== false) {
    return undefined;
  }
  const details = message.details as VerificationResult | undefined;
  return isTaskVerificationCompletionPayload(details?.verifiedCompletion) ? details.verifiedCompletion : undefined;
}
