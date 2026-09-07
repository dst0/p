import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { EvidenceVerificationInput, VerificationInput, VerificationResult } from "../types.ts";
import { recordCompletionChecklist } from "./completion-checklist.ts";
import { readyToFinishWithEvidence } from "./evidence-readiness.ts";
import { recordEvidenceTaskDeclaration } from "./evidence-task-declaration.ts";

export function applyEvidenceInput(
  self: TaskVerificationController,
  input: VerificationInput | EvidenceVerificationInput,
): VerificationResult {
  if (input.action === "declare_task") return recordEvidenceTaskDeclaration(self, input);
  if (input.action === "record_completion_checklist") return recordCompletionChecklist(self, input);
  if (input.action === "ready_to_finish") return readyToFinishWithEvidence(self, input as EvidenceVerificationInput);
  if (input.action === "status") return self.updated(self.formatStatus(), false);
  return self.updated(
    'Evidence mode accepts only "declare_task", "record_completion_checklist", "ready_to_finish", or "status".',
    false,
  );
}
