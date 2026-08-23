import type { AgentEvent } from "@dst0/p-agent-core";
import type { AssistantMessage } from "@dst0/p-ai";
import { stripSessionStateUpdateBlocks } from "../../compaction/index.ts";
import { filterSleepToolUseForHistory } from "../../messages.ts";
import type { AgentSession } from "../agentsession.ts";
import { UPDATE_SESSION_STATE_TOOL_NAME } from "../constants.ts";
import { isInternalCompletionProtocolRepairMessage } from "../message-utils.ts";
import { MAX_PROJECT_RULE_LINKS_PER_TURN, type ProjectRuleGate } from "../state-types.ts";

export async function handleAgentEvent(self: AgentSession, event: AgentEvent): Promise<void> {
  if (event.type === "turn_start" || event.type === "agent_end") {
    self._processingQueuedProjectRuleTurn = false;
  }
  const isInternalRepairEvent =
    (event.type === "message_start" || event.type === "message_end") &&
    isInternalCompletionProtocolRepairMessage(event.message);
  if (event.type === "message_start" && event.message.role === "user") {
    if (self._queuedProjectRuleGates.has(event.message)) {
      const queuedGate = self._queuedProjectRuleGates.get(event.message);
      self._queuedProjectRuleGates.delete(event.message);
      self._projectRuleGate = mergeProjectRuleGates(self._projectRuleGate, queuedGate, {
        preserveCurrentCandidates: true,
      });
    }
    self._processingQueuedProjectRuleTurn = true;
    self._overflowRecoveryAttempts = 0;
    const messageText = self._getUserMessageText(event.message);
    if (messageText) {
      const steeringIndex = self._steeringMessages.indexOf(messageText);
      if (steeringIndex !== -1) {
        self._steeringMessages.splice(steeringIndex, 1);
        self._emitQueueUpdate();
      } else {
        const followUpIndex = self._followUpMessages.indexOf(messageText);
        if (followUpIndex !== -1) {
          self._followUpMessages.splice(followUpIndex, 1);
          self._emitQueueUpdate();
        }
      }
    }
  }

  if (!isInternalRepairEvent) await self._emitExtensionEvent(event);

  let assistantStateUpdateText: string | undefined;
  if (event.type === "message_end" && event.message.role === "assistant") {
    assistantStateUpdateText = self._getAssistantMessageText(event.message);
    const strippedText = stripSessionStateUpdateBlocks(assistantStateUpdateText);
    if (strippedText !== assistantStateUpdateText) {
      self._replaceMessageInPlace(event.message, self._replaceAssistantMessageText(event.message, strippedText));
    }
  }

  const hideContextOverflowMessage =
    event.type === "message_end" &&
    event.message.role === "assistant" &&
    self._shouldHideContextOverflowMessage(event.message as AssistantMessage);

  if (!hideContextOverflowMessage && !isInternalRepairEvent) {
    self._emit(
      event.type === "agent_end"
        ? {
            ...event,
            messages: event.messages.filter((message) => !isInternalCompletionProtocolRepairMessage(message)),
            willRetry: self._willRetryAfterAgentEnd(event),
          }
        : event,
    );
  }

  if (event.type !== "message_end") return;

  let persistedEntryId: string | undefined;
  if (hideContextOverflowMessage) {
    // Overflow errors are internal recovery signals and must not enter retry context.
  } else if (event.message.role === "custom") {
    persistedEntryId = self.sessionManager.appendCustomMessageEntry(
      event.message.customType,
      event.message.content,
      event.message.display,
      event.message.details,
    );
  } else {
    const messageForHistory = filterSleepToolUseForHistory(event.message);
    if (
      messageForHistory &&
      (messageForHistory.role === "user" ||
        messageForHistory.role === "assistant" ||
        messageForHistory.role === "toolResult")
    ) {
      persistedEntryId = self.sessionManager.appendMessage(messageForHistory);
    }
  }

  if (event.message.role === "user" && !isInternalCompletionProtocolRepairMessage(event.message)) {
    self._stateUpdateRequiredForCurrentUserTurn = self.getActiveToolNames().includes(UPDATE_SESSION_STATE_TOOL_NAME);
    self._progressUpdateRequiredBeforeFinish = false;
    return;
  }
  if (event.message.role !== "assistant") return;

  self._lastAssistantMessage = event.message;
  if (assistantStateUpdateText && persistedEntryId) {
    self._applyAssistantSessionStateUpdate(assistantStateUpdateText, persistedEntryId);
  }

  const assistantMessage = event.message as AssistantMessage;
  if (assistantMessage.stopReason !== "error") self._overflowRecoveryAttempts = 0;
  if (assistantMessage.stopReason !== "error" && self._retryAttempt > 0) {
    self._emit({
      type: "auto_retry_end",
      success: true,
      attempt: self._retryAttempt,
    });
    self._retryAttempt = 0;
  }
}

export function mergeProjectRuleGates(
  current: ProjectRuleGate | undefined,
  incoming: ProjectRuleGate | undefined,
  options: { preserveCurrentCandidates?: boolean } = {},
): ProjectRuleGate | undefined {
  if (!incoming) return current;
  if (!current) return incoming;
  const preserveCurrentCandidates = options.preserveCurrentCandidates || (incoming.candidateLinks?.length ?? 0) === 0;
  const pendingCurrentBatches = current.batches.filter((batch) => !batch.satisfied);
  if (pendingCurrentBatches.length === 0 && !current.failure) {
    if (!preserveCurrentCandidates) return incoming;
    if (current.inputHash !== incoming.inputHash) {
      return changedProjectRuleGate(incoming, pendingCurrentBatches);
    }
    const candidateLinks = mergeQueuedProjectRuleCandidates(current, incoming, pendingCurrentBatches);
    return { ...incoming, candidateLinks };
  }
  if (current.inputHash !== incoming.inputHash) {
    return changedProjectRuleGate(incoming, pendingCurrentBatches);
  }
  return {
    inputHash: current.inputHash,
    batches: [...pendingCurrentBatches, ...incoming.batches],
    activeGeneration: incoming.activeGeneration,
    candidateLinks: preserveCurrentCandidates
      ? mergeQueuedProjectRuleCandidates(current, incoming, pendingCurrentBatches)
      : projectRuleCandidatesNotCovered(incoming.candidateLinks ?? [], pendingCurrentBatches),
    failure: current.failure ?? incoming.failure,
  };
}

function mergeQueuedProjectRuleCandidates(
  current: ProjectRuleGate,
  incoming: ProjectRuleGate,
  coveredBatches: ProjectRuleGate["batches"],
): string[] {
  const candidates = [...new Set([...(current.candidateLinks ?? []), ...(incoming.candidateLinks ?? [])])];
  return projectRuleCandidatesNotCovered(candidates, coveredBatches);
}

function projectRuleCandidatesNotCovered(candidates: string[], coveredBatches: ProjectRuleGate["batches"]): string[] {
  const coveredLinks = new Set(coveredBatches.flatMap((batch) => batch.links));
  return candidates.filter((link) => !coveredLinks.has(link)).slice(0, MAX_PROJECT_RULE_LINKS_PER_TURN);
}

function changedProjectRuleGate(
  incoming: ProjectRuleGate,
  pendingCurrentBatches: ProjectRuleGate["batches"],
): ProjectRuleGate {
  return {
    inputHash: incoming.inputHash,
    batches: [...pendingCurrentBatches, ...incoming.batches],
    activeGeneration: incoming.activeGeneration,
    candidateLinks: incoming.candidateLinks,
    failure:
      "Project instruction routes changed while queued requests were being combined. Reload before mutating work.",
  };
}
