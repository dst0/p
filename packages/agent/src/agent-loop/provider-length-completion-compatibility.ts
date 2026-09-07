import type { AssistantMessage } from "@dst0/p-ai";
import type { CompletionMode } from "../completion-protocol.ts";
import type { AgentContext, AgentLoopConfig, AgentMessage, AgentToolCall } from "../types.ts";
import { emitProtocolFailure } from "./message-preparation.ts";
import {
  handleProviderLengthResponse,
  type ProviderLengthContinuationDecision,
} from "./provider-length-continuation.ts";
import type {
  AgentEventSink,
  CompletionProtocolLimits,
  CompletionProtocolRepair,
  CompletionProtocolState,
} from "./types.ts";

export async function prepareProviderLengthContinuation(
  message: AssistantMessage,
  toolCalls: AgentToolCall[],
  repair: CompletionProtocolRepair | undefined,
  state: CompletionProtocolState,
  limits: CompletionProtocolLimits,
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  completionMode: CompletionMode,
  emit: AgentEventSink,
): Promise<ProviderLengthContinuationDecision | "failed"> {
  if (
    repair?.reason === "repetitive_model_output" &&
    !(await recordSemanticProviderLengthRepair(
      repair,
      state,
      limits,
      currentContext,
      newMessages,
      config,
      completionMode,
      emit,
    ))
  ) {
    return "failed";
  }
  return handleProviderLengthResponse(message, toolCalls, repair?.message, currentContext, newMessages, emit);
}

async function recordSemanticProviderLengthRepair(
  repair: CompletionProtocolRepair,
  state: CompletionProtocolState,
  limits: CompletionProtocolLimits,
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  completionMode: CompletionMode,
  emit: AgentEventSink,
): Promise<boolean> {
  state.noProgressTurns++;
  state.malformedToolRetries++;
  const malformedExceeded = state.malformedToolRetries > limits.maxMalformedToolRetries;
  const noProgressExceeded = state.noProgressTurns > limits.maxNoProgressTurns;
  if (malformedExceeded || noProgressExceeded) {
    const diagnostic = malformedExceeded
      ? `Agent stopped because the model entered a repetitive output loop ${state.malformedToolRetries} times.`
      : `Agent stopped because the model did not call \`finish_work\` and made no progress for ${state.noProgressTurns} turns.`;
    await emitProtocolFailure(
      currentContext,
      newMessages,
      config,
      emit,
      completionMode,
      "no_progress_stop",
      diagnostic,
      false,
    );
    return false;
  }

  await emit({
    type: "completion_protocol",
    completionMode,
    event: repair.event,
    retry: state.malformedToolRetries,
    maxRetries: limits.maxMalformedToolRetries,
    reason: repair.reason,
  });
  return true;
}
