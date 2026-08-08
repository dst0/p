import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";
import type { AssistantMessage, TextContent, ThinkingContent, ToolCall } from "../../types.ts";
import type { AssistantMessageEventStream } from "../../utils/event-stream.ts";
import { parseStreamingJson } from "../../utils/json-parse.ts";

export interface StreamingToolCallBlock extends ToolCall {
  partialArgs?: string;
  streamIndex?: number;
}

export type StreamingBlock = TextContent | ThinkingContent | StreamingToolCallBlock;

type StreamingToolCallDelta = NonNullable<ChatCompletionChunk.Choice.Delta["tool_calls"]>[number];

export class OpenAIStreamingBlocks {
  public readonly blocks: StreamingBlock[];
  private readonly output: AssistantMessage;
  private readonly stream: AssistantMessageEventStream;
  private textBlock: TextContent | null = null;
  private thinkingBlock: ThinkingContent | null = null;
  private readonly toolCallBlocksByIndex = new Map<number, StreamingToolCallBlock>();
  private readonly toolCallBlocksById = new Map<string, StreamingToolCallBlock>();

  constructor(output: AssistantMessage, stream: AssistantMessageEventStream) {
    this.output = output;
    this.stream = stream;
    this.blocks = output.content as StreamingBlock[];
  }

  getContentIndex(block: StreamingBlock): number {
    return this.blocks.indexOf(block);
  }

  finishBlock(block: StreamingBlock): void {
    const contentIndex = this.getContentIndex(block);
    if (contentIndex === -1) return;
    if (block.type === "text") {
      this.stream.push({ type: "text_end", contentIndex, content: block.text, partial: this.output });
      return;
    }
    if (block.type === "thinking") {
      this.stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: this.output });
      return;
    }
    block.arguments = parseStreamingJson(block.partialArgs);
    delete block.partialArgs;
    delete block.streamIndex;
    this.stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: this.output });
  }

  ensureTextBlock(): TextContent {
    if (!this.textBlock) {
      this.textBlock = { type: "text", text: "" };
      this.blocks.push(this.textBlock);
      this.stream.push({
        type: "text_start",
        contentIndex: this.getContentIndex(this.textBlock),
        partial: this.output,
      });
    }
    return this.textBlock;
  }

  ensureThinkingBlock(thinkingSignature: string): ThinkingContent {
    if (!this.thinkingBlock) {
      this.thinkingBlock = { type: "thinking", thinking: "", thinkingSignature };
      this.blocks.push(this.thinkingBlock);
      this.stream.push({
        type: "thinking_start",
        contentIndex: this.getContentIndex(this.thinkingBlock),
        partial: this.output,
      });
    }
    return this.thinkingBlock;
  }

  ensureToolCallBlock(toolCall: StreamingToolCallDelta): StreamingToolCallBlock {
    const streamIndex = typeof toolCall.index === "number" ? toolCall.index : undefined;
    let block = streamIndex !== undefined ? this.toolCallBlocksByIndex.get(streamIndex) : undefined;
    if (!block && toolCall.id) block = this.toolCallBlocksById.get(toolCall.id);
    if (!block) {
      block = {
        type: "toolCall",
        id: toolCall.id || "",
        name: toolCall.function?.name || "",
        arguments: {},
        partialArgs: "",
        streamIndex,
      };
      if (streamIndex !== undefined) this.toolCallBlocksByIndex.set(streamIndex, block);
      if (toolCall.id) this.toolCallBlocksById.set(toolCall.id, block);
      this.blocks.push(block);
      this.stream.push({
        type: "toolcall_start",
        contentIndex: this.getContentIndex(block),
        partial: this.output,
      });
    }
    if (streamIndex !== undefined && block.streamIndex === undefined) {
      block.streamIndex = streamIndex;
      this.toolCallBlocksByIndex.set(streamIndex, block);
    }
    if (toolCall.id) this.toolCallBlocksById.set(toolCall.id, block);
    return block;
  }

  rememberToolCallId(id: string, block: StreamingToolCallBlock): void {
    this.toolCallBlocksById.set(id, block);
  }
}
