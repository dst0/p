import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { EvidenceVerificationInput, VerificationInput, VerificationResult } from "../types.ts";
import { recordCompletionChecklist } from "./completion-checklist.ts";
import { readyToFinishWithEvidence } from "./evidence-readiness.ts";

export function applyEvidenceInput(
  self: TaskVerificationController,
  input: VerificationInput | EvidenceVerificationInput,
): VerificationResult {
  if (input.action === "record_completion_checklist") return recordCompletionChecklist(self, input);
  if (input.action === "ready_to_finish") return readyToFinishWithEvidence(self, input as EvidenceVerificationInput);
  if (input.action === "status") return self.updated(self.formatStatus(), false);
  return self.updated(
    'Evidence mode accepts only "record_completion_checklist", "ready_to_finish", or "status".',
    false,
  );
}
