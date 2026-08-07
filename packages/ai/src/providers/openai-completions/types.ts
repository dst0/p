import type OpenAI from "openai";
import type {
  ChatCompletionContentPartText,
  ChatCompletionDeveloperMessageParam,
  ChatCompletionSystemMessageParam,
} from "openai/resources/chat/completions.js";
import type { AssistantMessageEvent, OpenAICompletionsCompat, StreamOptions } from "../../types.ts";

export type ProgressChunk = Extract<
  AssistantMessageEvent,
  {
    type:
      | "prefill_progress"
      | "cold_prefill_detected"
      | "gen_progress"
      | "queue_progress"
      | "model_switch_progress"
      | "loading_progress";
  }
>;

export interface OpenAICompletionsOptions extends StreamOptions {
  toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
}

export interface OpenAICompatCacheControl {
  type: "ephemeral";
  ttl?: string;
}

export type ResolvedOpenAICompletionsCompat = Omit<
  Required<OpenAICompletionsCompat>,
  "cacheControlFormat" | "cachePrompt"
> & {
  cacheControlFormat?: OpenAICompletionsCompat["cacheControlFormat"];
  cachePrompt: boolean;
};

export type ChatCompletionInstructionMessageParam =
  | ChatCompletionDeveloperMessageParam
  | ChatCompletionSystemMessageParam;

export type ChatCompletionTextPartWithCacheControl = ChatCompletionContentPartText & {
  cache_control?: OpenAICompatCacheControl;
};

export type ChatCompletionToolWithCacheControl = OpenAI.Chat.Completions.ChatCompletionTool & {
  cache_control?: OpenAICompatCacheControl;
};

export type OpenAICompletionsProgressParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & {
  return_progress: true;
  cache_prompt?: boolean;
};
