import { FINISH_WORK_TOOL_NAME } from "@dst0/p-agent-core";
import { SLEEP_TOOL_NAME } from "../../messages.ts";
import type { AgentSession } from "../agentsession.ts";
import { MARK_SESSION_PROGRESS_TOOL_NAME, UPDATE_SESSION_STATE_TOOL_NAME } from "../constants.ts";
import { getFinishWorkStatus, isRecord } from "../helpers-part1.ts";

export function do__installAgentToolHooks(self: AgentSession): void {
  self.agent.beforeToolCall = async ({ toolCall, args }) => {
    if (
      self._stateUpdateRequiredForCurrentUserTurn &&
      toolCall.name !== UPDATE_SESSION_STATE_TOOL_NAME &&
      toolCall.name !== SLEEP_TOOL_NAME
    ) {
      self._autoExecuteUpdateSessionState();
    }
    if (self._progressUpdateRequiredBeforeFinish && toolCall.name === FINISH_WORK_TOOL_NAME) {
      self._autoExecuteUpdateSessionState();
    }
    if (toolCall.name === FINISH_WORK_TOOL_NAME) {
      const blockReason = self._getFinishWorkSessionStateBlockReason(args);
      if (blockReason) {
        self._autoExecuteUpdateSessionState();
        const updatedBlockReason = self._getFinishWorkSessionStateBlockReason(args);
        if (updatedBlockReason) {
          return { block: true, reason: updatedBlockReason };
        }
      }
    }

    const runner = self._extensionRunner;
    if (!runner.hasHandlers("tool_call")) {
      return undefined;
    }

    try {
      return await runner.emitToolCall({
        type: "tool_call",
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        input: args as Record<string, unknown>,
      });
    } catch (err) {
      if (err instanceof Error) {
        throw err;
      }
      throw new Error(`Extension failed, blocking execution: ${String(err)}`);
    }
  };

  self.agent.afterToolCall = async ({ toolCall, args, result, isError, context }, signal) => {
    const runner = self._extensionRunner;
    let content = result.content;
    let details: unknown = result.details;
    let nextIsError = isError;
    let changed = false;

    if (runner.hasHandlers("tool_result")) {
      const hookResult = await runner.emitToolResult({
        type: "tool_result",
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        input: args as Record<string, unknown>,
        content,
        details,
        isError: nextIsError,
      });

      if (hookResult) {
        content = hookResult.content ?? content;
        details = hookResult.details ?? details;
        nextIsError = hookResult.isError ?? nextIsError;
        changed = true;
      }
    }

    const extract = await self._maybeCreateToolResultContextExtract(
      toolCall.name,
      content,
      details,
      nextIsError,
      context.messages,
      signal,
    );
    if (extract) {
      details = {
        ...(isRecord(details) ? details : {}),
        contextExtract: extract,
      };
      changed = true;
    }

    if (toolCall.name === UPDATE_SESSION_STATE_TOOL_NAME && !nextIsError) {
      self._stateUpdateRequiredForCurrentUserTurn = false;
      self._progressUpdateRequiredBeforeFinish = false;
    } else if (toolCall.name === MARK_SESSION_PROGRESS_TOOL_NAME && !nextIsError) {
      self._progressUpdateRequiredBeforeFinish = false;
    } else if (!nextIsError && toolCall.name !== SLEEP_TOOL_NAME && toolCall.name !== FINISH_WORK_TOOL_NAME) {
      self._progressUpdateRequiredBeforeFinish = true;
    }

    if (toolCall.name === FINISH_WORK_TOOL_NAME && getFinishWorkStatus(args) === "success" && !nextIsError) {
      self._reconcileSuccessfulFinishWorkState();
    }

    if (!changed) {
      return undefined;
    }

    return {
      content,
      details,
      isError: nextIsError,
    };
  };
}
