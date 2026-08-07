import type { SessionEntry } from "../../session-manager.ts";
import {
  createInitialStructuredSessionState,
  extractLooseSections,
  extractOptionalSection,
  getAgentMessageText,
} from "./helpers-part1.ts";
import {
  createStableId,
  createStatePatchFromSummary,
  mergeCanonicalRequest,
  mergeConstraints,
  mergeStringList,
} from "./helpers-part2.ts";
import { mergeDecisions, mergeEvidence, mergePlan } from "./helpers-part3.ts";
import type {
  PlanItem,
  PlanStatus,
  RelevantSymbol,
  StatePatch,
  StructuredSessionState,
  StructuredStateUpdateInput,
  TouchedFile,
} from "./types.ts";

export function normalizeFilePath(filePath: string): string | null {
  // Filter out /tmp/ scratch files
  if (filePath.startsWith("/tmp/") || filePath.startsWith("/var/folders/")) {
    return null;
  }

  // Convert absolute paths to relative (basename for paths outside project)
  if (filePath.startsWith("/")) {
    const parts = filePath.split("/");
    // Keep relative-like paths (e.g., "packages/foo/bar.ts") but not deep absolute paths
    if (parts.length <= 4) {
      // Short absolute path, keep as-is but strip leading /
      return filePath.slice(1);
    }
    // Deep absolute path - use basename to avoid leaking project paths
    return parts[parts.length - 1];
  }

  return filePath;
}

export function mergeTouchedFiles(existing: TouchedFile[], incoming: TouchedFile[]): TouchedFile[] {
  const byPath = new Map<string, TouchedFile>();

  // Process existing files with normalization
  for (const file of existing) {
    const normalized = normalizeFilePath(file.path);
    if (normalized === null) continue; // skip filtered files
    const entry = { ...file, path: normalized };
    if (!byPath.has(normalized) || entry.summary.length > byPath.get(normalized)!.summary.length) {
      byPath.set(normalized, entry);
    }
  }

  // Process incoming files with normalization
  for (const file of incoming) {
    const normalized = normalizeFilePath(file.path);
    if (normalized === null) continue; // skip filtered files
    const entry = { ...file, path: normalized };
    if (!byPath.has(normalized) || entry.summary.length > byPath.get(normalized)!.summary.length) {
      byPath.set(normalized, entry);
    }
  }

  return Array.from(byPath.values());
}

export function mergeRelevantSymbols(existing: RelevantSymbol[], incoming: RelevantSymbol[]): RelevantSymbol[] {
  const seen = new Set(existing.map((symbol) => `${symbol.file}:${symbol.name}`));
  for (const symbol of incoming) {
    const key = `${symbol.file}:${symbol.name}`;
    if (!seen.has(key)) {
      existing.push({ ...symbol });
      seen.add(key);
    }
  }
  return existing;
}

export function mergeStructuredSessionState(
  previous: StructuredSessionState,
  patch: StatePatch,
): StructuredSessionState {
  const next: StructuredSessionState = {
    ...previous,
    canonicalRequest: {
      current: previous.canonicalRequest.current,
      sourceEntryIds: [...previous.canonicalRequest.sourceEntryIds],
      originalRequests: (previous.canonicalRequest.originalRequests ?? []).map((request) => ({ ...request })),
      superseded: previous.canonicalRequest.superseded.map((item) => ({
        ...item,
      })),
    },
    constraints: previous.constraints.map((constraint) => ({ ...constraint })),
    plan: previous.plan.map((item) => ({
      ...item,
      evidenceEntryIds: [...item.evidenceEntryIds],
    })),
    decisions: previous.decisions.map((decision) => ({
      ...decision,
      evidencePointers: decision.evidencePointers.map((pointer) => ({
        ...pointer,
      })),
    })),
    codebase: {
      touchedFiles: previous.codebase.touchedFiles.map((file) => ({ ...file })),
      relevantSymbols: previous.codebase.relevantSymbols.map((symbol) => ({
        ...symbol,
      })),
    },
    evidence: previous.evidence.map((pointer) => ({ ...pointer })),
    audit: {
      lastCompactionAt: previous.audit.lastCompactionAt,
      compactionCount: previous.audit.compactionCount,
      knownRisks: [...previous.audit.knownRisks],
    },
  };

  if (patch.canonicalRequest) {
    mergeCanonicalRequest(next, patch.canonicalRequest);
  }
  if (patch.constraints) {
    mergeConstraints(next, patch.constraints);
  }
  if (patch.plan) {
    mergePlan(next, patch.plan);
  }
  if (patch.decisions) {
    mergeDecisions(next, patch.decisions);
  }
  if (patch.codebase) {
    next.codebase = {
      touchedFiles: mergeTouchedFiles(next.codebase.touchedFiles, patch.codebase.touchedFiles ?? []),
      relevantSymbols: mergeRelevantSymbols(next.codebase.relevantSymbols, patch.codebase.relevantSymbols ?? []),
    };
  }
  if (patch.evidence?.add) {
    next.evidence = mergeEvidence(next.evidence, patch.evidence.add);
  }
  if (patch.audit) {
    next.audit = {
      lastCompactionAt: patch.audit.lastCompactionAt ?? next.audit.lastCompactionAt,
      compactionCount: patch.audit.compactionCount ?? next.audit.compactionCount,
      knownRisks: mergeStringList(next.audit.knownRisks, patch.audit.knownRisks),
    };
  }

  next.codebase.touchedFiles = mergeTouchedFiles(next.codebase.touchedFiles, []);

  // Filter dead evidence and prune to max 50
  next.evidence = next.evidence
    .filter((e) => {
      const pathEmpty = e.path !== undefined && e.path.trim().length === 0;
      const isFile = e.kind === "file";
      const hasPath = e.path && e.path.trim().length > 0;
      const hasEntryId = e.entryId && e.entryId.trim().length > 0;
      const isToolResult = e.kind === "tool_result";
      return e.id && !pathEmpty && (!isFile || hasPath) && (hasEntryId || hasPath || isToolResult || !e.retrieveWhen);
    })
    .slice(-50);

  return next;
}

export function createStructuredSessionState(input: StructuredStateUpdateInput): StructuredSessionState {
  const previous = input.previous ?? createInitialStructuredSessionState(input.sessionId);
  const patch = createStatePatchFromSummary(input);
  return mergeStructuredSessionState(previous, patch);
}

export function hasDurablePreviousGoal(previous: StructuredSessionState | undefined): boolean {
  if (!previous?.canonicalRequest.current.trim()) return false;
  return (
    (previous.canonicalRequest.originalRequests?.length ?? 0) > 0 ||
    previous.plan.length > 0 ||
    previous.decisions.length > 0 ||
    previous.codebase.touchedFiles.length > 0 ||
    previous.evidence.length > 0 ||
    previous.audit.knownRisks.length > 0
  );
}

export function createSessionStateUpdateBlockRegex(): RegExp {
  return /<session_state_update>\s*([\s\S]*?)\s*<\/session_state_update>/g;
}

export function stripSessionStateUpdateBlocks(text: string): string {
  return text.replace(createSessionStateUpdateBlockRegex(), "").trim();
}

export function stripStructuredContextBlocks(text: string): string {
  return stripSessionStateUpdateBlocks(text)
    .replace(/<session_checkpoint>[\s\S]*?<\/session_checkpoint>/g, "")
    .replace(/<working_state>[\s\S]*?<\/working_state>/g, "")
    .trim();
}

export function createLiveConversationMarkdown(entries: SessionEntry[]): string {
  const messages: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    if (entry.message.role !== "assistant" && entry.message.role !== "custom") continue;
    const text = stripStructuredContextBlocks(getAgentMessageText(entry.message)).trim();
    if (text) {
      messages.push(text);
    }
  }
  return messages.slice(-12).join("\n\n");
}

export function parsePlanStatus(value: string): PlanStatus {
  switch (value.toLowerCase()) {
    case ".":
      return "in_progress";
    case "v":
    case "x":
      return "done";
    case "-":
      return "failed";
    case "!":
      return "blocked";
    default:
      return "not_started";
  }
}

export function extractPlanItems(markdown: string, sourceEntryIds: string[]): PlanItem[] {
  const section = [extractOptionalSection(markdown, "Plan"), ...extractLooseSections(markdown, ["Plan"])]
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .join("\n");
  const items: PlanItem[] = [];
  const seen = new Set<string>();
  for (const rawLine of section.split("\n")) {
    const line = rawLine.trim();
    const checkboxMatch = line.match(/^-\s+\[([ .vx!-])\]\s+(.+)$/i);
    const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    const bulletMatch = line.match(/^-\s+(.+)$/);
    const text = (checkboxMatch?.[2] ?? numberedMatch?.[1] ?? bulletMatch?.[1] ?? "").trim();
    if (!text) continue;
    if (text === "(none)") continue;
    const id = createStableId("plan", text);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      text,
      status: checkboxMatch ? parsePlanStatus(checkboxMatch[1]) : "not_started",
      evidenceEntryIds: [...sourceEntryIds],
    });
  }
  return items;
}
