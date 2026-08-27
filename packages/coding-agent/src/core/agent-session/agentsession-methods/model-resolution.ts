import type { AgentMessage } from "@dst0/p-agent-core";
import type { AgentSession } from "../agentsession.ts";

export async function do__runAgentPrompt(self: AgentSession, messages: AgentMessage | AgentMessage[]): Promise<void> {
  try {
    await self.agent.prompt(messages);
    while (await self._handlePostAgentRun()) {
      await self.agent.continue();
    }
  } finally {
    self._flushPendingBashMessages();
  }
}

export async function do__handlePostAgentRun(self: AgentSession): Promise<boolean> {
  const msg = self._lastAssistantMessage;
  self._lastAssistantMessage = undefined;
  if (!msg) {
    return false;
  }

  // A terminal abort settles the whole current run. Queued messages may still
  // be inspected or restored by the caller, but must not start a fresh run
  // with a new, non-aborted signal after abort() has resolved.
  if (msg.stopReason === "aborted") {
    return false;
  }

  if (self._isRetryableError(msg) && (await self._prepareRetry(msg))) {
    return true;
  }

  if (msg.stopReason === "error" && self._retryAttempt > 0) {
    self._emit({
      type: "auto_retry_end",
      success: false,
      attempt: self._retryAttempt,
      finalError: msg.errorMessage,
    });
    self._retryAttempt = 0;
  }

  if (await self.checkCompaction(msg)) {
    return true;
  }

  // The agent loop drains both queues before emitting agent_end. Any messages
  // here were queued by agent_end extension handlers and need a continuation.
  return self.agent.hasQueuedMessages();
}
