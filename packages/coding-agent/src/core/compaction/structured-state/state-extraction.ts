import type { AgentMessage } from "@dst0/p-agent-core";
import type { SessionEntry } from "../../session-manager.ts";
import {
  MAX_CANONICAL_REQUEST_CHARS,
  MAX_REQUEST_SUMMARY_CHARS,
  STRUCTURED_SESSION_STATE_CUSTOM_TYPE,
  STRUCTURED_SESSION_STATE_VERSION,
} from "./constants.ts";
import type { OriginalUserRequest, StructuredSessionState } from "./types.ts";

export function createInitialStructuredSessionState(sessionId: string): StructuredSessionState {
  return {
    version: STRUCTURED_SESSION_STATE_VERSION,
    sessionId,
    canonicalRequest: {
      current: "",
      sourceEntryIds: [],
      originalRequests: [],
      superseded: [],
    },
    constraints: [],
    plan: [],
    decisions: [],
    codebase: {
      touchedFiles: [],
      relevantSymbols: [],
    },
    evidence: [],
    audit: {
      lastCompactionAt: "",
      compactionCount: 0,
      knownRisks: [],
    },
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStructuredSessionState(value: unknown): value is StructuredSessionState {
  if (!isRecord(value)) return false;
  return (
    value.version === STRUCTURED_SESSION_STATE_VERSION &&
    typeof value.sessionId === "string" &&
    isRecord(value.canonicalRequest) &&
    Array.isArray(value.constraints) &&
    Array.isArray(value.plan) &&
    Array.isArray(value.decisions) &&
    isRecord(value.codebase) &&
    Array.isArray(value.evidence) &&
    isRecord(value.audit)
  );
}

export function getLatestStructuredSessionState(entries: SessionEntry[]): StructuredSessionState | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== STRUCTURED_SESSION_STATE_CUSTOM_TYPE) continue;
    if (isStructuredSessionState(entry.data)) {
      return entry.data;
    }
  }
  return undefined;
}

export function extractOptionalSection(markdown: string, heading: string): string | undefined {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^##\\s+${escapedHeading}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "m"));
  return match?.[1]?.trim();
}

export function extractSection(markdown: string, heading: string): string {
  return extractOptionalSection(markdown, heading) ?? "";
}

export function getAgentMessageText(message: AgentMessage): string {
  if (message.role === "user" || message.role === "custom") {
    return typeof message.content === "string"
      ? message.content
      : message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
  }
  if (message.role === "assistant" || message.role === "toolResult") {
    return message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  }
  if (message.role === "bashExecution") {
    return `${message.command}\n${message.output}`;
  }
  return message.summary;
}

export function isExplicitGoalCorrection(text: string): boolean {
  return /\b(correction|actually|instead|new goal|change the goal|change goal|updated request|do this instead)\b/i.test(
    text,
  );
}

export function classifyUserRequest(text: string, userIndex: number): OriginalUserRequest["kind"] {
  if (isExplicitGoalCorrection(text)) return "correction";
  return userIndex === 0 ? "request" : "follow_up";
}

export function stripCorrectionPrefix(text: string): string {
  return text
    .replace(/^(correction|actually|instead|new goal|updated request)\s*[:,-]?\s*/i, "")
    .replace(/^change (the )?goal\s*[:,-]?\s*/i, "")
    .replace(/^do this instead\s*[:,-]?\s*/i, "")
    .trim();
}

export function capSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const hardLimit = Math.max(20, maxChars - 1);
  const prefix = text.slice(0, hardLimit);
  const sentenceBreak = Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf("! "), prefix.lastIndexOf("? "));
  const wordBreak = prefix.lastIndexOf(" ");
  const cutAt = sentenceBreak > Math.floor(maxChars * 0.35) ? sentenceBreak + 1 : wordBreak > 0 ? wordBreak : hardLimit;
  return `${prefix.slice(0, cutAt).trimEnd()}...`;
}

export function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function summarizeUserRequest(text: string): string {
  const cleaned = stripCorrectionPrefix(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("```"))
    .slice(0, 4)
    .join(" ");
  return capSentence(compactWhitespace(cleaned || text), MAX_REQUEST_SUMMARY_CHARS);
}

export function collectOriginalUserRequests(
  entries: SessionEntry[],
  existingRequests?: OriginalUserRequest[],
): OriginalUserRequest[] {
  const requests: OriginalUserRequest[] = [];
  const existingCount = existingRequests?.length ?? 0;
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const text = getAgentMessageText(entry.message).trim();
    if (!text) continue;
    const kind = classifyUserRequest(text, requests.length);
    const reqIndex = existingCount + requests.length + 1;
    requests.push({
      id: `req-${reqIndex}`,
      entryId: entry.id,
      timestamp: entry.timestamp,
      kind,
      text,
      summary: summarizeUserRequest(text),
    });
  }
  return requests;
}

export function isActionableUserRequestSummary(summary: string): boolean {
  const normalized = compactWhitespace(summary).toLowerCase();
  if (!normalized) return false;
  if (/^turn\s+\d+\s+of\s+\d+\b/.test(normalized)) return true;
  if (normalized.length < 24) return false;
  if (
    /^(continue|continue again|keep going|go on|next|proceed|resume|retry|again|ok|okay|yes|good|world|hello|hi|do it)\.?$/i.test(
      normalized,
    )
  ) {
    return false;
  }
  return /\b(add|analy[sz]e|build|change|check|commit|convert|create|deploy|finish|fix|implement|install|investigate|make|read|remove|rename|report|run|test|update|use|verify|write)\b/i.test(
    normalized,
  );
}

export function findLatestActionableRequest(requests: OriginalUserRequest[]): OriginalUserRequest | undefined {
  return [...requests]
    .reverse()
    .find((request) => request.kind !== "correction" && isActionableUserRequestSummary(request.summary));
}

export function normalizeCanonicalRequest(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const withoutPrefix = stripCorrectionPrefix(trimmed);
  const paragraphs = withoutPrefix
    .split(/\n\s*\n/)
    .map((paragraph) => compactWhitespace(paragraph.replace(/^#+\s*/, "")))
    .filter((paragraph) => paragraph.length > 0 && !paragraph.startsWith("```"));
  const candidate = paragraphs[0] ?? compactWhitespace(withoutPrefix);
  return capSentence(candidate, MAX_CANONICAL_REQUEST_CHARS);
}

export function isPlaceholderGoal(goal: string): boolean {
  if (!goal) return true;
  const normalized = compactWhitespace(goal).toLowerCase();
  return (
    /^(awaiting|waiting for) (initial )?user (prompt|input|request)\b/i.test(normalized) ||
    /^no conversation provided\b/i.test(normalized) ||
    /^(no goal|none|n\/a|unknown|not set|unchanged|same as before)\.?$/i.test(normalized)
  );
}

export function createPlainSummaryFallback(summary: string): string {
  return normalizeCanonicalRequest(
    summary
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 6)
      .join(" "),
  );
}

export function cleanupHeadingLabel(label: string): string {
  return label.replace(/[*:]+$/g, "").trim();
}

export function normalizeHeadingLabel(label: string): string {
  return cleanupHeadingLabel(label).toLowerCase().replace(/\s+/g, " ");
}

export function parseLooseHeading(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  const markdownMatch = trimmed.match(/^#{1,6}\s+(.+?)\s*$/);
  if (markdownMatch) return cleanupHeadingLabel(markdownMatch[1]);
  const boldMatch = trimmed.match(/^\*\*(.+?)\*\*:?\s*$/);
  if (boldMatch) return cleanupHeadingLabel(boldMatch[1]);
  const colonMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9 &/_-]{1,80}):\s*$/);
  if (colonMatch) return cleanupHeadingLabel(colonMatch[1]);
  return undefined;
}

export function extractLooseSections(markdown: string, headings: string[]): string[] {
  const wanted = new Set(headings.map(normalizeHeadingLabel));
  const sections: string[] = [];
  const current: string[] = [];
  let collecting = false;

  for (const rawLine of markdown.split("\n")) {
    const heading = parseLooseHeading(rawLine);
    if (heading) {
      if (collecting && current.length > 0) {
        sections.push(current.join("\n").trim());
      }
      current.length = 0;
      collecting = wanted.has(normalizeHeadingLabel(heading));
      continue;
    }
    if (collecting) {
      current.push(rawLine);
    }
  }

  if (collecting && current.length > 0) {
    sections.push(current.join("\n").trim());
  }

  return sections.filter((section) => section.length > 0);
}

export function extractBulletLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) =>
      line
        .slice(2)
        .replace(/^\[[ .vx!-]\]\s*/i, "")
        .trim(),
    )
    .filter((line) => line.length > 0 && line !== "(none)");
}
