import type {
  AssistantMessage,
  AssistantMessageEventStream,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "../../types.ts";
import { createAbortedMessage, scheduleChunk, splitStringByTokenSize } from "./helpers-part2.ts";

export async function streamWithDeltas(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  minTokenSize: number,
  maxTokenSize: number,
  tokensPerSecond: number | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  const partial: AssistantMessage = { ...message, content: [] };
  if (signal?.aborted) {
    const aborted = createAbortedMessage(partial);
    stream.push({ type: "error", reason: "aborted", error: aborted });
    stream.end(aborted);
    return;
  }

  stream.push({ type: "start", partial: { ...partial } });

  for (let index = 0; index < message.content.length; index++) {
    if (signal?.aborted) {
      const aborted = createAbortedMessage(partial);
      stream.push({ type: "error", reason: "aborted", error: aborted });
      stream.end(aborted);
      return;
    }

    const block = message.content[index];

    if (block.type === "thinking") {
      partial.content = [...partial.content, { type: "thinking", thinking: "" }];
      stream.push({ type: "thinking_start", contentIndex: index, partial: { ...partial } });
      for (const chunk of splitStringByTokenSize(block.thinking, minTokenSize, maxTokenSize)) {
        await scheduleChunk(chunk, tokensPerSecond);
        if (signal?.aborted) {
          const aborted = createAbortedMessage(partial);
          stream.push({ type: "error", reason: "aborted", error: aborted });
          stream.end(aborted);
          return;
        }
        (partial.content[index] as ThinkingContent).thinking += chunk;
        stream.push({ type: "thinking_delta", contentIndex: index, delta: chunk, partial: { ...partial } });
      }
      stream.push({
        type: "thinking_end",
        contentIndex: index,
        content: block.thinking,
        partial: { ...partial },
      });
      continue;
    }

    if (block.type === "text") {
      partial.content = [...partial.content, { type: "text", text: "" }];
      stream.push({ type: "text_start", contentIndex: index, partial: { ...partial } });
      for (const chunk of splitStringByTokenSize(block.text, minTokenSize, maxTokenSize)) {
        await scheduleChunk(chunk, tokensPerSecond);
        if (signal?.aborted) {
          const aborted = createAbortedMessage(partial);
          stream.push({ type: "error", reason: "aborted", error: aborted });
          stream.end(aborted);
          return;
        }
        (partial.content[index] as TextContent).text += chunk;
        stream.push({ type: "text_delta", contentIndex: index, delta: chunk, partial: { ...partial } });
      }
      stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: { ...partial } });
      continue;
    }

    partial.content = [...partial.content, { type: "toolCall", id: block.id, name: block.name, arguments: {} }];
    stream.push({ type: "toolcall_start", contentIndex: index, partial: { ...partial } });
    for (const chunk of splitStringByTokenSize(JSON.stringify(block.arguments), minTokenSize, maxTokenSize)) {
      await scheduleChunk(chunk, tokensPerSecond);
      if (signal?.aborted) {
        const aborted = createAbortedMessage(partial);
        stream.push({ type: "error", reason: "aborted", error: aborted });
        stream.end(aborted);
        return;
      }
      stream.push({ type: "toolcall_delta", contentIndex: index, delta: chunk, partial: { ...partial } });
    }
    (partial.content[index] as ToolCall).arguments = block.arguments;
    stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: { ...partial } });
  }

  if (message.stopReason === "error" || message.stopReason === "aborted") {
    stream.push({ type: "error", reason: message.stopReason, error: message });
    stream.end(message);
    return;
  }

  stream.push({ type: "done", reason: message.stopReason, message });
  stream.end(message);
}
