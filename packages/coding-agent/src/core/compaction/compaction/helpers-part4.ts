import type { AgentMessage, StreamFn, ThinkingLevel } from "@dst0/p-agent-core";
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "@dst0/p-ai";
import { completeSimple } from "@dst0/p-ai";
import { convertToLlm } from "../../messages.ts";
import type { SessionEntry } from "../../session-manager.ts";
import { STRUCTURED_SESSION_STATE_CUSTOM_TYPE } from "../structured-state.ts";
import { SUMMARIZATION_SYSTEM_PROMPT, serializeConversation } from "../utils.ts";
import { SUMMARIZATION_PROMPT, UPDATE_SUMMARIZATION_PROMPT } from "./constants.ts";
import { estimateTokens } from "./helpers-part1.ts";
import type { CutPointResult } from "./types.ts";

export function findValidCutPoints(entries: SessionEntry[], startIndex: number, endIndex: number): number[] {
  const cutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const entry = entries[i];
    switch (entry.type) {
      case "message": {
        const role = entry.message.role;
        switch (role) {
          case "bashExecution":
          case "custom":
          case "branchSummary":
          case "compactionSummary":
          case "user":
          case "assistant":
            cutPoints.push(i);
            break;
          case "toolResult":
            break;
        }
        break;
      }
      case "thinking_level_change":
      case "model_change":
      case "compaction":
      case "branch_summary":
      case "custom":
      case "custom_message":
      case "label":
      case "session_info":
        break;
    }

    // branch_summary and custom_message are user-role messages, valid cut points
    if (entry.type === "branch_summary" || entry.type === "custom_message") {
      cutPoints.push(i);
    }
  }
  return cutPoints;
}

export function findTurnStartIndex(entries: SessionEntry[], entryIndex: number, startIndex: number): number {
  for (let i = entryIndex; i >= startIndex; i--) {
    const entry = entries[i];
    // branch_summary and custom_message are user-role messages, can start a turn
    if (entry.type === "branch_summary" || entry.type === "custom_message") {
      return i;
    }
    if (entry.type === "message") {
      const role = entry.message.role;
      if (role === "user" || role === "bashExecution") {
        return i;
      }
    }
  }
  return -1;
}

export function findCutPoint(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): CutPointResult {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex);

  if (cutPoints.length === 0) {
    return {
      firstKeptEntryIndex: startIndex,
      turnStartIndex: -1,
      isSplitTurn: false,
    };
  }

  // Walk backwards from newest, accumulating estimated message sizes
  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0]; // Default: keep from first message (not header)

  for (let i = endIndex - 1; i >= startIndex; i--) {
    const entry = entries[i];
    if (entry.type !== "message" && entry.type !== "branch_summary" && entry.type !== "custom_message") continue;

    // Estimate this entry's size
    let entryTokens = 0;
    if (entry.type === "message") {
      entryTokens = estimateTokens(entry.message);
    } else if (entry.type === "branch_summary") {
      entryTokens = Math.ceil(entry.summary.length / 4);
    } else if (entry.type === "custom_message") {
      const contentStr = typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content);
      entryTokens = Math.ceil(contentStr.length / 4);
    }
    accumulatedTokens += entryTokens;

    // Check if we've exceeded the budget
    if (accumulatedTokens >= keepRecentTokens) {
      let foundCut = -1;

      // Always try to exclude the message that pushed us over budget
      // by cutting AFTER it (i.e., finding a cut point > i).
      // This ensures we keep only what fits within keepRecentTokens.
      for (let c = 0; c < cutPoints.length; c++) {
        if (cutPoints[c] > i) {
          foundCut = cutPoints[c];
          break;
        }
      }

      // Fallback: Find the closest valid cut point at or after this entry
      if (foundCut === -1) {
        for (let c = 0; c < cutPoints.length; c++) {
          if (cutPoints[c] >= i) {
            foundCut = cutPoints[c];
            break;
          }
        }
        // If still no cut point found (e.g. entry is after the last valid cut point),
        // fallback to the last valid cut point to at least compact something.
        if (foundCut === -1 && cutPoints.length > 0) {
          foundCut = cutPoints[cutPoints.length - 1];
        }
      }

      if (foundCut !== -1) {
        cutIndex = foundCut;
      }
      break;
    }
  }

  // Scan backwards from cutIndex to include any non-message entries (bash, settings, etc.)
  while (cutIndex > startIndex) {
    const prevEntry = entries[cutIndex - 1];
    // Stop at session header or compaction boundaries
    if (prevEntry.type === "compaction") {
      break;
    }
    if (prevEntry.type === "message") {
      // Stop if we hit any message
      break;
    }
    // Include this non-message entry (bash, settings change, etc.)
    cutIndex--;
  }

  // Determine if this is a split turn
  const cutEntry = entries[cutIndex];
  const isUserMessage = cutEntry.type === "message" && cutEntry.message.role === "user";
  const turnStartIndex = isUserMessage ? -1 : findTurnStartIndex(entries, cutIndex, startIndex);

  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !isUserMessage && turnStartIndex !== -1,
  };
}

export function createSummarizationOptions(
  model: Model<any>,
  maxTokens: number,
  apiKey: string | undefined,
  headers: Record<string, string> | undefined,
  signal: AbortSignal | undefined,
  thinkingLevel: ThinkingLevel | undefined,
): SimpleStreamOptions {
  const options: SimpleStreamOptions = { maxTokens, signal, apiKey, headers };
  if (model.reasoning && thinkingLevel && thinkingLevel !== "off") {
    options.reasoning = thinkingLevel;
  }
  return options;
}

export async function completeSummarization(
  model: Model<any>,
  context: Context,
  options: SimpleStreamOptions,
  streamFn?: StreamFn,
): Promise<AssistantMessage> {
  if (!streamFn) {
    return completeSimple(model, context, options);
  }
  const stream = await streamFn(model, context, options);
  return stream.result();
}

export async function generateSummary(
  currentMessages: AgentMessage[],
  model: Model<any>,
  summaryMaxTokens: number,
  apiKey: string | undefined,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  customInstructions?: string,
  previousSummary?: string,
  thinkingLevel?: ThinkingLevel,
  streamFn?: StreamFn,
): Promise<string> {
  const maxTokens = Math.min(summaryMaxTokens, model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY);

  // Use update prompt if we have a previous summary, otherwise initial prompt
  let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  if (customInstructions) {
    basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
  }

  // Serialize conversation to text so model doesn't try to continue it
  // Convert to LLM messages first (handles custom types like bashExecution, custom, etc.)
  const llmMessages = convertToLlm(currentMessages);
  const conversationText = serializeConversation(llmMessages);

  // Build the prompt with conversation wrapped in tags
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  }
  promptText += basePrompt;

  const summarizationMessages = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: promptText }],
      timestamp: Date.now(),
    },
  ];

  const completionOptions = createSummarizationOptions(model, maxTokens, apiKey, headers, signal, thinkingLevel);

  const response = await completeSummarization(
    model,
    {
      systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
      messages: summarizationMessages,
    },
    completionOptions,
    streamFn,
  );

  if (response.stopReason === "error") {
    throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);
  }

  const textContent = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  return textContent;
}

export function isAlreadyCompactedBoundary(pathEntries: SessionEntry[]): boolean {
  const lastEntry = pathEntries[pathEntries.length - 1];
  if (!lastEntry) return false;
  if (lastEntry.type === "compaction") return true;
  if (lastEntry.type !== "custom" || lastEntry.customType !== STRUCTURED_SESSION_STATE_CUSTOM_TYPE) return false;
  const previousEntry = pathEntries[pathEntries.length - 2];
  return previousEntry?.type === "compaction";
}
