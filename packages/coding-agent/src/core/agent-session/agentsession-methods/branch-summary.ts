import type { AgentMessage } from "@dst0/p-agent-core";
import type { AssistantMessage } from "@dst0/p-ai";
import { estimateContextTokens, shouldCompact } from "../../compaction/index.ts";
import { getLatestCompactionEntry } from "../../session-manager.ts";
import type { AgentSession } from "../agentsession.ts";
import { MAX_OVERFLOW_RECOVERY_COMPACTIONS } from "../constants.ts";

export function do_abortBranchSummary(self: AgentSession): void {
  self._branchSummaryAbortController?.abort();
}

export async function do_checkCompaction(
  self: AgentSession,
  assistantMessage: AssistantMessage | undefined,
  skipAbortedCheck = true,
  additionalMessages?: AgentMessage[],
): Promise<boolean> {
  const settings = self._getEffectiveCompactionSettings();
  if (!settings.enabled) return false;

  // Skip if message was aborted (user cancelled) - unless skipAbortedCheck is false
  if (assistantMessage && skipAbortedCheck && assistantMessage.stopReason === "aborted") return false;

  const contextWindow = self.model?.contextWindow ?? 0;

  // Skip compaction checks if this assistant message is older than the latest
  // compaction boundary. This prevents a stale pre-compaction usage/error
  // from retriggering compaction on the first prompt after compaction.
  const branchEntries = self.sessionManager.getBranch();
  const compactionEntry = getLatestCompactionEntry(branchEntries);
  const assistantIsFromBeforeCompaction =
    assistantMessage &&
    compactionEntry !== null &&
    assistantMessage.timestamp <= new Date(compactionEntry.timestamp).getTime();
  if (assistantIsFromBeforeCompaction && !additionalMessages) {
    return false;
  }
  const assistantForCompactionCheck = assistantIsFromBeforeCompaction ? undefined : assistantMessage;

  // Case 1: Overflow - LLM returned context overflow error
  if (assistantForCompactionCheck && self._isContextOverflowForCurrentModel(assistantForCompactionCheck)) {
    if (self._overflowRecoveryAttempts >= MAX_OVERFLOW_RECOVERY_COMPACTIONS) {
      self._emit({
        type: "compaction_end",
        reason: "overflow",
        result: undefined,
        aborted: false,
        willRetry: false,
        errorMessage: `Context overflow recovery failed after ${MAX_OVERFLOW_RECOVERY_COMPACTIONS} compact-and-retry attempts. Try reducing context or switching to a larger-context model.`,
      });
      return false;
    }

    self._overflowRecoveryAttempts += 1;
    // Remove the error message from agent state (it IS saved to session for history,
    // but we don't want it in context for the retry)
    const stateMessages = self.agent.state.messages;
    if (stateMessages.length > 0 && stateMessages[stateMessages.length - 1].role === "assistant") {
      self.agent.state.messages = stateMessages.slice(0, -1);
    }
    return await self._runAutoCompaction("overflow", true);
  }

  // Case 2: Threshold - context is getting large. This must be based on
  // the current prompt state, not historical provider usage persisted on
  // assistant messages that may have survived a compaction boundary.
  const messages = self._getEffectiveCompactedMessages().slice();
  if (additionalMessages) {
    messages.push(...additionalMessages);
  }

  const promptContext = self._preparePromptContext(messages);
  const compactionTimestamp = compactionEntry ? new Date(compactionEntry.timestamp).getTime() : undefined;
  const providerEstimate = estimateContextTokens(messages, self.systemPrompt, {
    sinceTimestamp: compactionTimestamp,
  });
  let reliableAssistantUsagesSinceCompaction = 0;
  if (compactionTimestamp !== undefined) {
    for (const message of messages) {
      if (
        message.role === "assistant" &&
        message.stopReason !== "aborted" &&
        message.stopReason !== "error" &&
        message.usage &&
        (message.usage.input > 0 || message.usage.cacheRead > 0) &&
        message.timestamp > compactionTimestamp
      ) {
        reliableAssistantUsagesSinceCompaction++;
      }
    }
  }
  const canUseProviderUsageForThreshold =
    compactionTimestamp === undefined ||
    reliableAssistantUsagesSinceCompaction > 1 ||
    assistantForCompactionCheck?.stopReason === "error";
  const contextTokens =
    canUseProviderUsageForThreshold && providerEstimate.lastUsageIndex !== null
      ? Math.max(promptContext.budgetEstimate.tokens, providerEstimate.usageTokens + providerEstimate.trailingTokens)
      : promptContext.budgetEstimate.tokens;
  const hasRecordedUserRequest = branchEntries.some(
    (entry) => entry.type === "message" && entry.message.role === "user",
  );
  if (shouldCompact(contextTokens, contextWindow, settings)) {
    if (!hasRecordedUserRequest) {
      return false;
    }
    return await self._runAutoCompaction("threshold", false);
  }
  return false;
}
