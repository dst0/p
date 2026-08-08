import type { AgentMessage, StreamFn, ThinkingLevel } from "@dst0/p-agent-core";
import type { Model } from "@dst0/p-ai";
import { convertToLlm } from "../../messages.ts";
import {
  computeFileLists,
  formatFileOperations,
  SUMMARIZATION_SYSTEM_PROMPT,
  serializeConversation,
} from "../utils.ts";
import { stubToolResultsForCompactionSummary } from "./compaction-prompt.ts";
import { TURN_PREFIX_SUMMARIZATION_PROMPT } from "./constants.ts";
import { summarizeInChunks } from "./default-compaction.ts";
import { resolveCompactionSettings } from "./message-selection.ts";
import type { CompactionAudit, CompactionDetails, CompactionPreparation, CompactionResult } from "./types.ts";
import { completeSummarization, createSummarizationOptions } from "./window-calculation.ts";

export async function generateTurnPrefixSummary(
  messages: AgentMessage[],
  model: Model<any>,
  summaryMaxTokens: number,
  apiKey: string | undefined,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  thinkingLevel?: ThinkingLevel,
  streamFn?: StreamFn,
): Promise<string> {
  const maxTokens = Math.min(
    Math.floor(0.5 * summaryMaxTokens),
    model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
  ); // Smaller budget for turn prefix
  const llmMessages = convertToLlm(messages);
  const conversationText = serializeConversation(llmMessages);
  const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`;
  const summarizationMessages = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: promptText }],
      timestamp: Date.now(),
    },
  ];

  const response = await completeSummarization(
    model,
    {
      systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
      messages: summarizationMessages,
    },
    createSummarizationOptions(model, maxTokens, apiKey, headers, signal, thinkingLevel),
    streamFn,
  );

  if (response.stopReason === "error") {
    throw new Error(`Turn prefix summarization failed: ${response.errorMessage || "Unknown error"}`);
  }

  return response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export async function compact(
  preparation: CompactionPreparation,
  model: Model<any>,
  apiKey: string | undefined,
  headers?: Record<string, string>,
  customInstructions?: string,
  signal?: AbortSignal,
  thinkingLevel?: ThinkingLevel,
  streamFn?: StreamFn,
  onProgress?: (currentChunk: number, totalChunks: number) => void,
): Promise<CompactionResult> {
  const {
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn,
    tokensBefore,
    previousSummary,
    fileOps,
    settings,
    recentRawTokens,
    droppedEntryIds,
    systemPromptTokens,
  } = preparation;
  const resolvedSettings = resolveCompactionSettings(settings);
  const historyPromptContext = stubToolResultsForCompactionSummary(messagesToSummarize);
  const turnPrefixPromptContext = stubToolResultsForCompactionSummary(turnPrefixMessages);
  const stubbedToolResults = [
    ...new Set([
      ...historyPromptContext.stubs.map((stub) => stub.rawPointer.id),
      ...turnPrefixPromptContext.stubs.map((stub) => stub.rawPointer.id),
    ]),
  ];
  const toolRawTokens = historyPromptContext.toolRawTokens + turnPrefixPromptContext.toolRawTokens;
  const toolStubTokens = historyPromptContext.toolStubTokens + turnPrefixPromptContext.toolStubTokens;

  // Generate summaries (can be parallel if both needed) and merge into one
  let summary: string;

  if (isSplitTurn && turnPrefixPromptContext.messages.length > 0) {
    // Generate both summaries in parallel
    const [historyResult, turnPrefixResult] = await Promise.all([
      historyPromptContext.messages.length > 0
        ? summarizeInChunks(
            historyPromptContext.messages,
            model,
            resolvedSettings.summaryMaxTokens,
            apiKey,
            headers,
            signal,
            customInstructions,
            previousSummary,
            thinkingLevel,
            streamFn,
            onProgress,
          )
        : Promise.resolve(previousSummary || "No prior history."),
      generateTurnPrefixSummary(
        turnPrefixPromptContext.messages,
        model,
        resolvedSettings.summaryMaxTokens,
        apiKey,
        headers,
        signal,
        thinkingLevel,
        streamFn,
      ),
    ]);
    // Merge into single summary
    summary = `${historyResult}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult}`;
  } else {
    // Just generate history summary
    summary = await summarizeInChunks(
      historyPromptContext.messages,
      model,
      resolvedSettings.summaryMaxTokens,
      apiKey,
      headers,
      signal,
      customInstructions,
      previousSummary,
      thinkingLevel,
      streamFn,
      onProgress,
    );
  }

  // Compute file lists and append to summary
  const { readFiles, modifiedFiles } = computeFileLists(fileOps);
  summary += formatFileOperations(readFiles, modifiedFiles);
  const summaryTokens = Math.ceil(summary.length / 4);
  const afterTokens = systemPromptTokens + summaryTokens + recentRawTokens;
  const audit: CompactionAudit = {
    beforeTokens: tokensBefore,
    afterTokens,
    savedTokens: Math.max(0, tokensBefore - afterTokens),
    summaryTokens,
    renderedStateTokens: Math.min(summaryTokens, resolvedSettings.renderedStateMaxTokens),
    recentRawTokens,
    toolRawTokens,
    toolStubTokens,
    droppedEntries: droppedEntryIds,
    stubbedToolResults,
    risks: afterTokens > resolvedSettings.targetContextTokens ? ["post-compaction context exceeds target"] : [],
  };

  if (!firstKeptEntryId) {
    throw new Error("First kept entry has no UUID - session may need migration");
  }

  return {
    summary,
    firstKeptEntryId,
    tokensBefore,
    details: { readFiles, modifiedFiles, audit } as CompactionDetails,
  };
}
