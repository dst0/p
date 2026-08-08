import type { AgentMessage } from "@dst0/p-agent-core";
import {
  type CompactionDetails,
  estimateTokens,
  type StatePatch,
  type StructuredSessionState,
} from "../compaction/index.ts";
import type { ParsedSkillBlock } from "./session-types.ts";

export function parseSkillBlock(text: string): ParsedSkillBlock | null {
  const match = text.match(/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/);
  if (!match) return null;
  return {
    name: match[1],
    location: match[2],
    content: match[3],
    userMessage: match[4]?.trim() || undefined,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeStateText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function capStateToolText(text: string, maxChars: number): string {
  const normalized = normalizeStateText(text);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  const hardLimit = Math.max(20, maxChars - 1);
  const prefix = normalized.slice(0, hardLimit);
  const wordBreak = prefix.lastIndexOf(" ");
  const cutAt = wordBreak > Math.floor(maxChars * 0.35) ? wordBreak : hardLimit;
  return `${prefix.slice(0, cutAt).trimEnd()}...`;
}

export function createStateToolStableId(prefix: string, text: string): string {
  const normalized = normalizeStateText(text).toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index++) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16)}`;
}

export function hasStateToolPatchContent(patch: StatePatch): boolean {
  return (
    patch.canonicalRequest !== undefined ||
    (patch.plan?.replace?.length ?? 0) > 0 ||
    (patch.plan?.add?.length ?? 0) > 0 ||
    (patch.plan?.update?.length ?? 0) > 0 ||
    (patch.decisions?.add?.length ?? 0) > 0 ||
    (patch.codebase?.touchedFiles?.length ?? 0) > 0 ||
    (patch.evidence?.add?.length ?? 0) > 0 ||
    patch.audit !== undefined
  );
}

export function getOpenSessionStateItems(state: StructuredSessionState): string[] {
  const openPlanItems = state.plan
    .filter((item) => item.status !== "done")
    .map((item) => `${item.text} (${item.status})`);
  if (openPlanItems.length > 0) {
    return openPlanItems;
  }
  return [];
}

export function getFinishWorkStatus(args: unknown): string | undefined {
  return isRecord(args) && typeof args.status === "string" ? args.status : undefined;
}

export function reconcilePlanItemsForSuccessFinish(state: StructuredSessionState): StructuredSessionState | undefined {
  let changed = false;
  const plan = state.plan.map((item) => {
    if (item.status === "not_started" || item.status === "in_progress") {
      changed = true;
      return { ...item, status: "done" as const };
    }
    return item;
  });
  if (!changed) {
    return undefined;
  }
  return {
    ...state,
    plan,
  };
}

export function getFinishWorkRemainingWork(args: unknown): string[] {
  if (!isRecord(args) || !Array.isArray(args.remaining_work)) {
    return [];
  }
  return args.remaining_work
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function isInternalCompletionProtocolRepairMessage(message: AgentMessage): boolean {
  return (
    message.role === "user" && isRecord(message.metadata) && message.metadata.pInternal === "completion_protocol_repair"
  );
}

export function normalizeCompactionDetails(details: unknown): CompactionDetails {
  if (!isRecord(details)) {
    return { readFiles: [], modifiedFiles: [] };
  }
  const readFiles = Array.isArray(details.readFiles)
    ? details.readFiles.filter((value): value is string => typeof value === "string")
    : [];
  const modifiedFiles = Array.isArray(details.modifiedFiles)
    ? details.modifiedFiles.filter((value): value is string => typeof value === "string")
    : [];
  return {
    ...details,
    readFiles,
    modifiedFiles,
  } as CompactionDetails;
}

export function getMessageTextForRecall(message: AgentMessage): string {
  switch (message.role) {
    case "user":
      return typeof message.content === "string"
        ? message.content
        : message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n");
    case "assistant":
      return message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    case "toolResult":
      return message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    case "bashExecution":
      return `${message.command}\n${message.output}`;
    case "custom":
      return typeof message.content === "string"
        ? message.content
        : message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n");
    case "branchSummary":
    case "compactionSummary":
      return message.summary;
  }
}

export function estimateToolResultTokens(messages: AgentMessage[]): number {
  let tokens = 0;
  for (const message of messages) {
    if (message.role === "toolResult") {
      tokens += estimateTokens(message);
    }
  }
  return tokens;
}
