import type OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";
import { clampThinkingLevel } from "../../models.ts";
import type {
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
  StreamFunction,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "../../types.ts";
import { AssistantMessageEventStream } from "../../utils/event-stream.ts";
import { headersToRecord } from "../../utils/headers.ts";
import { parseStreamingJson } from "../../utils/json-parse.ts";
import {
  findReasoningActionLoop,
  findRepetitiveOutputSuffix,
  findRepetitiveToolCallSuffix,
  trimRepetitiveSuffix,
} from "../../utils/repetition.ts";
import { buildBaseOptions } from "../simple-options.ts";
import { parseOpenAICompletionsProgressChunk, resolveCacheRetention } from "./helpers-part2.ts";
import { createClient } from "./helpers-part3.ts";
import { buildParams } from "./helpers-part6.ts";
import { mapStopReason, parseChunkUsage } from "./helpers-part7.ts";
import { getCompat } from "./helpers-part8.ts";
import type { OpenAICompletionsOptions } from "./types.ts";

export const COLD_PREFILL_MIN_TOKENS = 512;

export const PREFERRED_MIN_ELAPSED_MS = 100;

export const TOOL_CALL_REPETITION_CHECK_INTERVAL_CHARS = 256;

export const OUTPUT_REPETITION_CHECK_INTERVAL_CHARS = 512;

export const TOOL_CALL_REPETITION_MESSAGE =
  "Stopped a malformed tool call after its streamed arguments entered a repetitive loop.";

export const TEXT_REPETITION_MESSAGE = "Stopped a response after its streamed text entered a repetitive loop.";

export const THINKING_REPETITION_MESSAGE = "Stopped a response after its streamed reasoning entered a repetitive loop.";

export const streamOpenAICompletions: StreamFunction<"openai-completions", OpenAICompletionsOptions> = (
  model: Model<"openai-completions">,
  context: Context,
  options?: OpenAICompletionsOptions,
): AssistantMessageEventStream => {
  const stream = new AssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    try {
      const apiKey = options?.apiKey;
      if (!apiKey) {
        throw new Error(`No API key for provider: ${model.provider}`);
      }
      const compat = getCompat(model);
      const cacheRetention = resolveCacheRetention(options?.cacheRetention);
      const cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId;
      const client = createClient(model, context, apiKey, options?.headers, cacheSessionId, compat);
      let params = buildParams(model, context, options, compat, cacheRetention);
      const nextParams = await options?.onPayload?.(params, model);
      if (nextParams !== undefined) {
        params = {
          ...(nextParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming),
          return_progress: true,
        };
      }
      const requestOptions = {
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
        maxRetries: options?.maxRetries ?? 0,
      };
      const { data: openaiStream, response } = await client.chat.completions
        .create(params, requestOptions)
        .withResponse();
      await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
      stream.push({ type: "start", partial: output });

      interface StreamingToolCallBlock extends ToolCall {
        partialArgs?: string;
        streamIndex?: number;
      }
      type StreamingBlock = TextContent | ThinkingContent | StreamingToolCallBlock;
      type StreamingToolCallDelta = NonNullable<ChatCompletionChunk.Choice.Delta["tool_calls"]>[number];

      let textBlock: TextContent | null = null;
      let thinkingBlock: ThinkingContent | null = null;
      let hasFinishReason = false;
      let repetitiveStreamDetected = false;
      const toolCallBlocksByIndex = new Map<number, StreamingToolCallBlock>();
      const toolCallBlocksById = new Map<string, StreamingToolCallBlock>();
      const blocks = output.content as StreamingBlock[];
      const getContentIndex = (block: StreamingBlock) => blocks.indexOf(block);
      const finishBlock = (block: StreamingBlock) => {
        const contentIndex = getContentIndex(block);
        if (contentIndex === -1) {
          return;
        }
        if (block.type === "text") {
          stream.push({
            type: "text_end",
            contentIndex,
            content: block.text,
            partial: output,
          });
        } else if (block.type === "thinking") {
          stream.push({
            type: "thinking_end",
            contentIndex,
            content: block.thinking,
            partial: output,
          });
        } else if (block.type === "toolCall") {
          block.arguments = parseStreamingJson(block.partialArgs);
          // Finalize in-place and strip the scratch buffers so replay only
          // carries parsed arguments.
          delete block.partialArgs;
          delete block.streamIndex;
          stream.push({
            type: "toolcall_end",
            contentIndex,
            toolCall: block,
            partial: output,
          });
        }
      };
      const ensureTextBlock = () => {
        if (!textBlock) {
          textBlock = { type: "text", text: "" };
          blocks.push(textBlock);
          stream.push({ type: "text_start", contentIndex: getContentIndex(textBlock), partial: output });
        }
        return textBlock;
      };
      const ensureThinkingBlock = (thinkingSignature: string) => {
        if (!thinkingBlock) {
          thinkingBlock = {
            type: "thinking",
            thinking: "",
            thinkingSignature,
          };
          blocks.push(thinkingBlock);
          stream.push({ type: "thinking_start", contentIndex: getContentIndex(thinkingBlock), partial: output });
        }
        return thinkingBlock;
      };
      const ensureToolCallBlock = (toolCall: StreamingToolCallDelta) => {
        const streamIndex = typeof toolCall.index === "number" ? toolCall.index : undefined;
        let block = streamIndex !== undefined ? toolCallBlocksByIndex.get(streamIndex) : undefined;
        if (!block && toolCall.id) {
          block = toolCallBlocksById.get(toolCall.id);
        }
        if (!block) {
          block = {
            type: "toolCall",
            id: toolCall.id || "",
            name: toolCall.function?.name || "",
            arguments: {},
            partialArgs: "",
            streamIndex,
          };
          if (streamIndex !== undefined) {
            toolCallBlocksByIndex.set(streamIndex, block);
          }
          if (toolCall.id) {
            toolCallBlocksById.set(toolCall.id, block);
          }
          blocks.push(block);
          stream.push({
            type: "toolcall_start",
            contentIndex: getContentIndex(block),
            partial: output,
          });
        }
        if (streamIndex !== undefined && block.streamIndex === undefined) {
          block.streamIndex = streamIndex;
          toolCallBlocksByIndex.set(streamIndex, block);
        }
        if (toolCall.id) {
          toolCallBlocksById.set(toolCall.id, block);
        }
        return block;
      };

      for await (const chunk of openaiStream) {
        if (!chunk || typeof chunk !== "object") continue;

        // OpenAI documents ChatCompletionChunk.id as the unique chat completion identifier,
        // and each chunk in a streamed completion carries the same id.
        output.responseId ||= chunk.id;
        if (typeof chunk.model === "string" && chunk.model.length > 0 && chunk.model !== model.id) {
          output.responseModel ||= chunk.model;
        }

        const progressEvent = parseOpenAICompletionsProgressChunk(chunk, output);
        if (progressEvent) {
          stream.push(progressEvent);
        }

        if (chunk.usage) {
          output.usage = parseChunkUsage(chunk.usage, model);
        }

        const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
        if (!choice) continue;

        // Fallback: some providers (e.g., Moonshot) return usage
        // in choice.usage instead of the standard chunk.usage
        if (!chunk.usage && (choice as any).usage) {
          output.usage = parseChunkUsage((choice as any).usage, model);
        }

        if (choice.finish_reason) {
          const finishReasonResult = mapStopReason(choice.finish_reason);
          output.stopReason = finishReasonResult.stopReason;
          if (finishReasonResult.errorMessage) {
            output.errorMessage = finishReasonResult.errorMessage;
          }
          hasFinishReason = true;
        }

        if (choice.delta) {
          if (choice.delta.content !== null && choice.delta.content !== undefined && choice.delta.content.length > 0) {
            const block = ensureTextBlock();
            const previousLength = block.text.length;
            block.text += choice.delta.content;
            const crossedRepetitionCheckBoundary =
              Math.floor(previousLength / OUTPUT_REPETITION_CHECK_INTERVAL_CHARS) !==
              Math.floor(block.text.length / OUTPUT_REPETITION_CHECK_INTERVAL_CHARS);
            const repetition = crossedRepetitionCheckBoundary ? findRepetitiveOutputSuffix(block.text) : undefined;
            if (repetition) {
              block.text = trimRepetitiveSuffix(block.text, repetition);
              output.stopReason = "length";
              output.errorMessage = TEXT_REPETITION_MESSAGE;
              hasFinishReason = true;
              repetitiveStreamDetected = true;
            }
            stream.push({
              type: "text_delta",
              contentIndex: getContentIndex(block),
              delta: choice.delta.content,
              partial: output,
            });
          }

          if (repetitiveStreamDetected) {
            break;
          }

          // Some endpoints return reasoning in reasoning_content (llama.cpp),
          // or reasoning (other openai compatible endpoints)
          // Use the first non-empty reasoning field to avoid duplication
          // (e.g., chutes.ai returns both reasoning_content and reasoning with same content)
          const reasoningFields = ["reasoning_content", "reasoning", "reasoning_text"];
          const deltaFields = choice.delta as Record<string, unknown>;
          let foundReasoningField: string | null = null;
          for (const field of reasoningFields) {
            const value = deltaFields[field];
            if (typeof value === "string" && value.length > 0) {
              foundReasoningField = field;
              break;
            }
          }

          if (foundReasoningField) {
            const delta = deltaFields[foundReasoningField];
            if (typeof delta === "string" && delta.length > 0) {
              const thinkingSignature =
                model.provider === "opencode-go" && foundReasoningField === "reasoning"
                  ? "reasoning_content"
                  : foundReasoningField;
              const block = ensureThinkingBlock(thinkingSignature);
              const previousLength = block.thinking.length;
              block.thinking += delta;
              const crossedRepetitionCheckBoundary =
                Math.floor(previousLength / OUTPUT_REPETITION_CHECK_INTERVAL_CHARS) !==
                Math.floor(block.thinking.length / OUTPUT_REPETITION_CHECK_INTERVAL_CHARS);
              const repetition = crossedRepetitionCheckBoundary
                ? findRepetitiveOutputSuffix(block.thinking)
                : undefined;
              const actionLoop =
                crossedRepetitionCheckBoundary && !repetition ? findReasoningActionLoop(block.thinking) : undefined;
              if (repetition || actionLoop) {
                block.thinking = repetition
                  ? trimRepetitiveSuffix(block.thinking, repetition)
                  : block.thinking.slice(0, actionLoop!.start);
                output.stopReason = "length";
                output.errorMessage = THINKING_REPETITION_MESSAGE;
                hasFinishReason = true;
                repetitiveStreamDetected = true;
              }
              stream.push({
                type: "thinking_delta",
                contentIndex: getContentIndex(block),
                delta,
                partial: output,
              });
            }
          }

          if (repetitiveStreamDetected) {
            break;
          }

          if (choice?.delta?.tool_calls) {
            for (const toolCall of choice.delta.tool_calls) {
              const block = ensureToolCallBlock(toolCall);
              if (!block.id && toolCall.id) {
                block.id = toolCall.id;
                toolCallBlocksById.set(toolCall.id, block);
              }
              if (!block.name && toolCall.function?.name) {
                block.name = toolCall.function.name;
              }

              let delta = "";
              if (toolCall.function?.arguments) {
                delta = toolCall.function.arguments;
                const previousLength = block.partialArgs?.length ?? 0;
                block.partialArgs = (block.partialArgs ?? "") + delta;
                block.arguments = parseStreamingJson(block.partialArgs);
                const crossedRepetitionCheckBoundary =
                  Math.floor(previousLength / TOOL_CALL_REPETITION_CHECK_INTERVAL_CHARS) !==
                  Math.floor(block.partialArgs.length / TOOL_CALL_REPETITION_CHECK_INTERVAL_CHARS);
                const repetition = crossedRepetitionCheckBoundary
                  ? findRepetitiveToolCallSuffix(block.partialArgs)
                  : undefined;
                if (repetition) {
                  block.partialArgs = trimRepetitiveSuffix(block.partialArgs, repetition);
                  block.arguments = parseStreamingJson(block.partialArgs);
                  output.stopReason = "length";
                  output.errorMessage = TOOL_CALL_REPETITION_MESSAGE;
                  hasFinishReason = true;
                  repetitiveStreamDetected = true;
                }
              }
              stream.push({
                type: "toolcall_delta",
                contentIndex: getContentIndex(block),
                delta,
                partial: output,
              });
              if (repetitiveStreamDetected) {
                break;
              }
            }
          }

          if (repetitiveStreamDetected) {
            break;
          }

          const reasoningDetails = (choice.delta as any).reasoning_details;
          if (reasoningDetails && Array.isArray(reasoningDetails)) {
            for (const detail of reasoningDetails) {
              if (detail.type === "reasoning.encrypted" && detail.id && detail.data) {
                const matchingToolCall = output.content.find((b) => b.type === "toolCall" && b.id === detail.id) as
                  | ToolCall
                  | undefined;
                if (matchingToolCall) {
                  matchingToolCall.thoughtSignature = JSON.stringify(detail);
                }
              }
            }
          }
        }
      }

      for (const block of blocks) {
        finishBlock(block);
      }
      if (options?.signal?.aborted) {
        throw new Error("Request was aborted");
      }

      if (output.stopReason === "aborted") {
        throw new Error("Request was aborted");
      }
      if (output.stopReason === "error") {
        throw new Error(output.errorMessage || "Provider returned an error stop reason");
      }
      if (!hasFinishReason) {
        throw new Error("Stream ended without finish_reason");
      }

      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      for (const block of output.content) {
        delete (block as { index?: number }).index;
        // Streaming scratch buffers are only used during parsing; never persist them.
        delete (block as { partialArgs?: string }).partialArgs;
        delete (block as { streamIndex?: number }).streamIndex;
      }
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      // Some providers via OpenRouter give additional information in this field.
      const rawMetadata = (error as any)?.error?.metadata?.raw;
      if (rawMetadata) output.errorMessage += `\n${rawMetadata}`;
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
};

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
