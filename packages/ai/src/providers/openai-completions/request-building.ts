import type { AssistantMessage, ImageContent, Message, TextContent, ThinkingContent, ToolCall } from "../../types.ts";
import { COLD_PREFILL_MIN_TOKENS, PREFERRED_MIN_ELAPSED_MS } from "./constants.ts";
import type { ProgressChunk } from "./types.ts";

export function hasToolHistory(messages: Message[]): boolean {
  for (const msg of messages) {
    if (msg.role === "toolResult") {
      return true;
    }
    if (msg.role === "assistant") {
      if (msg.content.some((block) => block.type === "toolCall")) {
        return true;
      }
    }
  }
  return false;
}

export function isTextContentBlock(block: { type: string }): block is TextContent {
  return block.type === "text";
}

export function isThinkingContentBlock(block: { type: string }): block is ThinkingContent {
  return block.type === "thinking";
}

export function isToolCallBlock(block: { type: string }): block is ToolCall {
  return block.type === "toolCall";
}

export function isImageContentBlock(block: { type: string }): block is ImageContent {
  return block.type === "image";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readFiniteNumber(fields: Record<string, unknown>, ...names: string[]): number | undefined {
  for (const name of names) {
    const value = fields[name];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

export function readString(fields: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = fields[name];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

export function readBoolean(fields: Record<string, unknown>, ...names: string[]): boolean | undefined {
  for (const name of names) {
    const value = fields[name];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

export function isColdPrefill(tokens: number | undefined, cachedTokens: number | undefined): boolean | undefined {
  if (cachedTokens === undefined || tokens === undefined) {
    return undefined;
  }
  return cachedTokens === 0 && tokens >= COLD_PREFILL_MIN_TOKENS;
}

export function parseLlamaPromptProgress(
  fields: Record<string, unknown>,
  output: AssistantMessage,
): ProgressChunk | undefined {
  const promptProgress = fields.prompt_progress;
  if (!isRecord(promptProgress)) {
    return undefined;
  }

  const total = readFiniteNumber(promptProgress, "total");
  const processed = readFiniteNumber(promptProgress, "processed");
  if (total === undefined || processed === undefined) {
    return undefined;
  }

  const cache = readFiniteNumber(promptProgress, "cache") ?? 0;
  const timedTotal = Math.max(0, total - cache);
  const timedProcessed = Math.max(0, processed - cache);
  const percent =
    timedTotal > 0 ? Math.max(0, Math.min(100, (timedProcessed / timedTotal) * 100)) : processed >= total ? 100 : 0;
  const elapsedMs = readFiniteNumber(promptProgress, "time_ms", "timeMs") ?? 0;
  const timings = isRecord(fields.timings) ? fields.timings : undefined;
  const tokensPerSecond =
    elapsedMs >= PREFERRED_MIN_ELAPSED_MS
      ? ((timings ? readFiniteNumber(timings, "prompt_per_second", "promptPerSecond") : undefined) ??
        (timedProcessed > 0 ? timedProcessed / (elapsedMs / 1000) : undefined))
      : undefined;

  return {
    type: "prefill_progress",
    elapsedMs,
    percent,
    tokens: total,
    cachedTokens: cache,
    tokensPerSecond,
    cold: isColdPrefill(total, cache),
    partial: output,
  };
}
