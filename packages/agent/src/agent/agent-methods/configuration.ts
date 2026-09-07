import type { AgentEvent, AgentLoopConfig, AgentMessage } from "../../types.ts";
import type { Agent } from "../agent.ts";
import { EMPTY_USAGE } from "../constants.ts";

export function do_createLoopConfig(self: Agent, options: { skipInitialSteeringPoll?: boolean } = {}): AgentLoopConfig {
  let skipInitialSteeringPoll = options.skipInitialSteeringPoll === true;
  return {
    model: self._state.model,
    reasoning: self._state.thinkingLevel === "off" ? undefined : self._state.thinkingLevel,
    sessionId: self.sessionId,
    cacheRetention: self.cacheRetention,
    onPayload: self.onPayload,
    onResponse: self.onResponse,
    transport: self.transport,
    thinkingBudgets: self.thinkingBudgets,
    maxRetryDelayMs: self.maxRetryDelayMs,
    maxTokens: self.maxTokens,
    toolExecution: self.toolExecution,
    completionMode: self.completionMode,
    completionLimits: self.completionLimits,
    beforeToolCall: self.beforeToolCall,
    afterToolCall: self.afterToolCall,
    prepareNextTurn: self.prepareNextTurn
      ? async (context) => await self.prepareNextTurn?.(self.signal, context)
      : undefined,
    prepareModelCall: self.prepareModelCall
      ? async (context) => await self.prepareModelCall?.(context, self.signal)
      : undefined,
    convertToLlm: self.convertToLlm,
    transformContext: self.transformContext,
    getApiKey: self.getApiKey,
    getSteeringMessages: async () => {
      if (skipInitialSteeringPoll) {
        skipInitialSteeringPoll = false;
        return [];
      }
      return self.steeringQueue.drain();
    },
    getFollowUpMessages: async () => self.followUpQueue.drain(),
  };
}

export async function do_runWithLifecycle(
  self: Agent,
  executor: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  if (self.activeRun) {
    throw new Error("Agent is already processing.");
  }

  const abortController = new AbortController();
  let resolvePromise = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  self.activeRun = { promise, resolve: resolvePromise, abortController };

  self._state.isStreaming = true;
  self._state.streamingMessage = undefined;
  self._state.errorMessage = undefined;

  try {
    await executor(abortController.signal);
  } catch (error) {
    await self.handleRunFailure(error, abortController.signal.aborted);
  } finally {
    self.finishRun();
  }
}

export async function do_handleRunFailure(self: Agent, error: unknown, aborted: boolean): Promise<void> {
  const failureMessage = {
    role: "assistant",
    content: [{ type: "text", text: "" }],
    api: self._state.model.api,
    provider: self._state.model.provider,
    model: self._state.model.id,
    usage: EMPTY_USAGE,
    stopReason: aborted ? "aborted" : "error",
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  } satisfies AgentMessage;
  await self.processEvents({ type: "message_start", message: failureMessage });
  await self.processEvents({ type: "message_end", message: failureMessage });
  await self.processEvents({ type: "turn_end", message: failureMessage, toolResults: [] });
  await self.processEvents({ type: "agent_end", messages: [failureMessage] });
}

export function do_finishRun(self: Agent): void {
  self._state.isStreaming = false;
  self._state.streamingMessage = undefined;
  self._state.pendingToolCalls = new Set<string>();
  self.activeRun?.resolve();
  self.activeRun = undefined;
}

export async function do_processEvents(self: Agent, event: AgentEvent): Promise<void> {
  switch (event.type) {
    case "message_start":
      self._state.streamingMessage = event.message;
      break;

    case "message_update":
      self._state.streamingMessage = event.message;
      break;

    case "message_end":
      self._state.streamingMessage = undefined;
      self._state.messages.push(event.message);
      break;

    case "tool_execution_start": {
      const pendingToolCalls = new Set(self._state.pendingToolCalls);
      pendingToolCalls.add(event.toolCallId);
      self._state.pendingToolCalls = pendingToolCalls;
      break;
    }

    case "tool_execution_end": {
      const pendingToolCalls = new Set(self._state.pendingToolCalls);
      pendingToolCalls.delete(event.toolCallId);
      self._state.pendingToolCalls = pendingToolCalls;
      break;
    }

    case "turn_end":
      if (event.message.role === "assistant" && event.message.errorMessage) {
        self._state.errorMessage = event.message.errorMessage;
      }
      break;

    case "agent_end":
      self._state.streamingMessage = undefined;
      break;
  }

  const signal = self.activeRun?.abortController.signal;
  if (!signal) {
    throw new Error("Agent listener invoked outside active run");
  }
  for (const listener of self.listeners) {
    await listener(event, signal);
  }
}
