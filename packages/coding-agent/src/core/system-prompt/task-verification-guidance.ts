import { DEFAULT_TASK_VERIFICATION_MODE, type TaskVerificationMode } from "../task-verification/mode.ts";

export function formatTaskVerificationGuideline(mode: TaskVerificationMode = DEFAULT_TASK_VERIFICATION_MODE): string {
  if (mode === "audit") {
    return "Before completion, re-read the original request and authoritative sources, then audit every requirement, boundary, negative case, requested format, and verification condition against direct evidence.";
  }
  if (mode === "off") {
    return "Before completion, re-read the original request and authoritative sources, then verify the requested outcome against direct evidence.";
  }
  return "Before completion, re-read the original request and authoritative sources, create one concise completion checklist for the requested outcome, and map each checklist item to direct evidence. Do not expand free text into an exhaustive formal clause matrix.";
}

export function formatTaskVerificationCompletionInstruction(mode: TaskVerificationMode): string {
  if (mode === "off") return "";
  if (mode === "audit") {
    return "For successful mutating or effectful tasks, call record_task_verification with action 'ready_to_finish', then complete the batched requirement audit before calling finish_work.";
  }
  return "In evidence mode, for response-only tasks first call record_task_verification with action 'record_completion_checklist' and verification_scope 'response_only' to record one concise completion checklist, then call finish_work without ready_to_finish. For mutating or effectful tasks, record the checklist before the first effect; after the final effect, call ready_to_finish with evidence_refs_by_check, then call finish_work.";
}
