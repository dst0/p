import type { AgentEvent } from "@dst0/p-agent-core";
import type { AssistantMessage } from "@dst0/p-ai";
import { cleanupSessionResources } from "@dst0/p-ai";
import type {
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
  ToolDefinition,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  ToolExecutionUpdateEvent,
  ToolInfo,
  TurnEndEvent,
  TurnStartEvent,
} from "../../extensions/index.ts";
import type { TokenBreakdown } from "../../token-accounting.ts";
import type { AgentSession } from "../agentsession.ts";
import { isInternalCompletionProtocolRepairMessage } from "../message-utils.ts";
import type { AgentSessionEventListener } from "../session-types.ts";

export async function do__emitExtensionEvent(self: AgentSession, event: AgentEvent): Promise<void> {
  if (event.type === "agent_start") {
    self._turnIndex = 0;
    await self._extensionRunner.emit({ type: "agent_start" });
  } else if (event.type === "agent_end") {
    await self._extensionRunner.emit({
      type: "agent_end",
      messages: event.messages.filter((message) => !isInternalCompletionProtocolRepairMessage(message)),
    });
  } else if (event.type === "turn_start") {
    const extensionEvent: TurnStartEvent = {
      type: "turn_start",
      turnIndex: self._turnIndex,
      timestamp: Date.now(),
    };
    await self._extensionRunner.emit(extensionEvent);
  } else if (event.type === "turn_end") {
    const extensionEvent: TurnEndEvent = {
      type: "turn_end",
      turnIndex: self._turnIndex,
      message: event.message,
      toolResults: event.toolResults,
    };
    await self._extensionRunner.emit(extensionEvent);
    self._turnIndex++;
  } else if (event.type === "message_start") {
    const extensionEvent: MessageStartEvent = {
      type: "message_start",
      message: event.message,
    };
    await self._extensionRunner.emit(extensionEvent);
  } else if (event.type === "message_update") {
    const extensionEvent: MessageUpdateEvent = {
      type: "message_update",
      message: event.message,
      assistantMessageEvent: event.assistantMessageEvent,
    };
    await self._extensionRunner.emit(extensionEvent);
  } else if (event.type === "message_end") {
    const extensionEvent: MessageEndEvent = {
      type: "message_end",
      message: event.message,
    };
    const replacement = await self._extensionRunner.emitMessageEnd(extensionEvent);
    if (replacement) {
      self._replaceMessageInPlace(event.message, replacement);
    }
  } else if (event.type === "tool_execution_start") {
    const extensionEvent: ToolExecutionStartEvent = {
      type: "tool_execution_start",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: event.args,
    };
    await self._extensionRunner.emit(extensionEvent);
  } else if (event.type === "tool_execution_update") {
    const extensionEvent: ToolExecutionUpdateEvent = {
      type: "tool_execution_update",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: event.args,
      partialResult: event.partialResult,
    };
    await self._extensionRunner.emit(extensionEvent);
  } else if (event.type === "tool_execution_end") {
    const extensionEvent: ToolExecutionEndEvent = {
      type: "tool_execution_end",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      result: event.result,
      isError: event.isError,
    };
    await self._extensionRunner.emit(extensionEvent);
  }
}

export function do_subscribe(self: AgentSession, listener: AgentSessionEventListener): () => void {
  self._eventListeners.push(listener);

  // Return unsubscribe function for this specific listener
  return () => {
    const index = self._eventListeners.indexOf(listener);
    if (index !== -1) {
      self._eventListeners.splice(index, 1);
    }
  };
}

export function do__disconnectFromAgent(self: AgentSession): void {
  if (self._unsubscribeAgent) {
    self._unsubscribeAgent();
    self._unsubscribeAgent = undefined;
  }
}

export function do__reconnectToAgent(self: AgentSession): void {
  if (self._unsubscribeAgent) return; // Already connected
  self._unsubscribeAgent = self.agent.subscribe(self._handleAgentEvent);
}

export function do_dispose(self: AgentSession): void {
  try {
    self.abortRetry();
    self.abortCompaction();
    self.abortBranchSummary();
    self.abortBash();
    self.agent.abort();
  } catch {
    // Dispose must succeed even if an abort hook throws.
  }

  self._extensionRunner.invalidate(
    "This extension ctx is stale after session replacement or reload. Do not use a captured p or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().",
  );
  self._disconnectFromAgent();
  self._eventListeners = [];
  cleanupSessionResources(self.sessionId);
}

export function do_getLastTokenBreakdown(self: AgentSession): TokenBreakdown | undefined {
  return self._lastTokenBreakdown;
}

export function do_willRetryMessage(self: AgentSession, message: AssistantMessage): boolean {
  const settings = self.settingsManager.getRetrySettings();
  if (!settings.enabled) {
    return false;
  }
  const maxRetries = self._getEffectiveRetryMaxAttempts(message, settings.maxRetries);
  return self._retryAttempt < maxRetries && self._isRetryableError(message);
}

export function do_getActiveToolNames(self: AgentSession): string[] {
  return self.agent.state.tools.map((t) => t.name);
}

export function do_getAllTools(self: AgentSession): ToolInfo[] {
  return Array.from(self._toolDefinitions.values()).map(({ definition, sourceInfo }) => ({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    promptGuidelines: definition.promptGuidelines,
    sourceInfo,
  }));
}

export function do_getToolDefinition(self: AgentSession, name: string): ToolDefinition | undefined {
  return self._toolDefinitions.get(name)?.definition;
}
