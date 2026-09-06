import type { AgentMessage } from "@dst0/p-agent-core";
import {
  frozenSourceOutputRestoreError,
  promptCanRecoverStaleSourceOutputAuthorization,
} from "../critical-proof-source-output-revalidation.ts";
import { reconcileCriticalProofAfterPrompt } from "../evidence-critical-proof-observation.ts";
import { emptyReadiness, emptyRequirementAudit } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { isRecord } from "../tool-classification.ts";
import { retainedCriticalProofSourceOutputs } from "./critical-proof-source-output.ts";
import { isNonRequirementNudge } from "./non-requirement-nudge.ts";

export function captureUserPrompt(
  self: TaskVerificationController,
  message: Extract<AgentMessage, { role: "user" }>,
): void {
  if (isRecord(message.metadata) && message.metadata.pInternal !== undefined) return;
  const promptText = userMessageText(message);
  if (!promptText.trim()) return;
  self.latestUserPrompt = promptText;
  if (self.restoreError && !promptCanRecoverStaleSourceOutputAuthorization(self, promptText)) return;
  const taskPrompts = self.state.taskPrompts ?? [];
  if (isNonRequirementNudge(promptText, taskPrompts)) return;
  const activeRejectedDraft = self.rejectedRequirementDefinitionDraft;
  const persistedId = [...self.sessionManager.getBranch()]
    .reverse()
    .find(
      (entry) =>
        entry.type === "message" &&
        entry.message.role === "user" &&
        entry.message.timestamp === message.timestamp &&
        userMessageText(entry.message) === promptText,
    )?.id;
  const nextTaskPrompts = [
    ...taskPrompts,
    {
      id: persistedId ?? `user-${message.timestamp}-${taskPrompts.length + 1}`,
      text: promptText,
    },
  ];
  const criticalProof = reconcileCriticalProofAfterPrompt(self, nextTaskPrompts);
  const selectedCriticalProofPaths = new Set((criticalProof.selections ?? []).map((selection) => selection.sourcePath));
  self.state = {
    ...self.state,
    taskKind: self.mode === "evidence" ? undefined : self.state.taskKind,
    taskSummary: self.mode === "evidence" ? undefined : self.state.taskSummary,
    requirementDefinitionPolicy:
      self.mode === "audit"
        ? (self.state.requirementDefinitionPolicy ?? (self.state.mutationRevision > 0 ? 1 : undefined))
        : undefined,
    taskPrompts: nextTaskPrompts,
    completionChecklist: undefined,
    criticalProofObligations: criticalProof.obligations,
    criticalProofObligationOverflow: criticalProof.overflow,
    criticalProofDiscoveryFailures: criticalProof.failures,
    criticalProofSourceSelections: criticalProof.selections,
    criticalProofSourceOutputs: retainedCriticalProofSourceOutputs(
      self.state.criticalProofSourceOutputs,
      selectedCriticalProofPaths,
    ),
    final: { status: "pending", evidenceRefs: [], unresolvedFailures: [] },
    readiness: emptyReadiness(),
    requirementAudit:
      self.mode === "audit"
        ? activeRejectedDraft
          ? self.state.requirementAudit
          : emptyRequirementAudit()
        : self.state.requirementAudit,
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  const sourceOutputError = frozenSourceOutputRestoreError(self);
  if (sourceOutputError) self.restoreError = sourceOutputError;
}

function userMessageText(message: Extract<AgentMessage, { role: "user" }>): string {
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
}
