import type OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions.js";
import type { CacheRetention, Tool } from "../../types.ts";
import type {
  ChatCompletionInstructionMessageParam,
  ChatCompletionTextPartWithCacheControl,
  ChatCompletionToolWithCacheControl,
  OpenAICompatCacheControl,
  ResolvedOpenAICompletionsCompat,
} from "./types.ts";

export function getCompatCacheControl(
  compat: ResolvedOpenAICompletionsCompat,
  cacheRetention: CacheRetention,
): OpenAICompatCacheControl | undefined {
  if (compat.cacheControlFormat !== "anthropic" || cacheRetention === "none") {
    return undefined;
  }

  const ttl = cacheRetention === "long" && compat.supportsLongCacheRetention ? "1h" : undefined;
  return { type: "ephemeral", ...(ttl ? { ttl } : {}) };
}

export function convertTools(
  tools: Tool[],
  compat: ResolvedOpenAICompletionsCompat,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as any, // TypeBox already generates JSON Schema
      // Only include strict if provider supports it. Some reject unknown fields.
      ...(compat.supportsStrictMode !== false && { strict: false }),
    },
  }));
}

export function addCacheControlToTextContent(
  message:
    | ChatCompletionInstructionMessageParam
    | ChatCompletionAssistantMessageParam
    | Extract<ChatCompletionMessageParam, { role: "user" }>,
  cacheControl: OpenAICompatCacheControl,
): boolean {
  const content = message.content;
  if (typeof content === "string") {
    if (content.length === 0) {
      return false;
    }
    message.content = [
      {
        type: "text",
        text: content,
        cache_control: cacheControl,
      },
    ] as ChatCompletionTextPartWithCacheControl[];
    return true;
  }

  if (!Array.isArray(content)) {
    return false;
  }

  for (let i = content.length - 1; i >= 0; i--) {
    const part = content[i];
    if (part?.type === "text") {
      const textPart = part as ChatCompletionTextPartWithCacheControl;
      textPart.cache_control = cacheControl;
      return true;
    }
  }

  return false;
}

export function addCacheControlToInstructionMessage(
  message: ChatCompletionInstructionMessageParam,
  cacheControl: OpenAICompatCacheControl,
): boolean {
  return addCacheControlToTextContent(message, cacheControl);
}

export function addCacheControlToSystemPrompt(
  messages: ChatCompletionMessageParam[],
  cacheControl: OpenAICompatCacheControl,
): void {
  for (const message of messages) {
    if (message.role === "system" || message.role === "developer") {
      addCacheControlToInstructionMessage(message, cacheControl);
      return;
    }
  }
}

export function addCacheControlToLastTool(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
  cacheControl: OpenAICompatCacheControl,
): void {
  if (!tools || tools.length === 0) {
    return;
  }

  const lastTool = tools[tools.length - 1] as ChatCompletionToolWithCacheControl;
  lastTool.cache_control = cacheControl;
}

export function addCacheControlToMessage(
  message: ChatCompletionMessageParam,
  cacheControl: OpenAICompatCacheControl,
): boolean {
  if (message.role === "user" || message.role === "assistant") {
    return addCacheControlToTextContent(message, cacheControl);
  }
  return false;
}

export function addCacheControlToLastConversationMessage(
  messages: ChatCompletionMessageParam[],
  cacheControl: OpenAICompatCacheControl,
): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user" || message.role === "assistant") {
      if (addCacheControlToMessage(message, cacheControl)) {
        return;
      }
    }
  }
}

export function applyAnthropicCacheControl(
  messages: ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
  cacheControl: OpenAICompatCacheControl,
): void {
  addCacheControlToSystemPrompt(messages, cacheControl);
  addCacheControlToLastTool(tools, cacheControl);
  addCacheControlToLastConversationMessage(messages, cacheControl);
}
