import type { AssistantMessage } from "@dst0/p-ai";
import type { AgentTool } from "../types.ts";
import { expandWaitCheckToolCalls } from "./helpers-part1.ts";
import { extractMisplacedToolCalls } from "./helpers-part2.ts";

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

export function recoverMisplacedToolCalls(message: AssistantMessage, tools: AgentTool[] | undefined): AssistantMessage {
  if (message.content.some((block) => block.type === "toolCall")) {
    return message;
  }
  const toolCalls = extractMisplacedToolCalls(message, tools);
  if (toolCalls.length === 0) {
    return message;
  }
  return {
    ...message,
    content: [...removeRecoveredXmlToolCallMarkup(message).content, ...toolCalls],
    stopReason: "toolUse",
  };
}

export function normalizeAssistantToolCalls(
  message: AssistantMessage,
  tools: AgentTool[] | undefined,
): AssistantMessage {
  return expandWaitCheckToolCalls(recoverMisplacedToolCalls(message, tools), tools);
}
