import { emptyState } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";

export function resetAfterSuccessfulCompletion(self: TaskVerificationController): void {
  self.rejectedRequirementDefinitionDraft = undefined;
  self.state = emptyState(undefined, self.mode);
  self.evidence.clear();
  self.bashFingerprints.clear();
  self.testMutationReservations.clear();
  self.testVerificationStarts.clear();
  self.workspaceTestSnapshots.clear();
  self.workspaceSourceSnapshots.clear();
  self.activeMutationAttempts.clear();
  self.requirementSourceTexts.clear();
  self.latestUserPrompt = "";
  self.persistState();
}
