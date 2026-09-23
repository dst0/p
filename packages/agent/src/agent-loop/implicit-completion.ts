import type { AssistantMessage } from "@dst0/p-ai";
import type { CompletionMode } from "../completion-protocol.ts";
import type { AgentLoopConfig, AgentToolCall } from "../types.ts";
import { isEmptyAssistantMessage, resetCompletionProgress } from "./context-management.ts";
import { isCompletionProtocolEnabled, resolveCompletionMode } from "./message-preparation.ts";
import { isProviderLengthResponse } from "./provider-length-continuation.ts";
import type { AgentEventSink, CompletionProtocolRepair, CompletionProtocolState } from "./types.ts";

/**
 * Whether an explicit or hybrid protocol should accept this turn's non-empty, text-only answer
 * as the end of the run instead of repairing the missing `finish_work` call.
 */
export function acceptsImplicitCompletion(
  config: AgentLoopConfig,
  completionMode: CompletionMode,
  message: AssistantMessage,
  repair: CompletionProtocolRepair | undefined,
  state: CompletionProtocolState,
): boolean {
  const toolCalls = message.content.filter((content): content is AgentToolCall => content.type === "toolCall");
  return (
    isCompletionProtocolEnabled(completionMode) &&
    toolCalls.length === 0 &&
    !isProviderLengthResponse(message) &&
    repair?.reason === "missing_finish_work_or_tool_call" &&
    !isEmptyAssistantMessage(message, toolCalls) &&
    config.allowImplicitCompletion?.({ missingFinishRetries: state.missingFinishRetries }) === true
  );
}

/**
 * Resolves the protocol for the next turn. Entering an enabled protocol from `implicit` announces it and
 * restarts the protocol counters, so turns spent before the switch do not count against its limits.
 */
export async function resolveTurnCompletionMode(
  config: AgentLoopConfig,
  previous: CompletionMode,
  state: CompletionProtocolState,
  emit: AgentEventSink,
): Promise<CompletionMode> {
  const next = resolveCompletionMode(config);
  if (next === previous || !isCompletionProtocolEnabled(next)) return next;
  if (!isCompletionProtocolEnabled(previous)) {
    state.turns = 0;
    resetCompletionProgress(state);
  }
  await emit({ type: "completion_protocol", completionMode: next, event: "completion_mode" });
  return next;
}
