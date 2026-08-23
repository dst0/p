import type { AssistantMessage, ToolResultMessage } from "@dst0/p-ai";
import type { AgentContext, AgentLoopConfig, AgentMessage, AgentToolCall } from "../types.ts";
import {
  createExecutedToolCallBatch,
  createToolResultMessage,
  emitToolExecutionEnd,
  emitToolResultMessage,
  executePreparedToolCall,
  executeToolCallsSequential,
  finalizeExecutedToolCall,
} from "./streaming-handler.ts";
import { getAssistantText, prepareToolCall } from "./tool-result-formatting.ts";
import type {
  AgentEventSink,
  CompletionProtocolState,
  ExecutedToolCallBatch,
  FinalizedToolCallEntry,
  FinalizedToolCallOutcome,
} from "./types.ts";

export async function executeToolCallsParallel(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCalls: AgentToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
  const finalizedCalls: FinalizedToolCallEntry[] = [];

  for (const toolCall of toolCalls) {
    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      toolDescription: currentContext.tools?.find((tool) => tool.name === toolCall.name)?.description,
      args: toolCall.arguments,
    });

    const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
    if (preparation.kind === "immediate") {
      const finalized = {
        toolCall,
        result: preparation.result,
        isError: preparation.isError,
      } satisfies FinalizedToolCallOutcome;
      await emitToolExecutionEnd(finalized, emit);
      finalizedCalls.push(finalized);
      if (signal?.aborted) {
        break;
      }
      continue;
    }

    finalizedCalls.push(async () => {
      const executed = await executePreparedToolCall(preparation, signal, emit);
      const finalized = await finalizeExecutedToolCall(
        currentContext,
        assistantMessage,
        preparation,
        executed,
        config,
        signal,
      );
      await emitToolExecutionEnd(finalized, emit);
      return finalized;
    });
    if (signal?.aborted) {
      break;
    }
  }

  const orderedFinalizedCalls = await Promise.all(
    finalizedCalls.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry))),
  );
  const messages: ToolResultMessage[] = [];
  for (const finalized of orderedFinalizedCalls) {
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);
    messages.push(toolResultMessage);
  }

  return createExecutedToolCallBatch(messages, orderedFinalizedCalls);
}

export async function executeToolCalls(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
  const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
  const hasSequentialToolCall = toolCalls.some(
    (tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",
  );
  if (config.toolExecution === "sequential" || hasSequentialToolCall) {
    return executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit);
  }
  return executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit);
}

export function createProtocolRepairMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    metadata: { pInternal: "completion_protocol_repair" },
    timestamp: Date.now(),
  };
}

export function isEmptyAssistantMessage(message: AssistantMessage, toolCalls: AgentToolCall[]): boolean {
  return toolCalls.length === 0 && getAssistantText(message).trim().length === 0;
}

export function resetCompletionProgress(state: CompletionProtocolState): void {
  state.noProgressTurns = 0;
  state.consecutiveWaitingTurns = 0;
  state.emptyAssistantRetries = 0;
  state.malformedToolRetries = 0;
  state.missingFinishRetries = 0;
}
