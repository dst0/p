import type { AgentEvent } from "@dst0/p-agent-core";
import type { AssistantMessage } from "@dst0/p-ai";
import { stripSessionStateUpdateBlocks } from "../../compaction/index.ts";
import { filterSleepToolUseForHistory } from "../../messages.ts";
import type { AgentSession } from "../agentsession.ts";
import { UPDATE_SESSION_STATE_TOOL_NAME } from "../constants.ts";
import { isInternalCompletionProtocolRepairMessage } from "../message-utils.ts";

export async function handleAgentEvent(self: AgentSession, event: AgentEvent): Promise<void> {
  const isInternalRepairEvent =
    (event.type === "message_start" || event.type === "message_end") &&
    isInternalCompletionProtocolRepairMessage(event.message);
  if (event.type === "message_start" && event.message.role === "user") {
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
