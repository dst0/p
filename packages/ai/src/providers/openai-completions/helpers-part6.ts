import type { CacheRetention, Context, Model } from "../../types.ts";
import { clampOpenAIPromptCacheKey } from "../openai-prompt-cache.ts";
import { hasToolHistory } from "./helpers-part1.ts";
import { resolveCacheRetention } from "./helpers-part2.ts";
import { convertMessages } from "./helpers-part4.ts";
import { applyAnthropicCacheControl, convertTools, getCompatCacheControl } from "./helpers-part5.ts";
import { getCompat } from "./helpers-part8.ts";
import type {
  OpenAICompletionsOptions,
  OpenAICompletionsProgressParams,
  ResolvedOpenAICompletionsCompat,
} from "./types.ts";

export function buildParams(
  model: Model<"openai-completions">,
  context: Context,
  options?: OpenAICompletionsOptions,
  compat: ResolvedOpenAICompletionsCompat = getCompat(model),
  cacheRetention: CacheRetention = resolveCacheRetention(options?.cacheRetention),
) {
  const messages = convertMessages(model, context, compat);
  const cacheControl = getCompatCacheControl(compat, cacheRetention);

  const params: OpenAICompletionsProgressParams = {
    model: model.id,
    messages,
    stream: true,
    return_progress: true,
    prompt_cache_key:
      (model.baseUrl.includes("api.openai.com") && cacheRetention !== "none") ||
      (cacheRetention === "long" && compat.supportsLongCacheRetention)
        ? clampOpenAIPromptCacheKey(options?.sessionId)
        : undefined,
    prompt_cache_retention: cacheRetention === "long" && compat.supportsLongCacheRetention ? "24h" : undefined,
    cache_prompt: compat.cachePrompt && cacheRetention !== "none" ? true : undefined,
  };

  if (compat.supportsUsageInStreaming !== false) {
    (params as any).stream_options = { include_usage: true };
  }

  if (compat.supportsStore) {
    params.store = false;
  }

  if (options?.maxTokens) {
    if (compat.maxTokensField === "max_tokens") {
      (params as any).max_tokens = options.maxTokens;
    } else {
      params.max_completion_tokens = options.maxTokens;
    }
  }

  if (options?.temperature !== undefined) {
    params.temperature = options.temperature;
  }

  if (context.tools && context.tools.length > 0) {
    params.tools = convertTools(context.tools, compat);
    if (compat.zaiToolStream) {
      (params as any).tool_stream = true;
    }
  } else if (hasToolHistory(context.messages)) {
    // Anthropic (via LiteLLM/proxy) requires tools param when conversation has tool_calls/tool_results
    params.tools = [];
  }

  if (cacheControl) {
    applyAnthropicCacheControl(messages, params.tools, cacheControl);
  }

  if (options?.toolChoice) {
    params.tool_choice = options.toolChoice;
  }

  if (compat.thinkingFormat === "zai" && model.reasoning) {
    const zaiParams = params as typeof params & { thinking?: { type: "enabled" | "disabled" } };
    zaiParams.thinking = { type: options?.reasoningEffort ? "enabled" : "disabled" };
  } else if (compat.thinkingFormat === "qwen" && model.reasoning) {
    (params as any).enable_thinking = !!options?.reasoningEffort;
  } else if (compat.thinkingFormat === "qwen-chat-template" && model.reasoning) {
    (params as any).chat_template_kwargs = {
      enable_thinking: !!options?.reasoningEffort,
      preserve_thinking: true,
    };
  } else if (compat.thinkingFormat === "deepseek" && model.reasoning) {
    if (options?.reasoningEffort) {
      (params as any).thinking = { type: "enabled" };
    } else if (model.thinkingLevelMap?.off !== null) {
      (params as any).thinking = { type: "disabled" };
    }
    if (options?.reasoningEffort && compat.supportsReasoningEffort) {
      (params as any).reasoning_effort = model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
    }
  } else if (compat.thinkingFormat === "openrouter" && model.reasoning) {
    // OpenRouter normalizes reasoning across providers via a nested reasoning object.
    const openRouterParams = params as typeof params & { reasoning?: { effort?: string } };
    if (options?.reasoningEffort) {
      openRouterParams.reasoning = {
        effort: model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort,
      };
    } else if (model.thinkingLevelMap?.off !== null) {
      openRouterParams.reasoning = { effort: model.thinkingLevelMap?.off ?? "none" };
    }
  } else if (compat.thinkingFormat === "ant-ling" && model.reasoning && options?.reasoningEffort) {
    const effort = model.thinkingLevelMap?.[options.reasoningEffort];
    if (typeof effort === "string") {
      (params as typeof params & { reasoning?: { effort: string } }).reasoning = { effort };
    }
  } else if (compat.thinkingFormat === "together" && model.reasoning) {
    const togetherParams = params as Omit<typeof params, "reasoning_effort"> & {
      reasoning?: { enabled: boolean };
      reasoning_effort?: string;
    };
    togetherParams.reasoning = { enabled: !!options?.reasoningEffort };
    if (options?.reasoningEffort && compat.supportsReasoningEffort) {
      togetherParams.reasoning_effort = model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
    }
  } else if (compat.thinkingFormat === "string-thinking" && model.reasoning) {
    const stringThinkingParams = params as typeof params & { thinking?: string };
    if (options?.reasoningEffort) {
      stringThinkingParams.thinking = model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
    } else if (model.thinkingLevelMap?.off !== null) {
      stringThinkingParams.thinking = model.thinkingLevelMap?.off ?? "none";
    }
  } else if (options?.reasoningEffort && model.reasoning && compat.supportsReasoningEffort) {
    // OpenAI-style reasoning_effort
    (params as any).reasoning_effort = model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
  } else if (!options?.reasoningEffort && model.reasoning && compat.supportsReasoningEffort) {
    const offValue = model.thinkingLevelMap?.off;
    if (typeof offValue === "string") {
      (params as any).reasoning_effort = offValue;
    }
  }

  // OpenRouter provider routing preferences
  if (model.compat?.openRouterRouting) {
    (params as any).provider = model.compat.openRouterRouting;
  }

  // Vercel AI Gateway provider routing preferences
  if (model.baseUrl.includes("ai-gateway.vercel.sh") && model.compat?.vercelGatewayRouting) {
    const routing = model.compat.vercelGatewayRouting;
    if (routing.only || routing.order) {
      const gatewayOptions: Record<string, string[]> = {};
      if (routing.only) gatewayOptions.only = routing.only;
      if (routing.order) gatewayOptions.order = routing.order;
      (params as any).providerOptions = { gateway: gatewayOptions };
    }
  }

  return params;
}
