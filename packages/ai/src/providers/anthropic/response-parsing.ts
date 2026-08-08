import type Anthropic from "@anthropic-ai/sdk";
import type { CacheControlEphemeral, MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/messages.js";
import type { Context, Model, Tool } from "../../types.ts";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.ts";
import { toClaudeCodeName } from "./constants.ts";
import { getAnthropicCompat, getCacheControl } from "./request-building.ts";
import { convertMessages } from "./tool-handling.ts";
import type { AnthropicOptions, AnthropicThinkingDisplay } from "./types.ts";

export function convertTools(
  tools: Tool[],
  isOAuthToken: boolean,
  supportsEagerToolInputStreaming: boolean,
  cacheControl?: CacheControlEphemeral,
): Anthropic.Messages.Tool[] {
  if (!tools) return [];

  return tools.map((tool, index) => {
    const schema = tool.parameters as { properties?: unknown; required?: string[] };

    return {
      name: isOAuthToken ? toClaudeCodeName(tool.name) : tool.name,
      description: tool.description,
      ...(supportsEagerToolInputStreaming ? { eager_input_streaming: true } : {}),
      input_schema: {
        type: "object",
        properties: schema.properties ?? {},
        required: schema.required ?? [],
      },
      ...(cacheControl && index === tools.length - 1 ? { cache_control: cacheControl } : {}),
    };
  });
}

export function buildParams(
  model: Model<"anthropic-messages">,
  context: Context,
  isOAuthToken: boolean,
  options?: AnthropicOptions,
): MessageCreateParamsStreaming {
  const { cacheControl } = getCacheControl(model, options?.cacheRetention);
  const compat = getAnthropicCompat(model);
  const params: MessageCreateParamsStreaming = {
    model: model.id,
    messages: convertMessages(context.messages, model, isOAuthToken, cacheControl, compat.allowEmptySignature),
    max_tokens: options?.maxTokens ?? model.maxTokens,
    stream: true,
  };

  // For OAuth tokens, we MUST include Claude Code identity
  if (isOAuthToken) {
    params.system = [
      {
        type: "text",
        text: "You are Claude Code, Anthropic's official CLI for Claude.",
        ...(cacheControl ? { cache_control: cacheControl } : {}),
      },
    ];
    if (context.systemPrompt) {
      params.system.push({
        type: "text",
        text: sanitizeSurrogates(context.systemPrompt),
        ...(cacheControl ? { cache_control: cacheControl } : {}),
      });
    }
  } else if (context.systemPrompt) {
    // Add cache control to system prompt for non-OAuth tokens
    params.system = [
      {
        type: "text",
        text: sanitizeSurrogates(context.systemPrompt),
        ...(cacheControl ? { cache_control: cacheControl } : {}),
      },
    ];
  }

  // Temperature is incompatible with extended thinking and unsupported on Claude Opus 4.7+.
  if (options?.temperature !== undefined && !options?.thinkingEnabled && compat.supportsTemperature) {
    params.temperature = options.temperature;
  }

  if (context.tools && context.tools.length > 0) {
    params.tools = convertTools(
      context.tools,
      isOAuthToken,
      compat.supportsEagerToolInputStreaming,
      compat.supportsCacheControlOnTools ? cacheControl : undefined,
    );
  }

  // Configure thinking mode: adaptive, budget-based, or explicitly disabled.
  if (model.reasoning) {
    if (options?.thinkingEnabled) {
      // Default to "summarized" so Opus 4.7 and Mythos Preview behave like
      // older Claude 4 models (whose API default is also "summarized").
      const display: AnthropicThinkingDisplay = options.thinkingDisplay ?? "summarized";
      if (model.compat?.forceAdaptiveThinking === true) {
        // Adaptive thinking: Claude decides when and how much to think.
        params.thinking = { type: "adaptive", display };
        if (options.effort) {
          // The Anthropic SDK types can lag newly supported effort values such as "xhigh".
          params.output_config =
            options.effort === "xhigh"
              ? ({ effort: options.effort } as unknown as NonNullable<MessageCreateParamsStreaming["output_config"]>)
              : { effort: options.effort };
        }
      } else {
        // Budget-based thinking for older models
        params.thinking = {
          type: "enabled",
          budget_tokens: options.thinkingBudgetTokens || 1024,
          display,
        };
      }
    } else if (options?.thinkingEnabled === false && model.thinkingLevelMap?.off !== null) {
      params.thinking = { type: "disabled" };
    }
  }

  if (options?.metadata) {
    const userId = options.metadata.user_id;
    if (typeof userId === "string") {
      params.metadata = { user_id: userId };
    }
  }

  if (options?.toolChoice) {
    if (typeof options.toolChoice === "string") {
      params.tool_choice = { type: options.toolChoice };
    } else {
      params.tool_choice = options.toolChoice;
    }
  }

  return params;
}

export function shouldUseFineGrainedToolStreamingBeta(model: Model<"anthropic-messages">, context: Context): boolean {
  return !!context.tools?.length && !getAnthropicCompat(model).supportsEagerToolInputStreaming;
}
