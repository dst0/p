import { emptyReadiness, emptyRequirementAudit, emptyState } from "./state-factories.ts";
import type { TaskVerificationController } from "./taskverificationcontroller.ts";

export function reconcileTaskVerificationModeState(self: TaskVerificationController, hasPersistedState: boolean): void {
  if (!hasPersistedState) {
    self.state = emptyState(undefined, self.mode);
    return;
  }
  if (self.mode === "off") {
    self.state = { ...self.state, mode: "off" };
    return;
  }
  if (self.mode === "audit") {
    if (self.state.mode === "evidence" && self.state.mutationRevision > 0) {
      self.restoreError =
        "task verification mode changed from evidence to audit during an active mutating task; start a new task before using semantic audit";
    }
    self.state = { ...self.state, mode: "audit" };
    return;
  }

  const sameMode = self.state.mode === "evidence";
  self.rejectedRequirementDefinitionDraft = undefined;
  self.requirementSourceTexts.clear();
  self.state = {
    ...self.state,
    mode: "evidence",
    taskKind: undefined,
    taskSummary: undefined,
    taskContext: undefined,
    requirementSourceRefs: undefined,
    ignoredRequirementSources: undefined,
    requirementDefinitionPolicy: undefined,
    requirementDefinitionRepairPending: undefined,
    rejectedRequirementDefinitionDraft: undefined,
    baseline: {
      required: false,
      status: "not_required",
      evidenceRefs: [],
      authorizedTestPaths: [],
      testSetupChanged: false,
    },
    final: { status: "pending", evidenceRefs: [], unresolvedFailures: [] },
    readiness: sameMode ? (self.state.readiness ?? emptyReadiness()) : emptyReadiness(),
    requirementAudit: emptyRequirementAudit(),
  };
}
