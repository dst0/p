import type { CompletionMode } from "../completion-protocol.ts";
import type { AgentContext, AgentMessage } from "../types.ts";
import { createProtocolRepairMessage } from "./context-management.ts";
import type {
  AgentEventSink,
  CompletionProtocolLimits,
  CompletionProtocolState,
  ExecutedToolCallBatch,
} from "./types.ts";

/**
 * Tracks consecutive wait-only tool turns and injects one repair warning when the limit is reached.
 * Returns true when a warning was appended and the loop must request another turn.
 */
export async function recordWaitingTurn(
  state: CompletionProtocolState,
  batch: ExecutedToolCallBatch | undefined,
  limits: CompletionProtocolLimits,
  completionMode: CompletionMode,
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  emit: AgentEventSink,
): Promise<boolean> {
  if (batch?.madeProgress) {
    state.consecutiveWaitingTurns = 0;
  } else if (batch?.waiting) {
    state.consecutiveWaitingTurns++;
  }
  if (state.consecutiveWaitingTurns < limits.maxConsecutiveWaitingTurns) return false;
  const warningMessage = `Warning: Executed ${state.consecutiveWaitingTurns} consecutive wait-only turns without new evidence. Use an event-driven process wait, inspect concrete state, or interrupt the pending operation before continuing.`;
  await emit({
    type: "completion_protocol",
    completionMode,
    event: "waiting_loop_warning",
    reason: warningMessage,
  });
  const repairMessage = createProtocolRepairMessage(warningMessage);
  await emit({ type: "message_start", message: repairMessage });
  await emit({ type: "message_end", message: repairMessage });
  currentContext.messages.push(repairMessage);
  newMessages.push(repairMessage);
  state.consecutiveWaitingTurns = 0;
  return true;
}
