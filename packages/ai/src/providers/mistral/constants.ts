import { Mistral } from "@mistralai/mistralai";
import type { ChatCompletionStreamRequest } from "@mistralai/mistralai/models/components";
import { clampThinkingLevel } from "../../models.ts";
import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../../types.ts";
import { AssistantMessageEventStream } from "../../utils/event-stream.ts";
import { buildBaseOptions } from "../simple-options.ts";
import { transformMessages } from "../transform-messages.ts";
import {
  buildRequestOptions,
  createMistralToolCallIdNormalizer,
  createOutput,
  formatMistralError,
} from "./helpers-part1.ts";
import { buildChatPayload } from "./helpers-part3.ts";
import { consumeChatStream } from "./helpers-part4.ts";
import { mapReasoningEffort, usesPromptModeReasoning, usesReasoningEffort } from "./helpers-part5.ts";
import type { MistralOptions } from "./types.ts";

export const MISTRAL_TOOL_CALL_ID_LENGTH = 9;

export const MAX_MISTRAL_ERROR_BODY_CHARS = 4000;

export const streamMistral: StreamFunction<"mistral-conversations", MistralOptions> = (
  model: Model<"mistral-conversations">,
  context: Context,
  options?: MistralOptions,
): AssistantMessageEventStream => {
  const stream = new AssistantMessageEventStream();

  (async () => {
    const output = createOutput(model);

    try {
      const apiKey = options?.apiKey;
      if (!apiKey) {
        throw new Error(`No API key for provider: ${model.provider}`);
      }

      // Intentionally per-request: avoids shared SDK mutable state across concurrent consumers.
      const mistral = new Mistral({
        apiKey,
        serverURL: model.baseUrl,
      });

      const normalizeMistralToolCallId = createMistralToolCallIdNormalizer();
      const transformedMessages = transformMessages(context.messages, model, (id) => normalizeMistralToolCallId(id));

      let payload = buildChatPayload(model, context, transformedMessages, options);
      const nextPayload = await options?.onPayload?.(payload, model);
      if (nextPayload !== undefined) {
        payload = nextPayload as ChatCompletionStreamRequest;
      }
      const mistralStream = await mistral.chat.stream(payload, buildRequestOptions(model, options));
      stream.push({ type: "start", partial: output });
      await consumeChatStream(model, output, stream, mistralStream);

      if (options?.signal?.aborted) {
        throw new Error("Request was aborted");
      }

      if (output.stopReason === "aborted" || output.stopReason === "error") {
        throw new Error("An unknown error occurred");
      }

      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      for (const block of output.content) {
        // partialArgs is only a streaming scratch buffer; never persist it.
        delete (block as { partialArgs?: string }).partialArgs;
      }
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = formatMistralError(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
};

export const streamSimpleMistral: StreamFunction<"mistral-conversations", SimpleStreamOptions> = (
  model: Model<"mistral-conversations">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  const apiKey = options?.apiKey;
  if (!apiKey) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }

  const base = buildBaseOptions(model, options, apiKey);
  const clampedReasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
  const reasoning = clampedReasoning === "off" ? undefined : clampedReasoning;
  const shouldUseReasoning = model.reasoning && reasoning !== undefined;

  return streamMistral(model, context, {
    ...base,
    promptMode: shouldUseReasoning && usesPromptModeReasoning(model) ? "reasoning" : undefined,
    reasoningEffort:
      shouldUseReasoning && usesReasoningEffort(model) ? mapReasoningEffort(model, reasoning) : undefined,
  } satisfies MistralOptions);
};
