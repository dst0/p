import type { CompletionEvent } from "@mistralai/mistralai/models/components";
import { calculateCost } from "../../models.ts";
import type { AssistantMessage, Model, TextContent, ThinkingContent, ToolCall } from "../../types.ts";
import type { AssistantMessageEventStream } from "../../utils/event-stream.ts";
import { parseStreamingJson } from "../../utils/json-parse.ts";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.ts";
import { deriveMistralToolCallId } from "./helpers-part1.ts";
import { mapChatStopReason } from "./helpers-part3.ts";

export async function consumeChatStream(
  model: Model<"mistral-conversations">,
  output: AssistantMessage,
  stream: AssistantMessageEventStream,
  mistralStream: AsyncIterable<CompletionEvent>,
): Promise<void> {
  let currentBlock: TextContent | ThinkingContent | null = null;
  const blocks = output.content;
  const blockIndex = () => blocks.length - 1;
  const toolBlocksByKey = new Map<string, number>();

  const finishCurrentBlock = (block?: typeof currentBlock) => {
    if (!block) return;
    if (block.type === "text") {
      stream.push({
        type: "text_end",
        contentIndex: blockIndex(),
        content: block.text,
        partial: output,
      });
      return;
    }
    if (block.type === "thinking") {
      stream.push({
        type: "thinking_end",
        contentIndex: blockIndex(),
        content: block.thinking,
        partial: output,
      });
    }
  };

  for await (const event of mistralStream) {
    const chunk = event.data;
    // Mistral's streamed CompletionChunk carries an id field. Keep the first non-empty one,
    // mirroring how OpenAI-style streaming exposes a stable response identifier per stream.
    output.responseId ||= chunk.id;

    if (chunk.usage) {
      output.usage.input = chunk.usage.promptTokens || 0;
      output.usage.output = chunk.usage.completionTokens || 0;
      output.usage.cacheRead = 0;
      output.usage.cacheWrite = 0;
      output.usage.totalTokens = chunk.usage.totalTokens || output.usage.input + output.usage.output;
      calculateCost(model, output.usage);
    }

    const choice = chunk.choices[0];
    if (!choice) continue;

    if (choice.finishReason) {
      output.stopReason = mapChatStopReason(choice.finishReason);
    }

    const delta = choice.delta;
    if (delta.content !== null && delta.content !== undefined) {
      const contentItems = typeof delta.content === "string" ? [delta.content] : delta.content;
      for (const item of contentItems) {
        if (typeof item === "string") {
          const textDelta = sanitizeSurrogates(item);
          if (!currentBlock || currentBlock.type !== "text") {
            finishCurrentBlock(currentBlock);
            currentBlock = { type: "text", text: "" };
            output.content.push(currentBlock);
            stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
          }
          currentBlock.text += textDelta;
          stream.push({
            type: "text_delta",
            contentIndex: blockIndex(),
            delta: textDelta,
            partial: output,
          });
          continue;
        }

        if (item.type === "thinking") {
          const deltaText = item.thinking
            .map((part) => ("text" in part ? part.text : ""))
            .filter((text) => text.length > 0)
            .join("");
          const thinkingDelta = sanitizeSurrogates(deltaText);
          if (!thinkingDelta) continue;
          if (!currentBlock || currentBlock.type !== "thinking") {
            finishCurrentBlock(currentBlock);
            currentBlock = { type: "thinking", thinking: "" };
            output.content.push(currentBlock);
            stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
          }
          currentBlock.thinking += thinkingDelta;
          stream.push({
            type: "thinking_delta",
            contentIndex: blockIndex(),
            delta: thinkingDelta,
            partial: output,
          });
          continue;
        }

        if (item.type === "text") {
          const textDelta = sanitizeSurrogates(item.text);
          if (!currentBlock || currentBlock.type !== "text") {
            finishCurrentBlock(currentBlock);
            currentBlock = { type: "text", text: "" };
            output.content.push(currentBlock);
            stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
          }
          currentBlock.text += textDelta;
          stream.push({
            type: "text_delta",
            contentIndex: blockIndex(),
            delta: textDelta,
            partial: output,
          });
        }
      }
    }

    const toolCalls = delta.toolCalls || [];
    for (const toolCall of toolCalls) {
      if (currentBlock) {
        finishCurrentBlock(currentBlock);
        currentBlock = null;
      }
      const callId =
        toolCall.id && toolCall.id !== "null"
          ? toolCall.id
          : deriveMistralToolCallId(`toolcall:${toolCall.index ?? 0}`, 0);
      const key = `${callId}:${toolCall.index || 0}`;
      const existingIndex = toolBlocksByKey.get(key);
      let block: (ToolCall & { partialArgs?: string }) | undefined;

      if (existingIndex !== undefined) {
        const existing = output.content[existingIndex];
        if (existing?.type === "toolCall") {
          block = existing as ToolCall & { partialArgs?: string };
        }
      }

      if (!block) {
        block = {
          type: "toolCall",
          id: callId,
          name: toolCall.function.name,
          arguments: {},
          partialArgs: "",
        };
        output.content.push(block);
        toolBlocksByKey.set(key, output.content.length - 1);
        stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
      }

      const argsDelta =
        typeof toolCall.function.arguments === "string"
          ? toolCall.function.arguments
          : JSON.stringify(toolCall.function.arguments || {});
      block.partialArgs = (block.partialArgs || "") + argsDelta;
      block.arguments = parseStreamingJson<Record<string, unknown>>(block.partialArgs);
      stream.push({
        type: "toolcall_delta",
        contentIndex: toolBlocksByKey.get(key)!,
        delta: argsDelta,
        partial: output,
      });
    }
  }

  finishCurrentBlock(currentBlock);
  for (const index of toolBlocksByKey.values()) {
    const block = output.content[index];
    if (block.type !== "toolCall") continue;
    const toolBlock = block as ToolCall & { partialArgs?: string };
    toolBlock.arguments = parseStreamingJson<Record<string, unknown>>(toolBlock.partialArgs);
    // Finalize in-place and strip the scratch buffer so replay only
    // carries parsed arguments.
    delete toolBlock.partialArgs;
    stream.push({
      type: "toolcall_end",
      contentIndex: index,
      toolCall: toolBlock,
      partial: output,
    });
  }
}
