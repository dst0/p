import type { AgentMessage } from "@dst0/p-agent-core";
import { reconcileCriticalProofAfterPrompt } from "../evidence-critical-proof-observation.ts";
import { emptyReadiness, emptyRequirementAudit } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { isRecord } from "../tool-classification.ts";
import { isNonRequirementNudge } from "./non-requirement-nudge.ts";

export function captureUserPrompt(
  self: TaskVerificationController,
  message: Extract<AgentMessage, { role: "user" }>,
): void {
  if (isRecord(message.metadata) && message.metadata.pInternal !== undefined) return;
  const promptText = userMessageText(message);
  if (!promptText.trim()) return;
  self.latestUserPrompt = promptText;
  if (self.restoreError) return;
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
  self.state = {
    ...self.state,
    requirementDefinitionPolicy:
      self.mode === "audit"
        ? (self.state.requirementDefinitionPolicy ?? (self.state.mutationRevision > 0 ? 1 : undefined))
        : undefined,
    taskPrompts: nextTaskPrompts,
    completionChecklist: undefined,
    criticalProofObligations: criticalProof.obligations,
    criticalProofObligationOverflow: criticalProof.overflow,
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
}

function userMessageText(message: Extract<AgentMessage, { role: "user" }>): string {
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
}
