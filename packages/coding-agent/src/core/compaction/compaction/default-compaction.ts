import type { AgentMessage, StreamFn, ThinkingLevel } from "@dst0/p-agent-core";
import type { Model } from "@dst0/p-ai";
import { buildSessionContext, type CompactionEntry, type SessionEntry } from "../../session-manager.ts";
import { extractFileOpsFromMessage } from "../utils.ts";
import {
  estimateTokens,
  extractFileOperations,
  getMessageFromEntry,
  getMessageFromEntryForCompaction,
  hasMeaningfulUserRequest,
} from "./message-selection.ts";
import { estimateContextTokens, selectKeepRecentTokens } from "./token-counting.ts";
import type { CompactionPreparationResult, CompactionSettings } from "./types.ts";
import { findCutPoint, generateSummary, isAlreadyCompactedBoundary } from "./window-calculation.ts";

export function prepareCompaction(
  pathEntries: SessionEntry[],
  settings: CompactionSettings,
  systemPrompt?: string,
): CompactionPreparationResult {
  if (pathEntries.length === 0) {
    return {
      ok: false,
      message: "Nothing to compact (session branch has no entries)",
      reason: "empty_session",
    };
  }

  if (isAlreadyCompactedBoundary(pathEntries)) {
    return {
      ok: false,
      message: "Already compacted (latest session entry is a compaction boundary)",
      reason: "already_compacted",
    };
  }

  if (!hasMeaningfulUserRequest(pathEntries)) {
    return {
      ok: false,
      message: "Nothing to compact (no user request has been recorded in this session branch)",
      reason: "no_user_request",
    };
  }

  let prevCompactionIndex = -1;
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    if (pathEntries[i].type === "compaction") {
      prevCompactionIndex = i;
      break;
    }
  }

  let previousSummary: string | undefined;
  let boundaryStart = 0;
  if (prevCompactionIndex >= 0) {
    const prevCompaction = pathEntries[prevCompactionIndex] as CompactionEntry;
    previousSummary = prevCompaction.summary;
    const firstKeptEntryIndex = pathEntries.findIndex((entry) => entry.id === prevCompaction.firstKeptEntryId);
    boundaryStart = firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : prevCompactionIndex + 1;
  }
  const boundaryEnd = pathEntries.length;

  const systemPromptTokens = systemPrompt ? Math.ceil(systemPrompt.length / 4) : 0;
  const tokensBefore = estimateContextTokens(buildSessionContext(pathEntries).messages, systemPrompt).tokens;
  const keepRecentTokens = selectKeepRecentTokens(tokensBefore, settings);

  const cutPoint = findCutPoint(pathEntries, boundaryStart, boundaryEnd, keepRecentTokens);

  // Get UUID of first kept entry
  const firstKeptEntry = pathEntries[cutPoint.firstKeptEntryIndex];
  if (!firstKeptEntry?.id) {
    return {
      ok: false,
      message: "Missing entry ID (session likely needs migration)",
      reason: "missing_kept_entry_id",
      tokensBefore,
    };
  }
  const firstKeptEntryId = firstKeptEntry.id;

  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;

  // Messages to summarize (will be discarded after summary)
  const messagesToSummarize: AgentMessage[] = [];
  let tokensToSummarize = 0;
  const droppedEntryIds: string[] = [];
  for (let i = boundaryStart; i < historyEnd; i++) {
    const msg = getMessageFromEntryForCompaction(pathEntries[i]);
    if (msg) {
      messagesToSummarize.push(msg);
      tokensToSummarize += estimateTokens(msg);
    }
    if (pathEntries[i].id) {
      droppedEntryIds.push(pathEntries[i].id);
    }
  }

  // Abort compaction if we are discarding less than 500 tokens of history.
  // Summaries themselves cost ~500-1000 tokens, but the main benefit of compaction
  // is also truncating oversized kept messages via post-compaction truncation.
  if (tokensToSummarize < 500 && tokensBefore <= keepRecentTokens * 1.25) {
    return {
      ok: false,
      message: `History to summarize is too small (only ${tokensToSummarize} tokens) and total session size (${tokensBefore}) is not significantly over budget`,
      reason: "too_little_history",
      tokensToSummarize,
      tokensBefore,
    };
  }

  // Messages for turn prefix summary (if splitting a turn)
  const turnPrefixMessages: AgentMessage[] = [];
  if (cutPoint.isSplitTurn) {
    for (let i = cutPoint.turnStartIndex; i < cutPoint.firstKeptEntryIndex; i++) {
      const msg = getMessageFromEntryForCompaction(pathEntries[i]);
      if (msg) turnPrefixMessages.push(msg);
    }
  }

  // Extract file operations from messages and previous compaction
  const fileOps = extractFileOperations(messagesToSummarize, pathEntries, prevCompactionIndex);

  // Also extract file ops from turn prefix if splitting
  if (cutPoint.isSplitTurn) {
    for (const msg of turnPrefixMessages) {
      extractFileOpsFromMessage(msg, fileOps);
    }
  }

  let recentRawTokens = 0;
  for (let i = cutPoint.firstKeptEntryIndex; i < boundaryEnd; i++) {
    const msg = getMessageFromEntry(pathEntries[i]);
    if (msg) {
      recentRawTokens += estimateTokens(msg);
    }
  }

  return {
    ok: true,
    preparation: {
      firstKeptEntryId,
      messagesToSummarize,
      turnPrefixMessages,
      isSplitTurn: cutPoint.isSplitTurn,
      tokensBefore,
      previousSummary,
      fileOps,
      settings,
      keepRecentTokens,
      tokensToSummarize,
      recentRawTokens,
      droppedEntryIds,
      systemPromptTokens,
    },
  };
}

export async function summarizeInChunks(
  messages: AgentMessage[],
  model: Model<any>,
  summaryMaxTokens: number,
  apiKey: string | undefined,
  headers: Record<string, string> | undefined,
  signal: AbortSignal | undefined,
  customInstructions: string | undefined,
  initialSummary: string | undefined,
  thinkingLevel: ThinkingLevel | undefined,
  streamFn: StreamFn | undefined,
  onProgress?: (currentChunk: number, totalChunks: number) => void,
): Promise<string> {
  const maxOutputTokens = Math.min(summaryMaxTokens, model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY);

  // Calculate safe chunk tokens based on model context window.
  // We need space for the system prompt, maxOutputTokens, previous summary (which can be up to maxOutputTokens), and overhead.
  const safeChunkTokens = Math.max(4000, model.contextWindow - maxOutputTokens * 2 - 2000);

  const chunks: AgentMessage[][] = [];
  let currentChunk: AgentMessage[] = [];
  let currentTokens = 0;

  for (const msg of messages) {
    const msgTokens = estimateTokens(msg);
    if (currentChunk.length > 0 && currentTokens + msgTokens > safeChunkTokens) {
      chunks.push(currentChunk);
      currentChunk = [msg];
      currentTokens = msgTokens;
    } else {
      currentChunk.push(msg);
      currentTokens += msgTokens;
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  if (chunks.length === 0) {
    return await generateSummary(
      [],
      model,
      summaryMaxTokens,
      apiKey,
      headers,
      signal,
      customInstructions,
      initialSummary,
      thinkingLevel,
      streamFn,
    );
  }

  let currentSummary = initialSummary;
  let i = 0;
  while (i < chunks.length) {
    const chunk = chunks[i];
    try {
      onProgress?.(i + 1, chunks.length);
      currentSummary = await generateSummary(
        chunk,
        model,
        summaryMaxTokens,
        apiKey,
        headers,
        signal,
        customInstructions,
        currentSummary,
        thinkingLevel,
        streamFn,
      );
      i++;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isOverflow =
        errorMsg.match(/exceeds the available context size/i) ||
        errorMsg.match(/context window/i) ||
        errorMsg.match(/too many tokens/i) ||
        errorMsg.match(/prompt is too long/i) ||
        errorMsg.match(/exceeds the limit/i) ||
        errorMsg.match(/maximum context length/i) ||
        errorMsg.match(/502 error sending request for url/i) ||
        errorMsg.match(/502 Bad Gateway/i);

      if (isOverflow && chunk.length > 1) {
        const mid = Math.floor(chunk.length / 2);
        chunks.splice(i, 1, chunk.slice(0, mid), chunk.slice(mid));
        // Loop continues at same 'i' to process the first half
      } else {
        throw error;
      }
    }
  }

  return currentSummary || "No prior history.";
}
