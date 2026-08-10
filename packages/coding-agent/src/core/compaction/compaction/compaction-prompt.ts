import type { AgentMessage } from "@dst0/p-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@dst0/p-ai";
import { FAILED_TOOL_RESULT_KEEP_TOKENS, MAX_KEPT_CHARS, MAX_KEPT_LINES } from "./constants.ts";
import { estimateTokens, getMessageText } from "./message-selection.ts";
import { createToolResultStub, getToolResultText, isPinnedToolResult } from "./token-counting.ts";
import type { ToolResultStub, ToolResultStubbingResult } from "./types.ts";

export function stubToolResultsForCompactionSummary(messages: AgentMessage[]): ToolResultStubbingResult {
  if (messages.length === 0) {
    return {
      messages,
      stubs: [],
      toolRawTokens: 0,
      toolStubTokens: 0,
      tokenSavingsEstimate: 0,
    };
  }

  const toolResultIndexes: number[] = [];
  for (let index = 0; index < messages.length; index++) {
    if (messages[index].role === "toolResult") {
      toolResultIndexes.push(index);
    }
  }
  if (toolResultIndexes.length === 0) {
    return {
      messages,
      stubs: [],
      toolRawTokens: 0,
      toolStubTokens: 0,
      tokenSavingsEstimate: 0,
    };
  }

  const stubbedMessages = messages.slice();
  const stubs: ToolResultStub[] = [];
  let toolRawTokens = 0;
  let toolStubTokens = 0;

  for (const index of toolResultIndexes) {
    const message = messages[index] as ToolResultMessage;
    const originalTokens = estimateTokens(message);
    toolRawTokens += originalTokens;
    const text = getToolResultText(message);
    if (isPinnedToolResult(message, text) || (message.isError && originalTokens <= FAILED_TOOL_RESULT_KEEP_TOKENS)) {
      toolStubTokens += originalTokens;
      continue;
    }
    const stubResult = createToolResultStub(message, index, originalTokens);
    stubbedMessages[index] = stubResult.message as AgentMessage;
    stubs.push(stubResult.stub);
    toolStubTokens += stubResult.stubTokens;
  }

  return {
    messages: stubs.length > 0 ? stubbedMessages : messages,
    stubs,
    toolRawTokens,
    toolStubTokens,
    tokenSavingsEstimate: Math.max(0, toolRawTokens - toolStubTokens),
  };
}

export function truncateToLastLines(text: string, maxLines: number, maxChars: number): string {
  // First check character limit
  if (text.length <= maxChars && text.split("\n").length <= maxLines) {
    return text;
  }

  const lines = text.split("\n");
  const kept = lines.slice(-maxLines);
  let result = kept.join("\n");

  // Further truncate if still over character limit
  if (result.length > maxChars) {
    result = result.slice(-maxChars);
    // Clean up to start at a line boundary
    const firstNewline = result.indexOf("\n");
    if (firstNewline > 0 && firstNewline < result.length - 1) {
      result = result.slice(firstNewline + 1);
    }
  }

  return `[...truncated, showing last ${kept.length} lines...]\n${result}`;
}

export function setMessageText(message: AgentMessage, truncatedText: string): AgentMessage {
  switch (message.role) {
    case "user": {
      const content = (message as { content: string | Array<{ type: string; text?: string }> }).content;
      if (typeof content === "string") {
        return { ...message, content: truncatedText } as any;
      }
      let textReplaced = false;
      const newContent = content
        .filter((c) => c.type !== "text" || !textReplaced)
        .map((c) => {
          if (c.type === "text") {
            textReplaced = true;
            return { ...c, text: truncatedText };
          }
          return c;
        });
      return { ...message, content: newContent } as any;
    }
    case "toolResult": {
      const content = message.content;
      if (typeof content === "string") {
        return { ...message, content: truncatedText } as any;
      }
      let textReplaced = false;
      const newContent = content
        .filter((c: any) => c.type !== "text" || !textReplaced)
        .map((c: any) => {
          if (c.type === "text") {
            textReplaced = true;
            return { ...c, text: truncatedText };
          }
          return c;
        });
      return { ...message, content: newContent } as any;
    }
    case "assistant": {
      const assistant = message as AssistantMessage;
      let textReplaced = false;
      const newContent = assistant.content
        .filter((c) => c.type !== "text" || !textReplaced)
        .map((c) => {
          if (c.type === "text") {
            textReplaced = true;
            return { ...c, text: truncatedText };
          }
          return c;
        });
      return { ...message, content: newContent } as any;
    }
    case "bashExecution": {
      // Truncate the output, keep the command
      return { ...message, output: truncatedText } as any;
    }
    default:
      return message;
  }
}

export function truncateKeptMessages(
  messages: AgentMessage[],
  budget:
    | number
    | {
        keepRecentTokens: number;
        targetContextTokens?: number;
        systemPromptTokens?: number;
      },
): AgentMessage[] {
  if (messages.length === 0) return messages;

  const keepRecentTokens = typeof budget === "number" ? budget : budget.keepRecentTokens;
  const targetContextTokens =
    typeof budget === "number" ? keepRecentTokens * 1.5 : (budget.targetContextTokens ?? keepRecentTokens * 1.5);
  const systemPromptTokens = typeof budget === "number" ? 0 : (budget.systemPromptTokens ?? 0);

  // First pass: truncate any individual oversized messages
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    // Never truncate the compaction summary itself
    if (msg.role === "compactionSummary") continue;

    const text = getMessageText(msg);
    if (!text) continue;

    const msgTokens = estimateTokens(msg);
    if (msgTokens > keepRecentTokens) {
      // This single message exceeds the individual budget — truncate aggressively
      const truncated = truncateToLastLines(text, MAX_KEPT_LINES, MAX_KEPT_CHARS);
      messages[i] = setMessageText(msg, truncated);
    }
  }

  // Second pass: if total still exceeds target, truncate from oldest non-summary messages
  let totalContextTokens = systemPromptTokens;
  for (const msg of messages) {
    totalContextTokens += estimateTokens(msg);
  }

  if (totalContextTokens > targetContextTokens) {
    // Truncate older messages more aggressively
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === "compactionSummary") continue;

      const text = getMessageText(msg);
      if (!text) continue;

      const msgTokens = estimateTokens(msg);
      if (msgTokens > 500) {
        // Truncate to just last 10 lines for older messages
        const truncated = truncateToLastLines(text, 10, MAX_KEPT_CHARS / 4);
        messages[i] = setMessageText(msg, truncated);
      }

      // Recalculate total
      totalContextTokens = systemPromptTokens;
      for (const m of messages) {
        totalContextTokens += estimateTokens(m);
      }
      if (totalContextTokens <= targetContextTokens) break;
    }
  }

  if (totalContextTokens > targetContextTokens) {
    // Third pass: extremely aggressive truncation for very long turns with many tool results
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === "compactionSummary") continue;

      const text = getMessageText(msg);
      if (!text) continue;

      const msgTokens = estimateTokens(msg);
      if (msgTokens > 50) {
        // Truncate to 0 lines (just the truncated placeholder)
        const truncated = truncateToLastLines(text, 0, 100);
        messages[i] = setMessageText(msg, truncated);
      }

      // Recalculate total
      totalContextTokens = systemPromptTokens;
      for (const m of messages) {
        totalContextTokens += estimateTokens(m);
      }
      if (totalContextTokens <= targetContextTokens) break;
    }
  }

  return messages;
}
