import type { AssistantMessage } from "@dst0/p-ai";
import type { AgentContext, AgentMessage, AgentToolCall } from "../types.ts";
import {
  handleProviderLengthResponse,
  type ProviderLengthContinuationDecision,
} from "./provider-length-continuation.ts";
import type { AgentEventSink, CompletionProtocolRepair } from "./types.ts";

export async function prepareProviderLengthContinuation(
  message: AssistantMessage,
  toolCalls: AgentToolCall[],
  repair: CompletionProtocolRepair | undefined,
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  emit: AgentEventSink,
): Promise<ProviderLengthContinuationDecision> {
  return handleProviderLengthResponse(message, toolCalls, repair?.message, currentContext, newMessages, emit);
}
