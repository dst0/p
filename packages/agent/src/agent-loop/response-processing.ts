import { type AssistantMessage, type AssistantMessageEvent, type Context, streamSimple } from "@dst0/p-ai";
import type { AgentContext, AgentLoopConfig, StreamFn } from "../types.ts";
import { normalizeAssistantToolCalls } from "./tool-execution.ts";
import type { AgentEventSink } from "./types.ts";

export async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<AssistantMessage> {
  // Apply context transform if configured (AgentMessage[] → AgentMessage[])
  let messages = context.messages;
  if (config.transformContext) {
    messages = await config.transformContext(messages, signal);
  }

  // Convert to LLM-compatible messages (AgentMessage[] → Message[])
  const llmMessages = await config.convertToLlm(messages);

  // Build LLM context
  const llmContext: Context = {
    systemPrompt: context.systemPrompt,
    messages: llmMessages,
    tools: context.tools,
  };

  const streamFunction = streamFn || streamSimple;

  // Resolve API key (important for expiring tokens)
  const resolvedApiKey =
    (config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;

  await emit({ type: "request_start", model: config.model });

  const response = await streamFunction(config.model, llmContext, {
    ...config,
    reasoning: config.reasoning === "off" ? undefined : config.reasoning,
    apiKey: resolvedApiKey,
    signal,
  });

  let partialMessage: AssistantMessage | null = null;
  let addedPartial = false;

  // Progress tracking: prefill (model processing the prompt) and gen (token generation)
  let prefillStartMs: number | null = null;
  let genStartMs: number | null = null;
  let tokenCount = 0;
  let lastGenProgressMs: number | null = null;
  let intervalTokenCount = 0;
  let coldPrefillEmitted = false;
  const GEN_PROGRESS_INTERVAL_MS = 1000;

  for await (const event of response) {
    switch (event.type) {
      case "start":
        prefillStartMs = Date.now();
        partialMessage = event.partial;
        context.messages.push(partialMessage);
        addedPartial = true;
        await emit({ type: "message_start", message: { ...partialMessage } });
        break;

      case "text_start":
      case "thinking_start":
      case "toolcall_start": {
        // First content block start: prefill is done, generation begins
        if (prefillStartMs && !genStartMs) {
          await emit({
            type: "message_update",
            assistantMessageEvent: {
              type: "prefill_progress",
              elapsedMs: Date.now() - prefillStartMs,
              partial: partialMessage,
            } as AssistantMessageEvent,
            message: partialMessage!,
          });
          genStartMs = Date.now();
          lastGenProgressMs = genStartMs;
          tokenCount = 0;
          intervalTokenCount = 0;
        }
        // Also emit the normal message_update for the event itself
        partialMessage = event.partial;
        context.messages[context.messages.length - 1] = partialMessage;
        await emit({
          type: "message_update",
          assistantMessageEvent: event,
          message: partialMessage,
        });
        break;
      }

      case "text_delta":
      case "thinking_delta":
      case "toolcall_delta": {
        if (genStartMs) {
          tokenCount++;
          intervalTokenCount++;
          const now = Date.now();
          if (lastGenProgressMs != null && now - lastGenProgressMs >= GEN_PROGRESS_INTERVAL_MS) {
            const intervalElapsed = (now - lastGenProgressMs) / 1000;
            if (intervalElapsed > 0) {
              await emit({
                type: "message_update",
                assistantMessageEvent: {
                  type: "gen_progress",
                  tokensPerSecond: Math.round(intervalTokenCount / intervalElapsed),
                  tokens: tokenCount,
                  partial: event.partial,
                } as AssistantMessageEvent,
                message: partialMessage!,
              });
            }
            lastGenProgressMs = now;
            intervalTokenCount = 0;
          }
        }
        // Also emit the normal message_update for the event itself
        partialMessage = event.partial;
        context.messages[context.messages.length - 1] = partialMessage;
        await emit({
          type: "message_update",
          assistantMessageEvent: event,
          message: partialMessage,
        });
        break;
      }

      case "text_end":
      case "thinking_end":
      case "toolcall_end":
      case "prefill_progress":
      case "cold_prefill_detected":
      case "gen_progress":
      case "queue_progress":
      case "model_switch_progress":
      case "loading_progress": {
        partialMessage = event.partial;
        context.messages[context.messages.length - 1] = partialMessage;
        if (event.type === "prefill_progress" && event.cold && !coldPrefillEmitted) {
          coldPrefillEmitted = true;
          await emit({
            type: "message_update",
            assistantMessageEvent: {
              type: "cold_prefill_detected",
              elapsedMs: event.elapsedMs,
              tokens: event.tokens,
              cachedTokens: event.cachedTokens,
              reason: event.cachedTokens === 0 ? "cache_miss" : "provider_signal",
              partial: event.partial,
            },
            message: partialMessage,
          });
        }
        if (event.type === "cold_prefill_detected") {
          coldPrefillEmitted = true;
        }
        await emit({
          type: "message_update",
          assistantMessageEvent: event,
          message: partialMessage,
        });
        break;
      }

      case "done":
      case "error": {
        const finalMessage = normalizeAssistantToolCalls(await response.result(), context.tools);
        if (addedPartial) {
          context.messages[context.messages.length - 1] = finalMessage;
        } else {
          context.messages.push(finalMessage);
        }
        if (!addedPartial) {
          await emit({ type: "message_start", message: { ...finalMessage } });
        }
        await emit({ type: "message_end", message: finalMessage });
        return finalMessage;
      }
    }
  }

  const finalMessage = normalizeAssistantToolCalls(await response.result(), context.tools);
  if (addedPartial) {
    context.messages[context.messages.length - 1] = finalMessage;
  } else {
    context.messages.push(finalMessage);
    await emit({ type: "message_start", message: { ...finalMessage } });
  }
  await emit({ type: "message_end", message: finalMessage });
  return finalMessage;
}

export function hasRepetitiveModelOutput(message: AssistantMessage): boolean {
  return (
    message.stopReason === "length" &&
    /streamed (?:text|reasoning) entered a repetitive loop/i.test(message.errorMessage ?? "")
  );
}
