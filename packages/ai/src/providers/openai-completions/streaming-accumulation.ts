import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";
import { calculateCost } from "../../models.ts";
import type { AssistantMessage, Model, StopReason } from "../../types.ts";

export function parseChunkUsage(
  rawUsage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  },
  model: Model<"openai-completions">,
): AssistantMessage["usage"] {
  const promptTokens = rawUsage.prompt_tokens || 0;
  const cacheReadTokens = rawUsage.prompt_tokens_details?.cached_tokens ?? rawUsage.prompt_cache_hit_tokens ?? 0;
  const cacheWriteTokens = rawUsage.prompt_tokens_details?.cache_write_tokens || 0;

  // Follow documented OpenAI/OpenRouter semantics: cached_tokens is cache-read
  // tokens (hits). OpenAI does not document or emit cache_write_tokens, but
  // OpenRouter-compatible providers can include it as a separate write count.
  // OpenRouter's own provider/tests affirm the separate mapping:
  // https://github.com/OpenRouterTeam/ai-sdk-provider/pull/409
  // Do not subtract writes from cached_tokens, otherwise spec-compliant
  // providers are under-reported. DS4 mirrors this contract too:
  // https://github.com/antirez/ds4/pull/29
  const input = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
  // OpenAI completion_tokens already includes reasoning_tokens.
  const outputTokens = rawUsage.completion_tokens || 0;
  const usage: AssistantMessage["usage"] = {
    input,
    output: outputTokens,
    cacheRead: cacheReadTokens,
    cacheWrite: cacheWriteTokens,
    totalTokens: input + outputTokens + cacheReadTokens + cacheWriteTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  calculateCost(model, usage);
  return usage;
}

export function mapStopReason(reason: ChatCompletionChunk.Choice["finish_reason"] | string): {
  stopReason: StopReason;
  errorMessage?: string;
} {
  if (reason === null) return { stopReason: "stop" };
  switch (reason) {
    case "stop":
    case "end":
      return { stopReason: "stop" };
    case "length":
      return { stopReason: "length" };
    case "function_call":
    case "tool_calls":
      return { stopReason: "toolUse" };
    case "content_filter":
      return { stopReason: "error", errorMessage: "Provider finish_reason: content_filter" };
    case "network_error":
      return { stopReason: "error", errorMessage: "Provider finish_reason: network_error" };
    default:
      return {
        stopReason: "error",
        errorMessage: `Provider finish_reason: ${reason}`,
      };
  }
}

export function isLocalOrPrivateBaseUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "::1" || hostname.endsWith(".local")) return true;
    if (hostname.startsWith("127.")) return true;
    if (hostname.startsWith("10.")) return true;
    if (hostname.startsWith("192.168.")) return true;
    const parts = hostname.split(".");
    if (parts.length === 4 && parts[0] === "172") {
      const second = Number.parseInt(parts[1], 10);
      return second >= 16 && second <= 31;
    }
    return false;
  } catch {
    return false;
  }
}
