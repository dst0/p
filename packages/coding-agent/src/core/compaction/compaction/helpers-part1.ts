import type { AgentMessage } from "@dst0/p-agent-core";
import type { AssistantMessage, Usage } from "@dst0/p-ai";
import { createBranchSummaryMessage, createCompactionSummaryMessage, createCustomMessage } from "../../messages.ts";
import type { CompactionEntry, SessionEntry } from "../../session-manager.ts";
import { DEFAULT_COMPACTION_SETTINGS } from "../default-settings.ts";
import { createFileOps, extractFileOpsFromMessage, type FileOperations } from "../utils.ts";
import { DATA_URL_PREFIX_CHARS, ESTIMATED_IMAGE_CHARS } from "./constants.ts";
import type { CompactionDetails, CompactionSettings, ResolvedCompactionSettings } from "./types.ts";

export function extractFileOperations(
  messages: AgentMessage[],
  entries: SessionEntry[],
  prevCompactionIndex: number,
): FileOperations {
  const fileOps = createFileOps();

  // Collect from previous compaction's details (if p-generated)
  if (prevCompactionIndex >= 0) {
    const prevCompaction = entries[prevCompactionIndex] as CompactionEntry;
    if (!prevCompaction.fromHook && prevCompaction.details) {
      // fromHook field kept for session file compatibility
      const details = prevCompaction.details as CompactionDetails;
      if (Array.isArray(details.readFiles)) {
        for (const f of details.readFiles) fileOps.read.add(f);
      }
      if (Array.isArray(details.modifiedFiles)) {
        for (const f of details.modifiedFiles) fileOps.edited.add(f);
      }
    }
  }

  // Extract from tool calls in messages
  for (const msg of messages) {
    extractFileOpsFromMessage(msg, fileOps);
  }

  return fileOps;
}

export function getMessageFromEntry(entry: SessionEntry): AgentMessage | undefined {
  if (entry.type === "message") {
    return entry.message;
  }
  if (entry.type === "custom_message") {
    return createCustomMessage(entry.customType, entry.content, entry.display, entry.details, entry.timestamp);
  }
  if (entry.type === "branch_summary") {
    return createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp);
  }
  if (entry.type === "compaction") {
    return createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp);
  }
  return undefined;
}

export function getMessageFromEntryForCompaction(entry: SessionEntry): AgentMessage | undefined {
  if (entry.type === "compaction") {
    return undefined;
  }
  return getMessageFromEntry(entry);
}

export function getMessageText(message: AgentMessage): string | undefined {
  switch (message.role) {
    case "user": {
      const content = (message as { content: string | Array<{ type: string; text?: string }> }).content;
      if (typeof content === "string") return content;
      return content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text)
        .join("\n");
    }
    case "toolResult": {
      const content = message.content;
      if (typeof content === "string") return content;
      return content
        .filter((c: { type: string; text?: string }) => c.type === "text" && c.text)
        .map((c: { type: string; text?: string }) => c.text)
        .join("\n");
    }
    case "assistant": {
      const assistant = message as AssistantMessage;
      return assistant.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { type: "text"; text: string }).text)
        .join("\n");
    }
    case "bashExecution": {
      return `${message.command}\n${message.output}`;
    }
    case "branchSummary":
    case "compactionSummary": {
      return message.summary;
    }
    default:
      return undefined;
  }
}

export function hasMeaningfulUserRequest(pathEntries: SessionEntry[]): boolean {
  return pathEntries.some((entry) => {
    if (entry.type !== "message" || entry.message.role !== "user") {
      return false;
    }
    return (getMessageText(entry.message)?.trim().length ?? 0) > 0;
  });
}

export function resolveCompactionSettings(settings: CompactionSettings): ResolvedCompactionSettings {
  return {
    enabled: settings.enabled,
    triggerReserveTokens:
      settings.reserveTokens ?? settings.triggerReserveTokens ?? DEFAULT_COMPACTION_SETTINGS.triggerReserveTokens!,
    triggerRatio:
      settings.triggerRatio ??
      (settings.reserveTokens !== undefined && settings.triggerReserveTokens === undefined
        ? undefined
        : DEFAULT_COMPACTION_SETTINGS.triggerRatio),
    keepRecentMinTokens:
      settings.keepRecentTokens ?? settings.keepRecentMinTokens ?? DEFAULT_COMPACTION_SETTINGS.keepRecentMinTokens!,
    keepRecentMaxTokens:
      settings.keepRecentTokens ?? settings.keepRecentMaxTokens ?? DEFAULT_COMPACTION_SETTINGS.keepRecentMaxTokens!,
    summaryMaxTokens: settings.summaryMaxTokens ?? DEFAULT_COMPACTION_SETTINGS.summaryMaxTokens!,
    renderedStateMaxTokens: settings.renderedStateMaxTokens ?? DEFAULT_COMPACTION_SETTINGS.renderedStateMaxTokens!,
    targetContextTokens: settings.targetContextTokens ?? DEFAULT_COMPACTION_SETTINGS.targetContextTokens!,
  };
}

export function calculateContextTokens(usage: Usage): number {
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

export function isUsageReliable(usage: Usage): boolean {
  return usage.input > 0 || usage.cacheRead > 0;
}

export function getAssistantUsage(msg: AgentMessage): Usage | undefined {
  if (msg.role === "assistant" && "usage" in msg) {
    const assistantMsg = msg as AssistantMessage;
    if (assistantMsg.stopReason !== "aborted" && assistantMsg.stopReason !== "error" && assistantMsg.usage) {
      return assistantMsg.usage;
    }
  }
  return undefined;
}

export function getLastAssistantUsage(entries: SessionEntry[]): Usage | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "message") {
      const usage = getAssistantUsage(entry.message);
      if (usage) return usage;
    }
  }
  return undefined;
}

export function getLastAssistantUsageInfo(
  messages: AgentMessage[],
  options: { sinceTimestamp?: number } = {},
): { usage: Usage; index: number } | undefined {
  let latestCompactionTimestamp = options.sinceTimestamp ?? 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "compactionSummary" && "timestamp" in msg && typeof msg.timestamp === "number") {
      latestCompactionTimestamp = Math.max(latestCompactionTimestamp, msg.timestamp);
      break;
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      if (
        latestCompactionTimestamp > 0 &&
        "timestamp" in msg &&
        typeof msg.timestamp === "number" &&
        msg.timestamp <= latestCompactionTimestamp
      ) {
        continue;
      }
      const usage = getAssistantUsage(msg);
      if (usage && isUsageReliable(usage)) return { usage, index: i };
    }
  }
  return undefined;
}

export function estimateImageContentChars(block: { data?: string; mimeType?: string }): number {
  const dataChars = typeof block.data === "string" ? block.data.length : 0;
  if (dataChars <= 0) {
    return ESTIMATED_IMAGE_CHARS;
  }
  const mimeTypeChars = typeof block.mimeType === "string" ? block.mimeType.length : 0;
  return Math.max(ESTIMATED_IMAGE_CHARS, DATA_URL_PREFIX_CHARS + mimeTypeChars + dataChars);
}

export function estimateTextAndImageContentChars(
  content: string | Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
): number {
  if (typeof content === "string") {
    return content.length;
  }

  let chars = 0;
  for (const block of content) {
    if (block.type === "text" && block.text) {
      chars += block.text.length;
    } else if (block.type === "image") {
      chars += estimateImageContentChars(block);
    }
  }
  return chars;
}

export function estimateTokens(message: AgentMessage): number {
  let chars = 0;

  switch (message.role) {
    case "user": {
      chars = estimateTextAndImageContentChars(
        (
          message as {
            content: string | Array<{ type: string; text?: string }>;
          }
        ).content,
      );
      return Math.ceil(chars / 4);
    }
    case "assistant": {
      const assistant = message as AssistantMessage;
      for (const block of assistant.content) {
        if (block.type === "text") {
          chars += block.text.length;
        } else if (block.type === "thinking") {
          chars += block.thinking.length;
        } else if (block.type === "toolCall") {
          chars += block.name.length + JSON.stringify(block.arguments).length;
        }
      }
      return Math.ceil(chars / 4);
    }
    case "custom":
    case "toolResult": {
      chars = estimateTextAndImageContentChars(message.content);
      return Math.ceil(chars / 4);
    }
    case "bashExecution": {
      chars = message.command.length + message.output.length;
      return Math.ceil(chars / 4);
    }
    case "branchSummary":
    case "compactionSummary": {
      chars = message.summary.length;
      return Math.ceil(chars / 4);
    }
  }

  return 0;
}
