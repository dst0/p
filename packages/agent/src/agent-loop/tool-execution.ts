import type { AssistantMessage } from "@dst0/p-ai";
import type { AgentTool } from "../types.ts";
import { expandWaitCheckToolCalls, isClosingMarkdownFence, splitMarkdownFenceSegments } from "./message-preparation.ts";
import {
  extractMisplacedToolCalls,
  isFullyRecoverableMisplacedToolCallJson,
  isToolJsonFence,
  parseMisplacedToolCallBlock,
} from "./tool-dispatch.ts";

export function removeXmlToolCallBlocksOutsideFences(value: string): string {
  return splitMarkdownFenceSegments(value)
    .map((segment) =>
      segment.fenced
        ? segment.text
        : segment.text.replace(/<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi, (match, body: string) =>
            parseMisplacedToolCallBlock(body).length > 0 ? "" : match,
          ),
    )
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function removeRecoveredJsonToolCallBlocks(value: string, toolNames: ReadonlySet<string>): string {
  if (toolNames.size === 0) return value;
  const rawJson = value.trim();
  if (isFullyRecoverableMisplacedToolCallJson(rawJson, toolNames)) return "";
  const chunks: string[] = [];
  const lines = value.split(/(\r?\n)/);
  let activeFence: { marker: string; language: string; lines: string[]; bodyLines: string[] } | undefined;
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index] ?? "";
    const lineEnd = lines[index + 1] ?? "";
    const fenceMatch = line.match(/^\s*(```+|~~~+)\s*([A-Za-z0-9_.:-]*)?.*$/);
    if (!activeFence) {
      if (fenceMatch) {
        activeFence = {
          marker: fenceMatch[1],
          language: fenceMatch[2] ?? "",
          lines: [line, lineEnd],
          bodyLines: [],
        };
      } else {
        chunks.push(line, lineEnd);
      }
      continue;
    }
    if (fenceMatch && isClosingMarkdownFence(line, activeFence.marker)) {
      activeFence.lines.push(line, lineEnd);
      const language = activeFence.language.toLowerCase();
      const body = activeFence.bodyLines.join("").trim();
      const isRecovered = isToolJsonFence(language) && isFullyRecoverableMisplacedToolCallJson(body, toolNames);
      if (isRecovered) {
        chunks.push(lineEnd);
      } else {
        chunks.push(...activeFence.lines);
      }
      activeFence = undefined;
    } else {
      activeFence.lines.push(line, lineEnd);
      activeFence.bodyLines.push(line, lineEnd);
    }
  }
  if (activeFence) {
    chunks.push(...activeFence.lines);
  }
  return chunks
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function removeRecoveredXmlToolCallMarkup(message: AssistantMessage): AssistantMessage {
  return {
    ...message,
    content: message.content
      .map((block) => {
        if (block.type === "text") {
          return { ...block, text: removeXmlToolCallBlocksOutsideFences(block.text) };
        }
        if (block.type === "thinking") {
          return { ...block, thinking: removeXmlToolCallBlocksOutsideFences(block.thinking) };
        }
        return block;
      })
      .filter((block) => {
        if (block.type === "text") return block.text.trim().length > 0;
        if (block.type === "thinking") return block.thinking.trim().length > 0;
        return true;
      }),
  };
}

export function removeRecoveredToolCallMarkup(
  message: AssistantMessage,
  toolNames: ReadonlySet<string>,
): AssistantMessage {
  return {
    ...message,
    content: message.content
      .map((block) => {
        if (block.type === "text") {
          const withoutJson = removeRecoveredJsonToolCallBlocks(block.text, toolNames);
          const withoutXml = removeXmlToolCallBlocksOutsideFences(withoutJson);
          return { ...block, text: withoutXml };
        }
        if (block.type === "thinking") {
          const withoutJson = removeRecoveredJsonToolCallBlocks(block.thinking, toolNames);
          const withoutXml = removeXmlToolCallBlocksOutsideFences(withoutJson);
          return { ...block, thinking: withoutXml };
        }
        return block;
      })
      .filter((block) => {
        if (block.type === "text") return block.text.trim().length > 0;
        if (block.type === "thinking") return block.thinking.trim().length > 0;
        return true;
      }),
  };
}

export function recoverMisplacedToolCalls(message: AssistantMessage, tools: AgentTool[] | undefined): AssistantMessage {
  if (message.content.some((block) => block.type === "toolCall")) {
    return message;
  }
  const toolCalls = extractMisplacedToolCalls(message, tools);
  if (toolCalls.length === 0) {
    return message;
  }
  const toolNames = new Set(tools?.map((tool) => tool.name) ?? []);
  return {
    ...message,
    content: [...removeRecoveredToolCallMarkup(message, toolNames).content, ...toolCalls],
    stopReason: "toolUse",
  };
}

export function normalizeAssistantToolCalls(
  message: AssistantMessage,
  tools: AgentTool[] | undefined,
): AssistantMessage {
  return expandWaitCheckToolCalls(recoverMisplacedToolCalls(message, tools), tools);
}
