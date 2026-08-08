import {
  type BedrockRuntimeClient,
  BedrockRuntimeServiceException,
  type ContentBlockDeltaEvent,
  type ContentBlockStartEvent,
  type ContentBlockStopEvent,
  type ConverseStreamMetadataEvent,
} from "@aws-sdk/client-bedrock-runtime";
import type { BuildMiddleware, MetadataBearer } from "@smithy/types";
import { calculateCost } from "../../models.ts";
import type { AssistantMessage, Model } from "../../types.ts";
import type { AssistantMessageEventStream } from "../../utils/event-stream.ts";
import { parseStreamingJson } from "../../utils/json-parse.ts";
import { BEDROCK_DATA_RETENTION_DOCS_URL, BEDROCK_ERROR_PREFIXES, RESERVED_HEADER_EXACT } from "./constants.ts";
import type { Block } from "./types.ts";

export function formatBedrockError(error: unknown): string {
  const message = error instanceof Error ? error.message : JSON.stringify(error);
  const dataRetentionHint = /data retention mode/i.test(message)
    ? ` See ${BEDROCK_DATA_RETENTION_DOCS_URL} for supported data retention modes.`
    : "";
  if (error instanceof BedrockRuntimeServiceException) {
    const prefix = BEDROCK_ERROR_PREFIXES[error.name] ?? error.name;
    return `${prefix}: ${message}${dataRetentionHint}`;
  }
  return `${message}${dataRetentionHint}`;
}

export function isReservedHeader(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith("x-amz-") || RESERVED_HEADER_EXACT.has(lower);
}

export function addCustomHeadersMiddleware(client: BedrockRuntimeClient, headers: Record<string, string>): void {
  const middleware: BuildMiddleware<object, MetadataBearer> = (next) => async (args) => {
    const request = args.request;
    if (request && typeof request === "object" && "headers" in request) {
      const requestHeaders = (request as { headers: Record<string, string> }).headers;
      for (const [key, value] of Object.entries(headers)) {
        if (!isReservedHeader(key)) {
          requestHeaders[key] = value;
        }
      }
    }
    return next(args);
  };
  client.middlewareStack.add(middleware, { step: "build", name: "pi-ai-custom-headers", priority: "low" });
}

export function handleContentBlockStart(
  event: ContentBlockStartEvent,
  blocks: Block[],
  output: AssistantMessage,
  stream: AssistantMessageEventStream,
): void {
  const index = event.contentBlockIndex!;
  const start = event.start;

  if (start?.toolUse) {
    const block: Block = {
      type: "toolCall",
      id: start.toolUse.toolUseId || "",
      name: start.toolUse.name || "",
      arguments: {},
      partialJson: "",
      index,
    };
    output.content.push(block);
    stream.push({ type: "toolcall_start", contentIndex: blocks.length - 1, partial: output });
  }
}

export function handleContentBlockDelta(
  event: ContentBlockDeltaEvent,
  blocks: Block[],
  output: AssistantMessage,
  stream: AssistantMessageEventStream,
): void {
  const contentBlockIndex = event.contentBlockIndex!;
  const delta = event.delta;
  let index = blocks.findIndex((b) => b.index === contentBlockIndex);
  let block = blocks[index];

  if (delta?.text !== undefined) {
    // If no text block exists yet, create one, as `handleContentBlockStart` is not sent for text blocks
    if (!block) {
      const newBlock: Block = { type: "text", text: "", index: contentBlockIndex };
      output.content.push(newBlock);
      index = blocks.length - 1;
      block = blocks[index];
      stream.push({ type: "text_start", contentIndex: index, partial: output });
    }
    if (block.type === "text") {
      block.text += delta.text;
      stream.push({ type: "text_delta", contentIndex: index, delta: delta.text, partial: output });
    }
  } else if (delta?.toolUse && block?.type === "toolCall") {
    block.partialJson = (block.partialJson || "") + (delta.toolUse.input || "");
    block.arguments = parseStreamingJson(block.partialJson);
    stream.push({ type: "toolcall_delta", contentIndex: index, delta: delta.toolUse.input || "", partial: output });
  } else if (delta?.reasoningContent) {
    let thinkingBlock = block;
    let thinkingIndex = index;

    if (!thinkingBlock) {
      const newBlock: Block = { type: "thinking", thinking: "", thinkingSignature: "", index: contentBlockIndex };
      output.content.push(newBlock);
      thinkingIndex = blocks.length - 1;
      thinkingBlock = blocks[thinkingIndex];
      stream.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: output });
    }

    if (thinkingBlock?.type === "thinking") {
      if (delta.reasoningContent.text) {
        thinkingBlock.thinking += delta.reasoningContent.text;
        stream.push({
          type: "thinking_delta",
          contentIndex: thinkingIndex,
          delta: delta.reasoningContent.text,
          partial: output,
        });
      }
      if (delta.reasoningContent.signature) {
        thinkingBlock.thinkingSignature = (thinkingBlock.thinkingSignature || "") + delta.reasoningContent.signature;
      }
    }
  }
}

export function handleMetadata(
  event: ConverseStreamMetadataEvent,
  model: Model<"bedrock-converse-stream">,
  output: AssistantMessage,
): void {
  if (event.usage) {
    output.usage.input = event.usage.inputTokens || 0;
    output.usage.output = event.usage.outputTokens || 0;
    output.usage.cacheRead = event.usage.cacheReadInputTokens || 0;
    output.usage.cacheWrite = event.usage.cacheWriteInputTokens || 0;
    output.usage.totalTokens = event.usage.totalTokens || output.usage.input + output.usage.output;
    calculateCost(model, output.usage);
  }
}

export function handleContentBlockStop(
  event: ContentBlockStopEvent,
  blocks: Block[],
  output: AssistantMessage,
  stream: AssistantMessageEventStream,
): void {
  const index = blocks.findIndex((b) => b.index === event.contentBlockIndex);
  const block = blocks[index];
  if (!block) return;
  delete (block as Block).index;

  switch (block.type) {
    case "text":
      stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: output });
      break;
    case "thinking":
      stream.push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial: output });
      break;
    case "toolCall":
      block.arguments = parseStreamingJson(block.partialJson);
      // Finalize in-place and strip the scratch buffer so replay only
      // carries parsed arguments.
      delete (block as Block).partialJson;
      stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
      break;
  }
}
