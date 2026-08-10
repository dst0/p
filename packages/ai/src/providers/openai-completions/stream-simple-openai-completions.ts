import { clampThinkingLevel } from "../../models.ts";
import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../../types.ts";
import type { AssistantMessageEventStream } from "../../utils/event-stream.ts";
import { buildBaseOptions } from "../simple-options.ts";
import { streamOpenAICompletions } from "./stream-openai-completions.ts";
import type { OpenAICompletionsOptions } from "./types.ts";
export const streamSimpleOpenAICompletions: StreamFunction<"openai-completions", SimpleStreamOptions> = (
  model: Model<"openai-completions">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  const apiKey = options?.apiKey;
  if (!apiKey) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }
  const base = buildBaseOptions(model, options, apiKey);
  const clampedReasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
  const reasoningEffort = clampedReasoning === "off" ? undefined : clampedReasoning;
  const toolChoice = (options as OpenAICompletionsOptions | undefined)?.toolChoice;
  return streamOpenAICompletions(model, context, {
    ...base,
    reasoningEffort,
    toolChoice,
  } satisfies OpenAICompletionsOptions);
};
