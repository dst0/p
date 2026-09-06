import type { AssistantMessage } from "@dst0/p-ai";
import type { AgentContext, AgentMessage, AgentToolCall } from "../types.ts";
import { hasRepetitiveModelOutput } from "./response-processing.ts";
import type { AgentEventSink } from "./types.ts";

export type ProviderLengthContinuationDecision = "none" | "continue";

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
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  emit: AgentEventSink,
): Promise<ProviderLengthContinuationDecision> {
  if (!isProviderLengthResponse(message)) return "none";

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
