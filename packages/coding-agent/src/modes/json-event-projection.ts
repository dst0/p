import type { ToolCall } from "@dst0/p-ai";
import type { AgentSessionEvent } from "../core/agent-session/session-types.ts";

type MessageUpdateEvent = Extract<AgentSessionEvent, { type: "message_update" }>;

interface JsonMessageUpdateEvent {
  type: "message_update";
  assistantMessageEvent: Record<string, unknown>;
}

function getToolCallIdentity(event: MessageUpdateEvent): Pick<ToolCall, "id" | "name"> | undefined {
  const assistantEvent = event.assistantMessageEvent;
  if (assistantEvent.type !== "toolcall_start" && assistantEvent.type !== "toolcall_delta") return undefined;
  const block = assistantEvent.partial.content[assistantEvent.contentIndex];
  if (block?.type !== "toolCall") return undefined;
  return { id: block.id, name: block.name };
}

function projectMessageUpdate(event: MessageUpdateEvent): JsonMessageUpdateEvent {
  if (!("partial" in event.assistantMessageEvent)) {
    return { type: "message_update", assistantMessageEvent: event.assistantMessageEvent };
  }
  const { partial: _partial, ...assistantMessageEvent } = event.assistantMessageEvent;
  const toolCall = getToolCallIdentity(event);
  return {
    type: "message_update",
    assistantMessageEvent: toolCall ? { ...assistantMessageEvent, toolCall } : assistantMessageEvent,
  };
}

/**
 * Removes cumulative streaming snapshots from JSON output. The surrounding
 * message_start/message_end events plus ordered deltas remain lossless, while
 * tool-call identity is retained for incremental argument reconstruction.
 */
export function projectJsonEvent(event: AgentSessionEvent): AgentSessionEvent | JsonMessageUpdateEvent {
  return event.type === "message_update" ? projectMessageUpdate(event) : event;
}
