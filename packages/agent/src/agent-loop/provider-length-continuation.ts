import type { AssistantMessage } from "@dst0/p-ai";
import type { AgentContext, AgentLoopConfig, AgentMessage, AgentToolCall } from "../types.ts";
import { EMPTY_USAGE } from "./constants.ts";
import { hasRepetitiveModelOutput } from "./response-processing.ts";
import type { AgentEventSink } from "./types.ts";

const MAX_CONSECUTIVE_PROVIDER_LENGTH_CONTINUATIONS = 3;

export type ProviderLengthContinuationState = {
  consecutiveLengthFinishes: number;
};

export type ProviderLengthContinuationDecision = "none" | "continue" | "exhausted";

const PROVIDER_LENGTH_EXHAUSTED_DIAGNOSTIC =
  `Agent stopped after ${MAX_CONSECUTIVE_PROVIDER_LENGTH_CONTINUATIONS} consecutive output-limit continuations because the provider kept returning stopReason "length". ` +
  "All completed response segments were preserved, and no tool calls from length-finished turns were executed.";

export function createProviderLengthContinuationState(): ProviderLengthContinuationState {
  return { consecutiveLengthFinishes: 0 };
}

export async function emitProviderLengthExhaustion(
  config: AgentLoopConfig,
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  emit: AgentEventSink,
): Promise<void> {
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: PROVIDER_LENGTH_EXHAUSTED_DIAGNOSTIC }],
    api: config.model.api,
    provider: config.model.provider,
    model: config.model.id,
    usage: EMPTY_USAGE,
    stopReason: "error",
    errorMessage: PROVIDER_LENGTH_EXHAUSTED_DIAGNOSTIC,
    timestamp: Date.now(),
  };
  currentContext.messages.push(message);
  newMessages.push(message);
  await emit({ type: "turn_start" });
  await emit({ type: "message_start", message });
  await emit({ type: "message_end", message });
  await emit({ type: "turn_end", message, toolResults: [] });
  await emit({ type: "agent_end", messages: newMessages });
}

export function isProviderLengthResponse(message: AssistantMessage): boolean {
  return message.stopReason === "length";
}

export function requiresSpecializedProviderLengthRepair(
  message: AssistantMessage,
  toolCalls: AgentToolCall[],
): boolean {
  return isProviderLengthResponse(message) && (toolCalls.length > 0 || hasRepetitiveModelOutput(message));
}

export async function handleProviderLengthResponse(
  message: AssistantMessage,
  toolCalls: AgentToolCall[],
  specializedInstruction: string | undefined,
  state: ProviderLengthContinuationState,
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  emit: AgentEventSink,
): Promise<ProviderLengthContinuationDecision> {
  if (!isProviderLengthResponse(message)) {
    state.consecutiveLengthFinishes = 0;
    return "none";
  }
  if (state.consecutiveLengthFinishes >= MAX_CONSECUTIVE_PROVIDER_LENGTH_CONTINUATIONS) {
    return "exhausted";
  }

  state.consecutiveLengthFinishes++;
  const continuationMessage = createProviderLengthContinuationMessage(toolCalls.length > 0, specializedInstruction);
  await emit({ type: "message_start", message: continuationMessage });
  await emit({ type: "message_end", message: continuationMessage });
  currentContext.messages.push(continuationMessage);
  newMessages.push(continuationMessage);
  return "continue";
}

function createProviderLengthContinuationMessage(
  hasToolCall: boolean,
  specializedInstruction: string | undefined,
): AgentMessage {
  const text =
    specializedInstruction ??
    (hasToolCall
      ? [
          "The provider stopped because it reached its output-token limit, so no tool call from that response was executed.",
          "Re-emit only the pending tool call with complete, bounded arguments.",
          "Do not repeat completed text, restart earlier work, or redo already completed operations.",
        ].join("\n")
      : [
          "The provider stopped because it reached its output-token limit.",
          "Continue exactly after the final completed content above and finish within the available output budget.",
          "Do not repeat, summarize, restart, or apologize.",
        ].join("\n"));
  return {
    role: "user",
    content: [{ type: "text", text }],
    metadata: { pInternal: "provider_length_continuation" },
    timestamp: Date.now(),
  };
}
