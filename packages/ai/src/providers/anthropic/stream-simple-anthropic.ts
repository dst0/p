import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../../types.ts";
import type { AssistantMessageEventStream } from "../../utils/event-stream.ts";
import { adjustMaxTokensForThinking, buildBaseOptions } from "../simple-options.ts";
import { mapThinkingLevelToEffort } from "./message-conversion.ts";
import { streamAnthropic } from "./stream-anthropic.ts";
import type { AnthropicOptions } from "./types.ts";
export const streamSimpleAnthropic: StreamFunction<"anthropic-messages", SimpleStreamOptions> = (
  model: Model<"anthropic-messages">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  const apiKey = options?.apiKey;
  if (!apiKey) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }
  const base = buildBaseOptions(model, options, apiKey);
  if (!options?.reasoning) {
    return streamAnthropic(model, context, { ...base, thinkingEnabled: false } satisfies AnthropicOptions);
  }
  // For models with adaptive thinking: use an effort level.
  // For older models: use budget-based thinking.
  if (model.compat?.forceAdaptiveThinking === true) {
    const effort = mapThinkingLevelToEffort(model, options.reasoning);
    return streamAnthropic(model, context, {
      ...base,
      thinkingEnabled: true,
      effort,
    } satisfies AnthropicOptions);
  }
  // Undefined means the caller did not request an output cap; let the helper use the model cap.
  // Do not coerce to 0 here, or the thinking budget would become the entire max_tokens value.
  const adjusted = adjustMaxTokensForThinking(
    base.maxTokens,
    model.maxTokens,
    options.reasoning,
    options.thinkingBudgets,
  );
  return streamAnthropic(model, context, {
    ...base,
    maxTokens: adjusted.maxTokens,
    thinkingEnabled: true,
    thinkingBudgetTokens: adjusted.thinkingBudget,
  } satisfies AnthropicOptions);
};
