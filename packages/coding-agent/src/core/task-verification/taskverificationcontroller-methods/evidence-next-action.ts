import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { currentCompletionChecklist, formatCompletionChecklist } from "./completion-checklist.ts";

export function formatEvidenceNextAction(self: TaskVerificationController): string {
  const checklist = currentCompletionChecklist(self);
  if (typeof checklist === "string") {
    return [`NEXT REQUIRED ACTION: ${checklist}.`, ...formatCompletionChecklist(self)].join("\n");
  }
  if (self.state.readiness?.status === "completion_ready" && self.state.readiness.token) {
    return [
      "Call finish_work with status success; omit verification_token for controller autofill.",
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
    'Collect fresh verification evidence, then call record_task_verification once with action "ready_to_finish"; the controller selects and validates the current evidence batch:',
    ...formatCompletionChecklist(self),
  ].join("\n");
}
