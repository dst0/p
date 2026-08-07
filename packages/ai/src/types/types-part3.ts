export * from "./types-part1.ts";
export * from "./types-part2.ts";

import type { Api, ImagesApi, ImagesProvider, Provider, ThinkingLevelMap } from "./types-part1.ts";
import type { OpenAICompletionsCompat } from "./types-part2.ts";

export interface OpenAIResponsesCompat {
  /** Whether the provider supports the `developer` role (vs `system`). Default: true. */
  supportsDeveloperRole?: boolean;
  /** Whether to send the OpenAI `session_id` cache-affinity header from `options.sessionId` when caching is enabled. Default: true. */
  sendSessionIdHeader?: boolean;
  /** Whether the provider supports `prompt_cache_retention: "24h"`. Default: true. */
  supportsLongCacheRetention?: boolean;
}

export interface AnthropicMessagesCompat {
  /**
   * Whether the provider accepts per-tool `eager_input_streaming`.
   * When false, the Anthropic provider omits `tools[].eager_input_streaming`
   * and sends the legacy `fine-grained-tool-streaming-2025-05-14` beta header
   * for tool-enabled requests.
   * Default: true.
   */
  supportsEagerToolInputStreaming?: boolean;
  /** Whether the provider supports Anthropic long cache retention (`cache_control.ttl: "1h"`). Default: true. */
  supportsLongCacheRetention?: boolean;
  /**
   * Whether to send the `x-session-affinity` header from `options.sessionId`
   * when caching is enabled. Required for providers like Fireworks that use
   * session affinity for prompt cache routing (requests to the same replica
   * maximize cache hits).
   * Default: false.
   */
  sendSessionAffinityHeaders?: boolean;
  /**
   * Whether the provider supports Anthropic-style `cache_control` markers on
   * tool definitions. When false, `cache_control` is omitted from tool params.
   * Some Anthropic-compatible providers (e.g., Fireworks) do not support this
   * field on tools and may reject or ignore it.
   * Default: true.
   */
  supportsCacheControlOnTools?: boolean;
  /**
   * Whether the model accepts the Anthropic `temperature` request field.
   * Claude Opus 4.7+ rejects non-default temperature values.
   * Default: true.
   */
  supportsTemperature?: boolean;
  /**
   * Whether to force adaptive thinking (`thinking.type: "adaptive"` plus
   * `output_config.effort`) regardless of the model id. Built-in models that
   * require adaptive thinking set this in generated metadata. Custom
   * Anthropic-compatible providers can set this to `true` for any model whose
   * upstream requires the adaptive format. Set to `false` to
   * opt out on overridden built-in models.
   * Default: false.
   */
  forceAdaptiveThinking?: boolean;
  /** Whether to replay empty thinking signatures as `signature: ""` instead of converting thinking to text. Default: false. */
  allowEmptySignature?: boolean;
}

export interface OpenRouterRouting {
  /** Whether to allow backup providers to serve requests. Default: true. */
  allow_fallbacks?: boolean;
  /** Whether to filter providers to only those that support all parameters in the request. Default: false. */
  require_parameters?: boolean;
  /** Data collection setting. "allow" (default): allow providers that may store/train on data. "deny": only use providers that don't collect user data. */
  data_collection?: "deny" | "allow";
  /** Whether to restrict routing to only ZDR (Zero Data Retention) endpoints. */
  zdr?: boolean;
  /** Whether to restrict routing to only models that allow text distillation. */
  enforce_distillable_text?: boolean;
  /** An ordered list of provider names/slugs to try in sequence, falling back to the next if unavailable. */
  order?: string[];
  /** List of provider names/slugs to exclusively allow for this request. */
  only?: string[];
  /** List of provider names/slugs to skip for this request. */
  ignore?: string[];
  /** A list of quantization levels to filter providers by (e.g., ["fp16", "bf16", "fp8", "fp6", "int8", "int4", "fp4", "fp32"]). */
  quantizations?: string[];
  /** Sorting strategy. Can be a string (e.g., "price", "throughput", "latency") or an object with `by` and `partition`. */
  sort?:
    | string
    | {
        /** The sorting metric: "price", "throughput", "latency". */
        by?: string;
        /** Partitioning strategy: "model" (default) or "none". */
        partition?: string | null;
      };
  /** Maximum price per million tokens (USD). */
  max_price?: {
    /** Price per million prompt tokens. */
    prompt?: number | string;
    /** Price per million completion tokens. */
    completion?: number | string;
    /** Price per image. */
    image?: number | string;
    /** Price per audio unit. */
    audio?: number | string;
    /** Price per request. */
    request?: number | string;
  };
  /** Preferred minimum throughput (tokens/second). Can be a number (applies to p50) or an object with percentile-specific cutoffs. */
  preferred_min_throughput?:
    | number
    | {
        /** Minimum tokens/second at the 50th percentile. */
        p50?: number;
        /** Minimum tokens/second at the 75th percentile. */
        p75?: number;
        /** Minimum tokens/second at the 90th percentile. */
        p90?: number;
        /** Minimum tokens/second at the 99th percentile. */
        p99?: number;
      };
  /** Preferred maximum latency (seconds). Can be a number (applies to p50) or an object with percentile-specific cutoffs. */
  preferred_max_latency?:
    | number
    | {
        /** Maximum latency in seconds at the 50th percentile. */
        p50?: number;
        /** Maximum latency in seconds at the 75th percentile. */
        p75?: number;
        /** Maximum latency in seconds at the 90th percentile. */
        p90?: number;
        /** Maximum latency in seconds at the 99th percentile. */
        p99?: number;
      };
}

export interface VercelGatewayRouting {
  /** List of provider slugs to exclusively use for this request (e.g., ["bedrock", "anthropic"]). */
  only?: string[];
  /** List of provider slugs to try in order (e.g., ["anthropic", "openai"]). */
  order?: string[];
}

export interface Model<TApi extends Api> {
  id: string;
  name: string;
  api: TApi;
  provider: Provider;
  baseUrl: string;
  reasoning: boolean;
  /**
   * Maps pi thinking levels to provider/model-specific values.
   * Missing keys use provider defaults. null marks a level as unsupported.
   */
  thinkingLevelMap?: ThinkingLevelMap;
  input: ("text" | "image")[];
  cost: {
    input: number; // $/million tokens
    output: number; // $/million tokens
    cacheRead: number; // $/million tokens
    cacheWrite: number; // $/million tokens
  };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  /** Compatibility overrides for OpenAI-compatible APIs. If not set, auto-detected from baseUrl. */
  compat?: TApi extends "openai-completions"
    ? OpenAICompletionsCompat
    : TApi extends "openai-responses"
      ? OpenAIResponsesCompat
      : TApi extends "anthropic-messages"
        ? AnthropicMessagesCompat
        : never;
}

export interface ImagesModel<TApi extends ImagesApi>
  extends Omit<Model<Api>, "api" | "provider" | "reasoning" | "contextWindow" | "maxTokens" | "compat"> {
  api: TApi;
  provider: ImagesProvider;
  output: ("text" | "image")[];
}
