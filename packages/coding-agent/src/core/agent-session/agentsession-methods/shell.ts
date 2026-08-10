import type { BashResult } from "../../bash-executor.ts";
import type { BashExecutionMessage } from "../../messages.ts";
import type { AgentSession } from "../agentsession.ts";

export function do_recordBashResult(
  self: AgentSession,
  command: string,
  result: BashResult,
  options?: { excludeFromContext?: boolean },
): void {
  self._rememberBashCommand(command);

  // Record in verification ledger
  self._verificationLedger.record(command, {
    exitCode: result.exitCode,
    signal: result.cancelled ? undefined : undefined,
    truncated: result.truncated,
    fullLogPointer: result.fullOutputPath,
  });

  const bashMessage: BashExecutionMessage = {
    role: "bashExecution",
    command,
    output: result.output,
    exitCode: result.exitCode,
    cancelled: result.cancelled,
    truncated: result.truncated,
    fullOutputPath: result.fullOutputPath,
    timestamp: Date.now(),
    excludeFromContext: options?.excludeFromContext,
  };

  // If agent is streaming, defer adding to avoid breaking tool_use/tool_result ordering
  if (self.isStreaming) {
    // Queue for later - will be flushed on agent_end
    self._pendingBashMessages.push(bashMessage);
  } else {
    // Add to agent state immediately
    self.agent.state.messages.push(bashMessage);

    // Save to session
    self.sessionManager.appendMessage(bashMessage);
  }
}

export function do_abortBash(self: AgentSession): void {
  self._bashAbortController?.abort();
}

export function do__flushPendingBashMessages(self: AgentSession): void {
  if (self._pendingBashMessages.length === 0) return;

  for (const bashMessage of self._pendingBashMessages) {
    // Add to agent state
    self.agent.state.messages.push(bashMessage);

    // Save to session
    self.sessionManager.appendMessage(bashMessage);
  }

  self._pendingBashMessages = [];
}

export function do_setSessionName(self: AgentSession, name: string): void {
  self.sessionManager.appendSessionInfo(name);
  self._emit({
    type: "session_info_changed",
    name: self.sessionManager.getSessionName(),
  });
}
