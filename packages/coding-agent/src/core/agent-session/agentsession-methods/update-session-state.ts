import {
  createInitialStructuredSessionState,
  createLiveStructuredSessionState,
  type EvidencePointer,
  getLatestStructuredSessionState,
  STRUCTURED_SESSION_STATE_CUSTOM_TYPE,
  type TouchedFile,
} from "../../compaction/index.ts";
import type { AgentSession } from "../agentsession.ts";
import { isInternalAgentMessage, reconcilePlanItemsForSuccessFinish } from "../message-utils.ts";
import type { UpdateSessionStateInput } from "../session-types.ts";

export function do__autoExecuteUpdateSessionState(self: AgentSession): void {
  if (!self._progressUpdateRequiredBeforeFinish && !self._stateUpdateRequiredForCurrentUserTurn) {
    return;
  }

  const branchEntries = self.sessionManager
    .getBranch()
    .filter((entry) => entry.type !== "message" || !isInternalAgentMessage(entry.message));
  const state = getLatestStructuredSessionState(branchEntries);
  const liveState = createLiveStructuredSessionState({
    sessionId: self.sessionManager.getSessionId(),
    previous: state ?? createInitialStructuredSessionState(self.sessionManager.getSessionId()),
    entries: branchEntries,
    timestamp: new Date().toISOString(),
  });
  const isNewTurn = self._stateUpdateRequiredForCurrentUserTurn;
  const action = isNewTurn ? (state?.canonicalRequest.current ? "replan" : "initial_plan") : "progress_update";
  const userGoal = liveState.canonicalRequest.current || state?.canonicalRequest.current || "";
  const existingPlan = (state?.plan ?? []).map((item) => ({ text: item.text, status: item.status }));
  const livePlan = (liveState.plan ?? []).map((item) => ({ text: item.text, status: item.status }));
  const fallbackPlan = userGoal.trim().length > 0 ? [{ text: userGoal.trim(), status: "in_progress" as const }] : [];
  const plan = existingPlan.length > 0 ? existingPlan : livePlan.length > 0 ? livePlan : fallbackPlan;

  const params: UpdateSessionStateInput = {
    action,
    goal: userGoal,
    plan,
    decisions: (state?.decisions ?? []).map((item) => ({ decision: item.decision, rationale: item.rationale })),
    risks: state?.audit.knownRisks ?? [],
    touchedFiles: (state?.codebase.touchedFiles ?? []).map((file: TouchedFile) => ({
      path: file.path,
      status: file.status,
      summary: file.summary,
    })),
    evidence: (state?.evidence ?? []).map((item: EvidencePointer) => ({
      kind: item.kind,
      summary: item.summary,
      path: item.path,
      retrieveWhen: item.retrieveWhen,
    })),
  };

  self._applyUpdateSessionState(params);
  self._progressUpdateRequiredBeforeFinish = false;
  self._stateUpdateRequiredForCurrentUserTurn = false;
}

export function do__reconcileSuccessfulFinishWorkState(self: AgentSession): void {
  const branchEntries = self.sessionManager.getBranch();
  const state = getLatestStructuredSessionState(branchEntries);
  if (!state) {
    return;
  }
  const reconciled = reconcilePlanItemsForSuccessFinish(state);
  if (!reconciled) {
    return;
  }
  self.sessionManager.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, reconciled);
}
