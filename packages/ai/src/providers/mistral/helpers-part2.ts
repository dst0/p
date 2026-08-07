import type {
  ChatCompletionStreamRequestMessage,
  ContentChunk,
  FunctionTool,
} from "@mistralai/mistralai/models/components";
import type { Message, Tool } from "../../types.ts";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.ts";
import { buildToolResultText } from "./helpers-part1.ts";
import type { MistralOptions } from "./types.ts";

export function toChatMessages(messages: Message[], supportsImages: boolean): ChatCompletionStreamRequestMessage[] {
  const result: ChatCompletionStreamRequestMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({ role: "user", content: sanitizeSurrogates(msg.content) });
        continue;
      }
      const hadImages = msg.content.some((item) => item.type === "image");
      const content: ContentChunk[] = msg.content
        .filter((item) => item.type === "text" || supportsImages)
        .map((item) => {
          if (item.type === "text") return { type: "text", text: sanitizeSurrogates(item.text) };
          return { type: "image_url", imageUrl: `data:${item.mimeType};base64,${item.data}` };
        });
      if (content.length > 0) {
        result.push({ role: "user", content });
        continue;
      }
      if (hadImages && !supportsImages) {
        result.push({ role: "user", content: "(image omitted: model does not support images)" });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const contentParts: ContentChunk[] = [];
      const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];

      for (const block of msg.content) {
        if (block.type === "text") {
          if (block.text.trim().length > 0) {
            contentParts.push({ type: "text", text: sanitizeSurrogates(block.text) });
          }
          continue;
        }
        if (block.type === "thinking") {
          if (block.thinking.trim().length > 0) {
            contentParts.push({
              type: "thinking",
              thinking: [{ type: "text", text: sanitizeSurrogates(block.thinking) }],
            });
          }
          continue;
        }
        toolCalls.push({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.arguments || {}) },
        });
      }

      const assistantMessage: ChatCompletionStreamRequestMessage = { role: "assistant" };
      if (contentParts.length > 0) assistantMessage.content = contentParts;
      if (toolCalls.length > 0) assistantMessage.toolCalls = toolCalls;
      if (contentParts.length > 0 || toolCalls.length > 0) result.push(assistantMessage);
      continue;
    }

    const toolContent: ContentChunk[] = [];
    const textResult = msg.content
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? sanitizeSurrogates(part.text) : ""))
      .join("\n");
    const hasImages = msg.content.some((part) => part.type === "image");
    const toolText = buildToolResultText(textResult, hasImages, supportsImages, msg.isError);
    toolContent.push({ type: "text", text: toolText });
    for (const part of msg.content) {
      if (!supportsImages) continue;
      if (part.type !== "image") continue;
      toolContent.push({
        type: "image_url",
        imageUrl: `data:${part.mimeType};base64,${part.data}`,
      });
    }
    result.push({
      role: "tool",
      toolCallId: msg.toolCallId,
      name: msg.toolName,
      content: toolContent,
    });
  }

  return result;
}

export function stripSymbolKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripSymbolKeys(item));
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = stripSymbolKeys(entry);
    }
    return result;
  }

  return value;
}

export function toFunctionTools(tools: Tool[]): Array<FunctionTool & { type: "function" }> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: stripSymbolKeys(tool.parameters) as Record<string, unknown>,
      strict: false,
    },
  }));
}

export function mapToolChoice(
  choice: MistralOptions["toolChoice"],
): "auto" | "none" | "any" | "required" | { type: "function"; function: { name: string } } | undefined {
  if (!choice) return undefined;
  if (choice === "auto" || choice === "none" || choice === "any" || choice === "required") {
    return choice as any;
  }
  return {
    type: "function",
    function: { name: choice.function.name },
  };
}
