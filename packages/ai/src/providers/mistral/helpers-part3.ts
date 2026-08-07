import type { ChatCompletionStreamRequest } from "@mistralai/mistralai/models/components";
import type { Context, Message, Model, StopReason } from "../../types.ts";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.ts";
import { mapToolChoice, toChatMessages, toFunctionTools } from "./helpers-part2.ts";
import type { MistralOptions } from "./types.ts";

export function buildChatPayload(
  model: Model<"mistral-conversations">,
  context: Context,
  messages: Message[],
  options?: MistralOptions,
): ChatCompletionStreamRequest {
  const payload: ChatCompletionStreamRequest = {
    model: model.id,
    stream: true,
    messages: toChatMessages(messages, model.input.includes("image")),
  };

  if (context.tools?.length) payload.tools = toFunctionTools(context.tools);
  if (options?.temperature !== undefined) payload.temperature = options.temperature;
  if (options?.maxTokens !== undefined) payload.maxTokens = options.maxTokens;
  if (options?.toolChoice) payload.toolChoice = mapToolChoice(options.toolChoice);
  if (options?.promptMode) payload.promptMode = options.promptMode;
  if (options?.reasoningEffort) payload.reasoningEffort = options.reasoningEffort;

  if (context.systemPrompt) {
    payload.messages.unshift({
      role: "system",
      content: sanitizeSurrogates(context.systemPrompt),
    });
  }

  return payload;
}

export function mapChatStopReason(reason: string | null): StopReason {
  if (reason === null) return "stop";
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
    case "model_length":
      return "length";
    case "tool_calls":
      return "toolUse";
    case "error":
      return "error";
    default:
      return "stop";
  }
}
