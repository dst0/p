import type { AgentMessage } from "@dst0/p-agent-core";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getAgentDir as getDefaultAgentDir } from "../../config.ts";
import { resolvePath } from "../../utils/paths.ts";
import { createBranchSummaryMessage, createCompactionSummaryMessage, createCustomMessage } from "../messages.ts";
import type { CompactionEntry, FileEntry, SessionContext, SessionEntry } from "./types-part1.ts";

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  byId?: Map<string, SessionEntry>,
): SessionContext {
  // Build uuid index if not available
  if (!byId) {
    byId = new Map<string, SessionEntry>();
    for (const entry of entries) {
      byId.set(entry.id, entry);
    }
  }

  // Find leaf
  let leaf: SessionEntry | undefined;
  if (leafId === null) {
    // Explicitly null - return no messages (navigated to before first entry)
    return { messages: [], thinkingLevel: "off", model: null };
  }
  if (leafId) {
    leaf = byId.get(leafId);
  }
  if (!leaf) {
    // Fallback to last entry (when leafId is undefined)
    leaf = entries[entries.length - 1];
  }

  if (!leaf) {
    return { messages: [], thinkingLevel: "off", model: null };
  }

  // Walk from leaf to root, collecting path
  const path: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  // Extract settings and find compaction
  let thinkingLevel = "off";
  let model: { provider: string; modelId: string } | null = null;
  let hasExplicitModelChange = false;
  let compaction: CompactionEntry | null = null;

  for (const entry of path) {
    if (entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel;
    } else if (entry.type === "model_change") {
      model = { provider: entry.provider, modelId: entry.modelId };
      hasExplicitModelChange = true;
    } else if (entry.type === "message" && entry.message.role === "assistant" && !hasExplicitModelChange) {
      model = { provider: entry.message.provider, modelId: entry.message.model };
    } else if (entry.type === "compaction") {
      compaction = entry;
    }
  }

  // Build messages and collect corresponding entries.
  // When there's a compaction, firstKeptEntryId marks the recent raw suffix kept
  // after the summarized history. Emit that suffix first so provider prompts still
  // begin with a normal user/assistant turn, then add the summary and newer messages.
  const messages: AgentMessage[] = [];

  const appendMessage = (entry: SessionEntry) => {
    if (entry.type === "message") {
      messages.push(entry.message);
    } else if (entry.type === "custom_message") {
      messages.push(
        createCustomMessage(entry.customType, entry.content, entry.display, entry.details, entry.timestamp),
      );
    } else if (entry.type === "branch_summary" && entry.summary) {
      messages.push(createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp));
    }
  };

  if (compaction) {
    // Find compaction index in path
    const compactionIdx = path.findIndex((e) => e.type === "compaction" && e.id === compaction.id);

    let foundFirstKept = false;
    for (let i = 0; i < compactionIdx; i++) {
      const entry = path[i];
      if (entry.id === compaction.firstKeptEntryId) {
        foundFirstKept = true;
      }
      if (foundFirstKept) {
        appendMessage(entry);
      }
    }

    messages.push(
      createCompactionSummaryMessage(
        compaction.summary,
        compaction.tokensBefore,
        compaction.timestamp,
        compaction.tokensAfter,
      ),
    );

    // Emit messages after compaction
    for (let i = compactionIdx + 1; i < path.length; i++) {
      const entry = path[i];
      appendMessage(entry);
    }
  } else {
    // No compaction - emit all messages, handle branch summaries and custom messages
    for (const entry of path) {
      appendMessage(entry);
    }
  }

  return { messages, thinkingLevel, model };
}

export function getDefaultSessionDirPath(cwd: string, agentDir: string = getDefaultAgentDir()): string {
  const resolvedCwd = resolvePath(cwd);
  const resolvedAgentDir = resolvePath(agentDir);
  const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(resolvedAgentDir, "sessions", safePath);
}

export function getDefaultSessionDir(cwd: string, agentDir: string = getDefaultAgentDir()): string {
  const sessionDir = getDefaultSessionDirPath(cwd, agentDir);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
  return sessionDir;
}

export function parseSessionEntryLine(line: string): FileEntry | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as FileEntry;
  } catch {
    // Skip malformed lines
    return null;
  }
}
