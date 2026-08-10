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

export async function do_compact(self: AgentSession, customInstructions?: string): Promise<CompactionResult> {
  self._disconnectFromAgent();
  await self.abort();
  self._compactionAbortController = new AbortController();
  self._emit({ type: "compaction_start", reason: "manual" });

  try {
    const pathEntries = self.sessionManager.getBranch();
    const settings = self._getEffectiveCompactionSettings();

    const preparationResult = prepareCompaction(pathEntries, settings, self.systemPrompt);
    if (!preparationResult.ok) {
      throw new Error(preparationResult.message);
    }
    const { preparation } = preparationResult;

    let extensionCompaction: CompactionResult | undefined;
    let fromExtension = false;

    if (self._extensionRunner.hasHandlers("session_before_compact")) {
      const result = (await self._extensionRunner.emit({
        type: "session_before_compact",
        preparation,
        branchEntries: pathEntries,
        customInstructions,
        signal: self._compactionAbortController.signal,
      })) as SessionBeforeCompactResult | undefined;

      if (result?.cancel) {
        throw new Error("Compaction cancelled");
      }

      if (result?.compaction) {
        extensionCompaction = result.compaction;
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
      const result = await self._prepareDefaultCompaction(
        preparation,
        pathEntries,
        settings,
        customInstructions,
        self._compactionAbortController.signal,
      );
      summary = result.summary;
      firstKeptEntryId = result.firstKeptEntryId;
      tokensBefore = result.tokensBefore;
      tokensAfter = result.tokensAfter;
      details = result.details;
      structuredState = result.state;
    }

    if (self._compactionAbortController.signal.aborted) {
      throw new Error("Compaction cancelled");
    }

    self.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, tokensAfter, details, fromExtension);
    if (!fromExtension && structuredState && isStructuredSessionState(structuredState)) {
      self.sessionManager.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, structuredState);
    }
    const newEntries = self.sessionManager.getEntries();
    const sessionContext = self.sessionManager.buildSessionContext();

    // Post-compaction truncation: truncate oversized kept messages
    const systemPromptTokens = self.systemPrompt ? Math.ceil(self.systemPrompt.length / 4) : 0;
    const truncatedMessages = truncateKeptMessages(sessionContext.messages, {
      keepRecentTokens: preparation.keepRecentTokens,
      targetContextTokens: settings.targetContextTokens,
      systemPromptTokens,
    });
    self.agent.state.messages = truncatedMessages;
    const tokensAfterManual = estimateContextTokens(truncatedMessages, self.systemPrompt, {
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

    const compactionResult = {
      summary,
      firstKeptEntryId,
      tokensBefore,
      tokensAfter: tokensAfterManual,
      details,
    };
    self._emit({
      type: "compaction_end",
      reason: "manual",
      result: compactionResult,
      aborted: false,
      willRetry: false,
    });
    return compactionResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = message === "Compaction cancelled" || (error instanceof Error && error.name === "AbortError");
    self._emit({
      type: "compaction_end",
      reason: "manual",
      result: undefined,
      aborted,
      willRetry: false,
      errorMessage: aborted ? undefined : `Compaction failed: ${message}`,
    });
    throw error;
  } finally {
    self._compactionAbortController = undefined;
    self._reconnectToAgent();
  }
}

export function do_abortCompaction(self: AgentSession): void {
  self._compactionAbortController?.abort();
  self._autoCompactionAbortController?.abort();
}
