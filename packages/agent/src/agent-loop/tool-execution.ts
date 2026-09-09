import type { AssistantMessage } from "@dst0/p-ai";
import type { AgentTool } from "../types.ts";
import { expandWaitCheckToolCalls } from "./message-preparation.ts";
import {
  extractMisplacedToolCalls,
  isFullyRecoverableMisplacedToolCallJson,
  isToolJsonFence,
} from "./tool-dispatch.ts";

export function removeXmlToolCallBlocksOutsideFences(value: string): string {
  const chunks: string[] = [];
  const outsideFenceBuffer: string[] = [];
  const flushOutsideFenceBuffer = () => {
    if (outsideFenceBuffer.length === 0) return;
    chunks.push(outsideFenceBuffer.join("").replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, ""));
    outsideFenceBuffer.length = 0;
  };
  const lines = value.split(/(\r?\n)/);
  let activeFence: string | undefined;
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index] ?? "";
    const lineEnd = lines[index + 1] ?? "";
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (activeFence === undefined) {
        flushOutsideFenceBuffer();
      }
      activeFence = activeFence === undefined ? fenceMatch[1] : undefined;
      chunks.push(line, lineEnd);
      continue;
    }
    if (activeFence !== undefined) {
      chunks.push(line, lineEnd);
      continue;
    }
    outsideFenceBuffer.push(line, lineEnd);
  }
  flushOutsideFenceBuffer();
  return chunks
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function removeRecoveredJsonToolCallBlocks(value: string, toolNames: ReadonlySet<string>): string {
  if (toolNames.size === 0) return value;
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
    if (fenceMatch && fenceMatch[1][0] === activeFence.marker[0] && fenceMatch[1].length >= activeFence.marker.length) {
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
          const withoutXml = removeXmlToolCallBlocksOutsideFences(block.text);
          const withoutJson = removeRecoveredJsonToolCallBlocks(withoutXml, toolNames);
          return { ...block, text: withoutJson };
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
