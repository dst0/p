import type { ImageContent, Message, TextContent } from "@dst0/p-ai";
import type { BashExecutionMessage, CustomMessage } from "../../messages.ts";
import { generateId } from "../session-id.ts";
import type { SessionManager } from "../sessionmanager.ts";
import type {
  CompactionEntry,
  CustomEntry,
  CustomMessageEntry,
  LabelEntry,
  ModelChangeEntry,
  SessionEntry,
  SessionInfoEntry,
  SessionMessageEntry,
  ThinkingLevelChangeEntry,
} from "../types.ts";

export function do_appendMessage(
  self: SessionManager,
  message: Message | CustomMessage | BashExecutionMessage,
): string {
  const entry: SessionMessageEntry = {
    type: "message",
    id: generateId(self.byId),
    parentId: self.leafId,
    timestamp: new Date().toISOString(),
    message,
  };
  self._appendEntry(entry);
  return entry.id;
}

export function do_appendThinkingLevelChange(self: SessionManager, thinkingLevel: string): string {
  const entry: ThinkingLevelChangeEntry = {
    type: "thinking_level_change",
    id: generateId(self.byId),
    parentId: self.leafId,
    timestamp: new Date().toISOString(),
    thinkingLevel,
  };
  self._appendEntry(entry);
  return entry.id;
}

export function do_appendModelChange(self: SessionManager, provider: string, modelId: string): string {
  const entry: ModelChangeEntry = {
    type: "model_change",
    id: generateId(self.byId),
    parentId: self.leafId,
    timestamp: new Date().toISOString(),
    provider,
    modelId,
  };
  self._appendEntry(entry);
  return entry.id;
}

export function do_appendCompaction<T = unknown>(
  self: SessionManager,
  summary: string,
  firstKeptEntryId: string,
  tokensBefore: number,
  tokensAfter?: number,
  details?: T,
  fromHook?: boolean,
): string {
  const entry: CompactionEntry<T> = {
    type: "compaction",
    id: generateId(self.byId),
    parentId: self.leafId,
    timestamp: new Date().toISOString(),
    summary,
    firstKeptEntryId,
    tokensBefore,
    tokensAfter,
    details,
    fromHook,
  };
  self._appendEntry(entry);
  return entry.id;
}

export function do_appendCustomEntry(self: SessionManager, customType: string, data?: unknown): string {
  const entry: CustomEntry = {
    type: "custom",
    customType,
    data,
    id: generateId(self.byId),
    parentId: self.leafId,
    timestamp: new Date().toISOString(),
  };
  self._appendEntry(entry);
  return entry.id;
}

export function do_appendSessionInfo(self: SessionManager, name: string): string {
  const entry: SessionInfoEntry = {
    type: "session_info",
    id: generateId(self.byId),
    parentId: self.leafId,
    timestamp: new Date().toISOString(),
    name: name.trim(),
  };
  self._appendEntry(entry);
  return entry.id;
}

export function do_getSessionName(self: SessionManager): string | undefined {
  // Walk entries in reverse to find the latest session_info entry.
  // Empty names explicitly clear the session title.
  const entries = self.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "session_info") {
      return entry.name?.trim() || undefined;
    }
  }
  return undefined;
}

export function do_appendCustomMessageEntry<T = unknown>(
  self: SessionManager,
  customType: string,
  content: string | (TextContent | ImageContent)[],
  display: boolean,
  details?: T,
): string {
  const entry: CustomMessageEntry<T> = {
    type: "custom_message",
    customType,
    content,
    display,
    details,
    id: generateId(self.byId),
    parentId: self.leafId,
    timestamp: new Date().toISOString(),
  };
  self._appendEntry(entry);
  return entry.id;
}

export function do_getLeafId(self: SessionManager): string | null {
  return self.leafId;
}

export function do_getLeafEntry(self: SessionManager): SessionEntry | undefined {
  return self.leafId ? self.byId.get(self.leafId) : undefined;
}

export function do_getEntry(self: SessionManager, id: string): SessionEntry | undefined {
  return self.byId.get(id);
}

export function do_getChildren(self: SessionManager, parentId: string): SessionEntry[] {
  const children: SessionEntry[] = [];
  for (const entry of self.byId.values()) {
    if (entry.parentId === parentId) {
      children.push(entry);
    }
  }
  return children;
}

export function do_getLabel(self: SessionManager, id: string): string | undefined {
  return self.labelsById.get(id);
}

export function do_appendLabelChange(self: SessionManager, targetId: string, label: string | undefined): string {
  if (!self.byId.has(targetId)) {
    throw new Error(`Entry ${targetId} not found`);
  }
  const entry: LabelEntry = {
    type: "label",
    id: generateId(self.byId),
    parentId: self.leafId,
    timestamp: new Date().toISOString(),
    targetId,
    label,
  };
  self._appendEntry(entry);
  if (label) {
    self.labelsById.set(targetId, label);
    self.labelTimestampsById.set(targetId, entry.timestamp);
  } else {
    self.labelsById.delete(targetId);
    self.labelTimestampsById.delete(targetId);
  }
  return entry.id;
}
