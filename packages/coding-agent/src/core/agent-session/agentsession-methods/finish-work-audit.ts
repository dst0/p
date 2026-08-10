import { type AgentEvent, type AgentMessage, FINISH_WORK_TOOL_NAME } from "@dst0/p-agent-core";
import type { AssistantMessage, Message, TextContent } from "@dst0/p-ai";
import { isContextOverflow } from "@dst0/p-ai";
import {
  getLatestStructuredSessionState,
  mergeStructuredSessionState,
  parseSessionStateUpdateBlock,
  readSessionStateFile,
  STRUCTURED_SESSION_STATE_CUSTOM_TYPE,
  writeSessionStateFile,
} from "../../compaction/index.ts";
import type { AgentSession } from "../agentsession.ts";
import { MARK_SESSION_PROGRESS_TOOL_NAME, UPDATE_SESSION_STATE_TOOL_NAME } from "../constants.ts";
import { getFinishWorkRemainingWork, getFinishWorkStatus, getOpenSessionStateItems } from "../message-utils.ts";
import type { AgentSessionEvent } from "../session-types.ts";

export function do__getFinishWorkSessionStateBlockReason(self: AgentSession, args: unknown): string | undefined {
  const state =
    getLatestStructuredSessionState(self.sessionManager.getBranch()) ??
    readSessionStateFile(self._cwd, self.sessionManager.getSessionId());
  if (!state) {
    return undefined;
  }

  const status = getFinishWorkStatus(args);
  const openItems =
    status === "success"
      ? state.plan
          .filter((item) => item.status === "failed" || item.status === "blocked")
          .map((item) => `${item.text} (${item.status})`)
      : getOpenSessionStateItems(state);
  if (openItems.length === 0) {
    return undefined;
  }

  const remainingWork = getFinishWorkRemainingWork(args);
  if ((status === "partial" || status === "failed") && remainingWork.length > 0) {
    return undefined;
  }

  const preview = openItems
    .slice(0, 8)
    .map((item) => `- ${item}`)
    .join("\n");
  const suffix = openItems.length > 8 ? `\n- ...and ${openItems.length - 8} more` : "";
  if (status === "partial" || status === "failed") {
    return (
      `Cannot call ${FINISH_WORK_TOOL_NAME} with status "${status}" while session state has unresolved work ` +
      `unless remaining_work lists what is still unfinished:\n${preview}${suffix}`
    );
  }
  return (
    `Cannot call ${FINISH_WORK_TOOL_NAME} with status "${status ?? "success"}" while session state has ` +
    `unresolved work:\n${preview}${suffix}\n` +
    `Do not retry ${FINISH_WORK_TOOL_NAME} until a state-changing tool call succeeds. Call ` +
    `${MARK_SESSION_PROGRESS_TOOL_NAME} for completed existing items, call ${UPDATE_SESSION_STATE_TOOL_NAME} ` +
    `with action "replan" if the scope changed, or finish with status "partial" and remaining_work.`
  );
}

export function do__emit(self: AgentSession, event: AgentSessionEvent): void {
  for (const l of self._eventListeners) {
    l(event);
  }
}

export function do__emitQueueUpdate(self: AgentSession): void {
  self._emit({
    type: "queue_update",
    steering: [...self._steeringMessages],
    followUp: [...self._followUpMessages],
  });
}

export function do__willRetryAfterAgentEnd(
  self: AgentSession,
  event: Extract<AgentEvent, { type: "agent_end" }>,
): boolean {
  const settings = self.settingsManager.getRetrySettings();
  if (!settings.enabled) {
    return false;
  }

  for (let i = event.messages.length - 1; i >= 0; i--) {
    const message = event.messages[i];
    if (message.role === "assistant") {
      return self.willRetryMessage(message as AssistantMessage);
    }
  }
  return false;
}

export function do__isContextOverflowForCurrentModel(self: AgentSession, message: AssistantMessage): boolean {
  if (!self.model) return false;
  const sameModel = message.provider === self.model.provider && message.model === self.model.id;
  return sameModel && isContextOverflow(message, self.model.contextWindow ?? 0);
}

export function do__removeContextOverflowMessages(self: AgentSession, messages: AgentMessage[]): AgentMessage[] {
  return messages.filter((message) => {
    return message.role !== "assistant" || !self._isContextOverflowForCurrentModel(message as AssistantMessage);
  });
}

export function do__shouldHideContextOverflowMessage(self: AgentSession, message: AssistantMessage): boolean {
  return self._getEffectiveCompactionSettings().enabled && self._isContextOverflowForCurrentModel(message);
}

export function do__getUserMessageText(_self: AgentSession, message: Message): string {
  if (message.role !== "user") return "";
  const content = message.content;
  if (typeof content === "string") return content;
  const textBlocks = content.filter((c) => c.type === "text");
  return textBlocks.map((c) => (c as TextContent).text).join("");
}

export function do__findLastAssistantMessage(self: AgentSession): AssistantMessage | undefined {
  const messages = self.agent.state.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      return msg as AssistantMessage;
    }
  }
  return undefined;
}

export function do__replaceMessageInPlace(_self: AgentSession, target: AgentMessage, replacement: AgentMessage): void {
  // Agent-core stores the finalized message object in its state before emitting message_end.
  // SessionManager persistence happens later in _handleAgentEvent() with event.message.
  // Mutating this object in place keeps agent state, later turn/agent events, listeners,
  // and the eventual SessionManager.appendMessage(event.message) persistence in sync.
  if (target === replacement) {
    return;
  }

  const targetRecord = target as unknown as Record<string, unknown>;
  for (const key of Object.keys(targetRecord)) {
    delete targetRecord[key];
  }
  Object.assign(targetRecord, replacement);
}

export function do__getAssistantMessageText(_self: AgentSession, message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function do__replaceAssistantMessageText(
  _self: AgentSession,
  message: AssistantMessage,
  text: string,
): AssistantMessage {
  let replacedFirstTextBlock = false;
  const content = message.content
    .map((block) => {
      if (block.type !== "text") {
        return block;
      }
      if (!replacedFirstTextBlock) {
        replacedFirstTextBlock = true;
        return { ...block, text };
      }
      return { ...block, text: "" };
    })
    .filter((block) => block.type !== "text" || block.text.length > 0);
  return {
    ...message,
    content: replacedFirstTextBlock ? content : message.content,
  };
}

export function do__applyAssistantSessionStateUpdate(
  self: AgentSession,
  rawAssistantText: string,
  sourceEntryId: string,
): void {
  const parsed = parseSessionStateUpdateBlock(rawAssistantText, [sourceEntryId]);
  if (!parsed.patch) {
    return;
  }
  const branchEntries = self.sessionManager.getBranch();
  const previous = self._getCurrentStructuredSessionState(branchEntries);
  const state = mergeStructuredSessionState(previous, parsed.patch);
  self.sessionManager.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, state);
  writeSessionStateFile(self._cwd, state);
}
