import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";
import type { AssistantMessage, CacheRetention, ModelSwitchPhase } from "../../types.ts";
import { isColdPrefill, parseLlamaPromptProgress, readBoolean, readFiniteNumber, readString } from "./helpers-part1.ts";
import type { ProgressChunk } from "./types.ts";

export function parseOpenAICompletionsProgressChunk(
  chunk: ChatCompletionChunk,
  output: AssistantMessage,
): ProgressChunk | undefined {
  const fields = chunk as ChatCompletionChunk & Record<string, unknown>;
  const llamaPromptProgress = parseLlamaPromptProgress(fields, output);
  if (llamaPromptProgress) {
    return llamaPromptProgress;
  }
  if (fields.type === "prompt_processing.start") {
    return {
      type: "prefill_progress",
      elapsedMs: 0,
      percent: 0,
      partial: output,
    };
  }
  if (fields.type === "prompt_processing.progress") {
    const progress = readFiniteNumber(fields, "progress") ?? 0;
    return {
      type: "prefill_progress",
      elapsedMs: readFiniteNumber(fields, "elapsedMs", "elapsed_ms", "time_ms", "timeMs") ?? 0,
      percent: Math.max(0, Math.min(100, progress * 100)),
      partial: output,
    };
  }
  if (fields.type === "prompt_processing.end") {
    return {
      type: "prefill_progress",
      elapsedMs: readFiniteNumber(fields, "elapsedMs", "elapsed_ms", "time_ms", "timeMs") ?? 0,
      percent: 100,
      partial: output,
    };
  }
  if (fields.type === "prefill_progress") {
    const tokens = readFiniteNumber(fields, "tokens", "total", "promptTokens", "prompt_tokens");
    const cachedTokens = readFiniteNumber(fields, "cachedTokens", "cached_tokens", "cacheRead", "cache_read", "cache");
    const explicitCold = readBoolean(fields, "coldPrefill", "cold_prefill", "cold", "cache_miss");
    return {
      type: "prefill_progress",
      elapsedMs: readFiniteNumber(fields, "elapsedMs", "elapsed_ms") ?? 0,
      percent: readFiniteNumber(fields, "percent"),
      tokens,
      cachedTokens,
      tokensPerSecond: readFiniteNumber(fields, "tokensPerSecond", "tokens_per_second"),
      cold: explicitCold ?? isColdPrefill(tokens, cachedTokens),
      partial: output,
    };
  }
  if (fields.type === "cold_prefill_detected") {
    return {
      type: "cold_prefill_detected",
      elapsedMs: readFiniteNumber(fields, "elapsedMs", "elapsed_ms") ?? 0,
      tokens: readFiniteNumber(fields, "tokens", "total", "promptTokens", "prompt_tokens"),
      cachedTokens: readFiniteNumber(fields, "cachedTokens", "cached_tokens", "cacheRead", "cache_read", "cache"),
      reason: readBoolean(fields, "cache_miss") === true ? "cache_miss" : "provider_signal",
      partial: output,
    };
  }
  if (fields.type === "gen_progress") {
    return {
      type: "gen_progress",
      tokens: readFiniteNumber(fields, "tokens") ?? 0,
      tokensPerSecond: readFiniteNumber(fields, "tokensPerSecond", "tokens_per_second") ?? 0,
      partial: output,
    };
  }
  if (fields.type === "queue_progress") {
    const position = Math.max(1, Math.floor(readFiniteNumber(fields, "position") ?? 1));
    const queuedAhead = Math.max(
      0,
      Math.floor(readFiniteNumber(fields, "queuedAhead", "queued_ahead") ?? position - 1),
    );
    return {
      type: "queue_progress",
      queue: readString(fields, "queue") ?? "orchestrator",
      position,
      queuedAhead,
      queuedAtMs: readFiniteNumber(fields, "queuedAtMs", "queued_at_ms"),
      queuedForMs: readFiniteNumber(fields, "queuedForMs", "queued_for_ms", "elapsedMs", "elapsed_ms"),
      ticketId: readString(fields, "ticketId", "ticket_id"),
      workerId: readString(fields, "workerId", "worker_id"),
      partial: output,
    };
  }
  if (fields.type === "model_switch_progress") {
    const fromModel =
      typeof fields.fromModel === "string"
        ? fields.fromModel
        : typeof fields.from_model === "string"
          ? fields.from_model
          : "";
    const toModel =
      typeof fields.toModel === "string" ? fields.toModel : typeof fields.to_model === "string" ? fields.to_model : "";
    const phase = (typeof fields.phase === "string" ? fields.phase : "loading") as ModelSwitchPhase;
    return {
      type: "model_switch_progress",
      phase,
      fromModel,
      toModel,
      partial: output,
    };
  }
  if (fields.type === "loading_progress") {
    const model = typeof fields.model === "string" ? fields.model : "";
    return {
      type: "loading_progress",
      model,
      partial: output,
    };
  }
  return undefined;
}

export function resolveCacheRetention(cacheRetention?: CacheRetention): CacheRetention {
  if (cacheRetention) {
    return cacheRetention;
  }
  if (typeof process !== "undefined" && process.env.P_CACHE_RETENTION === "long") {
    return "long";
  }
  return "short";
}
