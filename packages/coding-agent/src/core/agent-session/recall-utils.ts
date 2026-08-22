import type { AgentMessage } from "@dst0/p-agent-core";
import type { ImageContent, TextContent } from "@dst0/p-ai";
import { stripSessionStateUpdateBlocks } from "../compaction/index.ts";
import { getMessageTextForRecall } from "./message-utils.ts";
import type { RecallCandidate, RecallResult, ToolResultContextExtract } from "./state-types.ts";

export function hashAnchorText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function getUserMessageAnchorKey(message: AgentMessage): string | undefined {
  if (message.role !== "user") return undefined;
  const text = getMessageTextForRecall(message);
  return `${message.timestamp}:${text.length}:${hashAnchorText(text)}`;
}

export function capTextByTokens(text: string, maxTokens: number): string {
  const maxChars = Math.max(0, Math.floor(maxTokens * 4));
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[...truncated to ${maxTokens} tokens...]`;
}

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function summarizeSubagentTranscript(messages: AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = getMessageTextForRecall(message).replace(/\s+/g, " ").trim();
    if (text) return capTextByTokens(text, 300);
  }
  return "Subagent completed without a textual assistant digest.";
}

export function getTextContentBlocks(content: (TextContent | ImageContent)[]): TextContent[] {
  return content.filter((block): block is TextContent => block.type === "text");
}

export function getToolResultText(content: (TextContent | ImageContent)[]): string {
  return getTextContentBlocks(content)
    .map((block) => block.text)
    .join("\n");
}

export function normalizeToolExtractLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

export function createDeterministicToolExtract(
  toolName: string,
  text: string,
  isError: boolean,
  error?: string,
): ToolResultContextExtract {
  const lines = text.split(/\r?\n/).map(normalizeToolExtractLine).filter(Boolean);
  const importantPatterns =
    /(error|failed|exception|warning|warn|timeout|denied|not found|cannot|todo|fixme|modified|created|deleted|passed|failed|tests?|file|path|line|\.(ts|tsx|js|jsx|json|md|py|rs|go|css|html)\b)/i;
  const important = lines.filter((line) => importantPatterns.test(line));
  const selected: string[] = [];
  for (const line of [...important.slice(0, 12), ...lines.slice(0, 4), ...lines.slice(-4)]) {
    if (selected.includes(line)) continue;
    selected.push(line);
    if (selected.length >= 12) break;
  }
  const firstLine = selected[0] ?? lines[0] ?? "(no textual output)";
  const summary = capTextByTokens(
    `${toolName} ${isError ? "failed" : "completed"}; extracted ${selected.length} notable line(s). First notable line: ${firstLine}`,
    120,
  );
  return {
    summary,
    relevantLines: selected.map((line) => capTextByTokens(line, 80)),
    source: "deterministic",
    error,
  };
}

export function parseToolExtractResponse(
  text: string,
  modelLabel: string,
  fallback: ToolResultContextExtract,
): ToolResultContextExtract {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return fallback;
  }
  const summary = capTextByTokens(lines[0], 140);
  const relevantLines = lines.slice(1, 13).map((line) => capTextByTokens(line, 90));
  return {
    summary,
    relevantLines: relevantLines.length > 0 ? relevantLines : fallback.relevantLines,
    source: "service_model",
    model: modelLabel,
  };
}

export function normalizeFastResponderText(text: string): string | undefined {
  const stripped = stripSessionStateUpdateBlocks(text).replace(/\s+/g, " ").trim();
  if (!stripped) {
    return undefined;
  }
  return capTextByTokens(stripped, 180);
}

export function getLatestUserText(messages: AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const text = getMessageTextForRecall(message).replace(/\s+/g, " ").trim();
    if (text.length > 0) return capTextByTokens(text, 250);
  }
  return "";
}

export function scoreRecallCandidateOptimized(
  normalizedQuery: string,
  terms: string[],
  candidate: RecallCandidate,
): number {
  if (!normalizedQuery) return 0;
  const pointerId = candidate.pointer.id.toLowerCase();
  if (pointerId === normalizedQuery) return 1;
  if (pointerId.includes(normalizedQuery)) return 0.95;

  const haystack = `${candidate.pointer.summary}\n${candidate.searchText}`.toLowerCase();
  if (terms.length === 0) return haystack.includes(normalizedQuery) ? 0.5 : 0;

  let matchedTerms = 0;
  for (let i = 0; i < terms.length; i++) {
    if (haystack.includes(terms[i])) {
      matchedTerms++;
    }
  }
  return matchedTerms === 0 ? 0 : matchedTerms / terms.length;
}

export function scoreRecallCandidate(query: string, candidate: RecallCandidate): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;
  const terms = normalizedQuery.split(/\s+/).filter((term) => term.length > 1);
  return scoreRecallCandidateOptimized(normalizedQuery, terms, candidate);
}

export function formatRecallResult(result: RecallResult): string {
  if (result.hits.length === 0) {
    return `No session evidence matched query: ${result.query}`;
  }
  const sections = [`Session recall results for: ${result.query}`];
  for (const hit of result.hits) {
    const coverage =
      hit.excerpt && hit.rawTokens !== undefined && hit.excerptTokens !== undefined
        ? hit.truncated
          ? `  Coverage: truncated (${hit.excerptTokens}/${hit.rawTokens} estimated tokens shown; narrow the query or increase maxTokens up to 4000 if more raw evidence is required)`
          : `  Coverage: complete (${hit.rawTokens} estimated tokens; do not call session_recall again for this same pointer unless you need a different query)`
        : undefined;
    sections.push(
      [
        `- ${hit.pointer.id} (${hit.pointer.kind}, relevance ${hit.relevance.toFixed(2)})`,
        `  Summary: ${hit.summary}`,
        coverage,
        hit.excerpt ? `  Excerpt:\n${hit.excerpt}` : undefined,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n"),
    );
  }
  return sections.join("\n\n");
}
