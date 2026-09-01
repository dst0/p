import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { currentCompletionChecklist, formatCompletionChecklist } from "./completion-checklist.ts";

export function formatEvidenceNextAction(self: TaskVerificationController): string {
  const checklist = currentCompletionChecklist(self);
  if (typeof checklist === "string") {
    return [`NEXT REQUIRED ACTION: ${checklist}.`, ...formatCompletionChecklist(self)].join("\n");
  }
  if (self.state.readiness?.status === "completion_ready" && self.state.readiness.token) {
    return [
      `Call finish_work with verification_token "${self.state.readiness.token}".`,
      ...formatCompletionChecklist(self),
    ].join("\n");
  }
  if (self.state.mutationRevision === 0) {
    return [
      "Apply the requested change using the frozen completion checklist.",
      ...formatCompletionChecklist(self),
    ].join("\n");
  }
  return [
    'Collect fresh verification evidence, then call record_task_verification with action "ready_to_finish" and evidence_refs_by_check aligned by index to this checklist:',
    ...formatCompletionChecklist(self),
  ].join("\n");
}
