import type { ToolResultMessage } from "@dst0/p-ai";
import { isFinishWorkToolResult } from "../completion-protocol.ts";
import type { AgentContext, AgentLoopConfig, AgentMessage, StreamFn } from "../types.ts";
import {
  createProtocolRepairMessage,
  executeToolCalls,
  isEmptyAssistantMessage,
  resetCompletionProgress,
} from "./context-management.ts";
import {
  createCompletionProtocolState,
  emitProtocolFailure,
  isCompletionProtocolEnabled,
  resolveCompletionLimits,
  resolveCompletionMode,
  withCompletionProtocolTools,
} from "./message-preparation.ts";
import { streamAssistantResponse } from "./response-processing.ts";
import { detectCompletionProtocolRepair } from "./tool-result-formatting.ts";
import type { AgentEventSink, ExecutedToolCallBatch } from "./types.ts";

export async function runLoop(
  initialContext: AgentContext,
  newMessages: AgentMessage[],
  initialConfig: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<void> {
  let config = initialConfig;
  let completionMode = resolveCompletionMode(config);
  const completionState = createCompletionProtocolState();
  let currentContext = withCompletionProtocolTools(initialContext, completionMode);
  let firstTurn = true;
  // Check for steering messages at start (user may have typed while waiting)
  let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

  if (isCompletionProtocolEnabled(completionMode)) {
    await emit({ type: "completion_protocol", completionMode, event: "completion_mode" });
  }

  // Outer loop: continues when queued follow-up messages arrive after agent would stop
  while (true) {
    let hasMoreToolCalls = true;

    // Inner loop: process tool calls and steering messages
    while (hasMoreToolCalls || pendingMessages.length > 0) {
      if (!firstTurn) {
        await emit({ type: "turn_start" });
      } else {
        firstTurn = false;
      }

      // Process pending messages (inject before next assistant response)
      if (pendingMessages.length > 0) {
        for (const message of pendingMessages) {
          await emit({ type: "message_start", message });
          await emit({ type: "message_end", message });
          currentContext.messages.push(message);
          newMessages.push(message);
        }
        pendingMessages = [];
      }

      completionMode = resolveCompletionMode(config);
      currentContext = withCompletionProtocolTools(currentContext, completionMode);
      const completionLimits = resolveCompletionLimits(config, completionMode);
      if (isCompletionProtocolEnabled(completionMode) && completionState.turns >= completionLimits.maxTurns) {
        await emitProtocolFailure(
          currentContext,
          newMessages,
          config,
          emit,
          completionMode,
          "max_turns_without_finish_work",
          `Agent stopped because the model did not call \`finish_work\` within ${completionLimits.maxTurns} turns.`,
          true,
        );
        return;
      }
      completionState.turns++;

      // Stream assistant response
      const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFn);
      newMessages.push(message);

      if (message.stopReason === "error" || message.stopReason === "aborted") {
        await emit({ type: "turn_end", message, toolResults: [] });
        await emit({ type: "agent_end", messages: newMessages });
        return;
      }

      // Check for tool calls
      const toolCalls = message.content.filter((c) => c.type === "toolCall");
      const protocolRepairBeforeExecution = isCompletionProtocolEnabled(completionMode)
        ? detectCompletionProtocolRepair(message, toolCalls, true)
        : undefined;

      const toolResults: ToolResultMessage[] = [];
      let executedToolBatch: ExecutedToolCallBatch | undefined;
      hasMoreToolCalls = false;
      if (toolCalls.length > 0 && !protocolRepairBeforeExecution) {
        executedToolBatch = await executeToolCalls(currentContext, message, config, signal, emit);
        toolResults.push(...executedToolBatch.messages);
        hasMoreToolCalls = !executedToolBatch.terminate;

        for (const result of toolResults) {
          currentContext.messages.push(result);
          newMessages.push(result);
        }
      }

      await emit({ type: "turn_end", message, toolResults });

      if (executedToolBatch?.madeProgress) {
        completionState.consecutiveWaitingTurns = 0;
      } else if (executedToolBatch?.waiting) {
        completionState.consecutiveWaitingTurns++;
      }
      if (completionState.consecutiveWaitingTurns >= completionLimits.maxConsecutiveWaitingTurns) {
        const warningMessage = `Warning: Executed ${completionState.consecutiveWaitingTurns} consecutive wait-only turns without new evidence. Use an event-driven process wait, inspect concrete state, or interrupt the pending operation before continuing.`;
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
        completionState.consecutiveWaitingTurns = 0;
        hasMoreToolCalls = true;
      }

      if (isCompletionProtocolEnabled(completionMode) && !completionState.allowImplicitCompletion) {
        const finishWorkResult = toolResults.find((result) => isFinishWorkToolResult(result) && !result.isError);
        if (finishWorkResult) {
          await emit({ type: "completion_protocol", completionMode, event: "finish_work_called" });
          await emit({ type: "agent_end", messages: newMessages });
          return;
        }

        const protocolRepair =
          protocolRepairBeforeExecution ?? detectCompletionProtocolRepair(message, toolCalls, hasMoreToolCalls);
        if (protocolRepair) {
          completionState.noProgressTurns++;
          if (protocolRepair.event === "malformed_tool_call_retry") {
            completionState.malformedToolRetries++;
          }
          if (protocolRepair.reason === "missing_finish_work_or_tool_call") {
            completionState.missingFinishRetries++;
          }
          if (isEmptyAssistantMessage(message, toolCalls)) {
            completionState.emptyAssistantRetries++;
          }
        } else if (executedToolBatch?.madeProgress) {
          resetCompletionProgress(completionState);
        } else if (executedToolBatch?.waiting) {
          // Wait-only turns are managed by waiting_loop_warning and do not count towards no_progress_stop
        } else if (toolCalls.length > 0) {
          completionState.noProgressTurns++;
        }

        const malformedExceeded = completionState.malformedToolRetries > completionLimits.maxMalformedToolRetries;
        const emptyExceeded = completionState.emptyAssistantRetries > completionLimits.maxEmptyAssistantRetries;
        const noProgressExceeded = completionState.noProgressTurns > completionLimits.maxNoProgressTurns;
        if (malformedExceeded || emptyExceeded || noProgressExceeded) {
          const diagnostic = malformedExceeded
            ? protocolRepair?.reason === "repetitive_model_output"
              ? `Agent stopped because the model entered a repetitive output loop ${completionState.malformedToolRetries} times.`
              : `Agent stopped because the provider repeatedly reported tool use without returning a valid tool call after ${completionState.malformedToolRetries} attempts.`
            : emptyExceeded
              ? `Agent stopped because the provider returned ${completionState.emptyAssistantRetries} empty responses without a valid tool call.`
              : `Agent stopped because the model did not call \`finish_work\` and made no progress for ${completionState.noProgressTurns} turns.`;
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
          return;
        }

        if (protocolRepair) {
          if (
            completionMode === "hybrid" &&
            protocolRepair.reason === "missing_finish_work_or_tool_call" &&
            completionState.missingFinishRetries > completionLimits.maxMissingFinishRetries
          ) {
            completionState.allowImplicitCompletion = true;
          } else {
            await emit({
              type: "completion_protocol",
              completionMode,
              event: protocolRepair.event,
              retry:
                protocolRepair.event === "malformed_tool_call_retry"
                  ? completionState.malformedToolRetries
                  : completionState.missingFinishRetries,
              maxRetries:
                protocolRepair.event === "malformed_tool_call_retry"
                  ? completionLimits.maxMalformedToolRetries
                  : completionMode === "hybrid"
                    ? completionLimits.maxMissingFinishRetries
                    : completionLimits.maxTurns,
              reason: protocolRepair.reason,
            });
            const repairMessage = createProtocolRepairMessage(protocolRepair.message);
            await emit({ type: "message_start", message: repairMessage });
            await emit({ type: "message_end", message: repairMessage });
            currentContext.messages.push(repairMessage);
            newMessages.push(repairMessage);
            hasMoreToolCalls = true;
            // Protocol repair is another provider turn. Let the common
            // prepareNextTurn boundary compact the completed response before
            // that request instead of bypassing it with an early continue.
          }
        }
      }

      const nextTurnContext = {
        message,
        toolResults,
        context: currentContext,
        newMessages,
      };
      const nextTurnSnapshot = await config.prepareNextTurn?.(nextTurnContext);
      if (nextTurnSnapshot) {
        currentContext = nextTurnSnapshot.context ?? currentContext;
        config = {
          ...config,
          model: nextTurnSnapshot.model ?? config.model,
          reasoning:
            nextTurnSnapshot.thinkingLevel === undefined
              ? config.reasoning
              : nextTurnSnapshot.thinkingLevel === "off"
                ? undefined
                : nextTurnSnapshot.thinkingLevel,
        };
        for (const appendedMessage of nextTurnSnapshot.appendMessages ?? []) {
          await emit({ type: "message_start", message: appendedMessage });
          await emit({ type: "message_end", message: appendedMessage });
          currentContext.messages.push(appendedMessage);
          newMessages.push(appendedMessage);
        }
      }

      const canStopImplicitly = !isCompletionProtocolEnabled(completionMode) || completionState.allowImplicitCompletion;
      if (
        canStopImplicitly &&
        (await config.shouldStopAfterTurn?.({
          message,
          toolResults,
          context: currentContext,
          newMessages,
        }))
      ) {
        await emit({ type: "agent_end", messages: newMessages });
        return;
      }

      pendingMessages = (await config.getSteeringMessages?.()) || [];
    }

    // Agent would stop here. Check for follow-up messages.
    const followUpMessages = (await config.getFollowUpMessages?.()) || [];
    if (followUpMessages.length > 0) {
      // Set as pending so inner loop processes them
      pendingMessages = followUpMessages;
      continue;
    }

    // No more messages, exit
    break;
  }

  await emit({ type: "agent_end", messages: newMessages });
}
