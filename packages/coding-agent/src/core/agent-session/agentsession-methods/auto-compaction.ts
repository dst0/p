import type { AssistantMessage } from "@dst0/p-ai";
import {
  type CompactionResult,
  estimateContextTokens,
  isStructuredSessionState,
  prepareCompaction,
  STRUCTURED_SESSION_STATE_CUSTOM_TYPE,
  truncateKeptMessages,
} from "../../compaction/index.ts";
import type { SessionBeforeCompactResult } from "../../extensions/index.ts";
import type { CompactionEntry } from "../../session-manager.ts";
import type { AgentSession } from "../agentsession.ts";

export async function do__runAutoCompaction(
  self: AgentSession,
  reason: "overflow" | "threshold",
  willRetry: boolean,
): Promise<boolean> {
  const settings = self._getEffectiveCompactionSettings();

  try {
    const hadQueuedMessages = self.agent.hasQueuedMessages();
    const pathEntries = self.sessionManager.getBranch();
    const retryUserEntry = willRetry
      ? [...pathEntries].reverse().find((entry) => entry.type === "message" && entry.message.role === "user")
      : undefined;
    const retryContinuationMessage =
      willRetry && retryUserEntry?.type === "message" ? retryUserEntry.message : undefined;

    const preparationResult = prepareCompaction(pathEntries, settings, self.systemPrompt);
    if (!preparationResult.ok) {
      if (reason === "threshold") {
        return false;
      }
      self._emit({ type: "compaction_start", reason });
      self._emit({
        type: "compaction_end",
        reason,
        result: undefined,
        aborted: false,
        willRetry: false,
        errorMessage:
          reason === "overflow"
            ? `Context overflow recovery failed: ${preparationResult.message}`
            : `Auto-compaction skipped: ${preparationResult.message}`,
      });
      return false;
    }
    const { preparation } = preparationResult;
    self._emit({ type: "compaction_start", reason });
    self._autoCompactionAbortController = new AbortController();

    let extensionCompaction: CompactionResult | undefined;
    let fromExtension = false;

    if (self._extensionRunner.hasHandlers("session_before_compact")) {
      const extensionResult = (await self._extensionRunner.emit({
        type: "session_before_compact",
        preparation,
        branchEntries: pathEntries,
        customInstructions: undefined,
        signal: self._autoCompactionAbortController.signal,
      })) as SessionBeforeCompactResult | undefined;

      if (extensionResult?.cancel) {
        self._emit({
          type: "compaction_end",
          reason,
          result: undefined,
          aborted: true,
          willRetry: false,
        });
        return false;
      }

      if (extensionResult?.compaction) {
        extensionCompaction = extensionResult.compaction;
        fromExtension = true;
      }
    }

    let summary: string;
    let firstKeptEntryId: string;
    let tokensBefore: number;
    let tokensAfter: number | undefined;
    let details: unknown;
    let structuredState: unknown;

    if (extensionCompaction) {
      // Extension provided compaction content
      summary = extensionCompaction.summary;
      firstKeptEntryId = extensionCompaction.firstKeptEntryId;
      tokensBefore = extensionCompaction.tokensBefore;
      tokensAfter = extensionCompaction.tokensAfter;
      details = extensionCompaction.details;
    } else {
      const compactResult = await self._prepareDefaultCompaction(
        preparation,
        pathEntries,
        settings,
        undefined,
        self._autoCompactionAbortController.signal,
      );
      summary = compactResult.summary;
      firstKeptEntryId = compactResult.firstKeptEntryId;
      tokensBefore = compactResult.tokensBefore;
      tokensAfter = compactResult.tokensAfter;
      details = compactResult.details;
      structuredState = compactResult.state;
    }

    if (self._autoCompactionAbortController.signal.aborted) {
      self._emit({
        type: "compaction_end",
        reason,
        result: undefined,
        aborted: true,
        willRetry: false,
      });
      return false;
    }

    self.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, tokensAfter, details, fromExtension);
    if (!fromExtension && structuredState && isStructuredSessionState(structuredState)) {
      self.sessionManager.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, structuredState);
    }
    const newEntries = self.sessionManager.getEntries();
    const sessionContext = self.sessionManager.buildSessionContext();
    const retryContinuationIndex = retryContinuationMessage
      ? sessionContext.messages.indexOf(retryContinuationMessage)
      : -1;

    // Post-compaction truncation: truncate oversized kept messages to enforce
    // the keepRecentTokens budget (last 20 lines / max 4K tokens per message).
    // This is critical for preventing large tool results from surviving compaction.
    const systemPromptTokens = self.systemPrompt ? Math.ceil(self.systemPrompt.length / 4) : 0;
    const truncatedMessages = truncateKeptMessages(sessionContext.messages, {
      keepRecentTokens: preparation.keepRecentTokens,
      targetContextTokens: settings.targetContextTokens,
      systemPromptTokens,
    });
    if (retryContinuationMessage) {
      if (retryContinuationIndex >= 0) truncatedMessages[retryContinuationIndex] = retryContinuationMessage;
      else truncatedMessages.push(retryContinuationMessage);
    }
    const retryMessagesWithoutOverflow = self._removeContextOverflowMessages(truncatedMessages);
    self.agent.state.messages = retryMessagesWithoutOverflow;
    const tokensAfterAuto = estimateContextTokens(retryMessagesWithoutOverflow, self.systemPrompt, {
      useProviderUsage: false,
    }).tokens;

    // Get the saved compaction entry for the extension event
    const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary) as
      | CompactionEntry
      | undefined;

    if (self._extensionRunner && savedCompactionEntry) {
      await self._extensionRunner.emit({
        type: "session_compact",
        compactionEntry: savedCompactionEntry,
        fromExtension,
      });
    }

    const result: CompactionResult = {
      summary,
      firstKeptEntryId,
      tokensBefore,
      tokensAfter: tokensAfterAuto,
      details,
    };
    self._emit({
      type: "compaction_end",
      reason,
      result,
      aborted: false,
      willRetry,
    });

    if (willRetry) {
      const messages = self.agent.state.messages;
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "assistant" && (lastMsg as AssistantMessage).stopReason === "error") {
        self.agent.state.messages = messages.slice(0, -1);
      }
      return true;
    }

    // Auto-compaction can complete while follow-up/steering/custom messages are waiting.
    // Continue once so queued messages are delivered.
    return hadQueuedMessages || self.agent.hasQueuedMessages();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "compaction failed";
    self._emit({
      type: "compaction_end",
      reason,
      result: undefined,
      aborted: false,
      willRetry: false,
      errorMessage:
        reason === "overflow"
          ? `Context overflow recovery failed: ${errorMessage}`
          : `Auto-compaction failed: ${errorMessage}`,
    });
    return false;
  } finally {
    self._autoCompactionAbortController = undefined;
  }
}
