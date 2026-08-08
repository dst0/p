import type {
  AssistantMessage,
  Context,
  ImageContent,
  Message,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
} from "../../types.ts";
import { DEFAULT_API, DEFAULT_MODEL_ID, DEFAULT_PROVIDER, DEFAULT_USAGE } from "./constants.ts";
import type { FauxContentBlock } from "./types.ts";

export function isFauxHiddenRuntimeContextMessage(message: Message): boolean {
  if (message.role !== "user" || !Array.isArray(message.content)) {
    return false;
  }
  const firstText = message.content.find((part): part is TextContent => part.type === "text");
  return firstText?.text.startsWith('<pi.runtime_context ephemeral="true">') === true;
}

export function hideFauxRuntimeContext(context: Context): Context {
  if (!context.messages.some(isFauxHiddenRuntimeContextMessage)) {
    return context;
  }
  return {
    ...context,
    messages: context.messages.filter((message) => !isFauxHiddenRuntimeContextMessage(message)),
  };
}

export function fauxText(text: string): TextContent {
  return { type: "text", text };
}

export function fauxThinking(thinking: string): ThinkingContent {
  return { type: "thinking", thinking };
}

export function randomId(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function fauxToolCall(name: string, arguments_: ToolCall["arguments"], options: { id?: string } = {}): ToolCall {
  return {
    type: "toolCall",
    id: options.id ?? randomId("tool"),
    name,
    arguments: arguments_,
  };
}

export function normalizeFauxAssistantContent(
  content: string | FauxContentBlock | FauxContentBlock[],
): FauxContentBlock[] {
  if (typeof content === "string") {
    return [fauxText(content)];
  }
  return Array.isArray(content) ? content : [content];
}

export function fauxAssistantMessage(
  content: string | FauxContentBlock | FauxContentBlock[],
  options: {
    stopReason?: AssistantMessage["stopReason"];
    errorMessage?: string;
    responseId?: string;
    timestamp?: number;
  } = {},
): AssistantMessage {
  return {
    role: "assistant",
    content: normalizeFauxAssistantContent(content),
    api: DEFAULT_API,
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL_ID,
    usage: DEFAULT_USAGE,
    stopReason: options.stopReason ?? "stop",
    errorMessage: options.errorMessage,
    responseId: options.responseId,
    timestamp: options.timestamp ?? Date.now(),
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function contentToText(content: string | Array<TextContent | ImageContent>): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      return `[image:${block.mimeType}:${block.data.length}]`;
    })
    .join("\n");
}

export function assistantContentToText(content: Array<TextContent | ThinkingContent | ToolCall>): string {
  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      if (block.type === "thinking") {
        return block.thinking;
      }
      return `${block.name}:${JSON.stringify(block.arguments)}`;
    })
    .join("\n");
}

export function toolResultToText(message: ToolResultMessage): string {
  return [message.toolName, ...message.content.map((block) => contentToText([block]))].join("\n");
}

export function messageToText(message: Message): string {
  if (message.role === "user") {
    return contentToText(message.content);
  }
  if (message.role === "assistant") {
    return assistantContentToText(message.content);
  }
  return toolResultToText(message);
}

export function serializeContext(context: Context): string {
  const parts: string[] = [];
  if (context.systemPrompt) {
    parts.push(`system:${context.systemPrompt}`);
  }
  for (const message of context.messages) {
    parts.push(`${message.role}:${messageToText(message)}`);
  }
  if (context.tools?.length) {
    parts.push(`tools:${JSON.stringify(context.tools)}`);
  }
  return parts.join("\n\n");
}

export function commonPrefixLength(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let index = 0;
  while (index < length && a[index] === b[index]) {
    index++;
  }
  return index;
}
