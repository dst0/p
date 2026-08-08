import type OpenAI from "openai";
import type { AssistantMessage, Context, Model, StreamFunction, ToolCall } from "../../types.ts";
import { AssistantMessageEventStream } from "../../utils/event-stream.ts";
import { headersToRecord } from "../../utils/headers.ts";
import { parseStreamingJson } from "../../utils/json-parse.ts";
import {
  findReasoningActionLoop,
  findRepetitiveOutputSuffix,
  findRepetitiveToolCallSuffix,
  trimRepetitiveSuffix,
} from "../../utils/repetition.ts";
import {
  OUTPUT_REPETITION_CHECK_INTERVAL_CHARS,
  TEXT_REPETITION_MESSAGE,
  THINKING_REPETITION_MESSAGE,
  TOOL_CALL_REPETITION_CHECK_INTERVAL_CHARS,
  TOOL_CALL_REPETITION_MESSAGE,
} from "./constants.ts";
import { getCompat } from "./error-handling.ts";
import { parseOpenAICompletionsProgressChunk, resolveCacheRetention } from "./message-conversion.ts";
import { OpenAIStreamingBlocks } from "./openai-streaming-blocks.ts";
import { mapStopReason, parseChunkUsage } from "./streaming-accumulation.ts";
import { buildParams } from "./streaming-delta.ts";
import { createClient } from "./tool-call-handling.ts";
import type { OpenAICompletionsOptions } from "./types.ts";
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
      const streamingBlocks = new OpenAIStreamingBlocks(output, stream);
      const { blocks } = streamingBlocks;
      let hasFinishReason = false;
      let repetitiveStreamDetected = false;
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
            const block = streamingBlocks.ensureTextBlock();
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
              contentIndex: streamingBlocks.getContentIndex(block),
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
              const block = streamingBlocks.ensureThinkingBlock(thinkingSignature);
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
                contentIndex: streamingBlocks.getContentIndex(block),
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
              const block = streamingBlocks.ensureToolCallBlock(toolCall);
              if (!block.id && toolCall.id) {
                block.id = toolCall.id;
                streamingBlocks.rememberToolCallId(toolCall.id, block);
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
                contentIndex: streamingBlocks.getContentIndex(block),
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
        streamingBlocks.finishBlock(block);
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
        delete (
          block as {
            index?: number;
          }
        ).index;
        // Streaming scratch buffers are only used during parsing; never persist them.
        delete (
          block as {
            partialArgs?: string;
          }
        ).partialArgs;
        delete (
          block as {
            streamIndex?: number;
          }
        ).streamIndex;
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
