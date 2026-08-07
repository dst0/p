import type { AgentMessage } from "@dst0/p-agent-core";
import type { TextContent, ToolResultMessage } from "@dst0/p-ai";
import { TOOL_STUB_KEY_LINE_COUNT, TOOL_STUB_LINE_MAX_CHARS } from "./constants.ts";
import {
  calculateContextTokens,
  estimateTokens,
  getLastAssistantUsageInfo,
  resolveCompactionSettings,
} from "./helpers-part1.ts";
import type {
  CompactionSettings,
  ContextBudgetReport,
  ContextUsageEstimate,
  ContextUsageEstimateOptions,
  EvidencePointer,
  ToolResultStub,
} from "./types.ts";

export function estimateContextTokens(
  messages: AgentMessage[],
  systemPrompt?: string,
  options: ContextUsageEstimateOptions = {},
): ContextUsageEstimate {
  const staticTokens = systemPrompt ? Math.ceil(systemPrompt.length / 4) : 0;
  const useProviderUsage = options.useProviderUsage ?? true;
  const usageInfo = useProviderUsage ? getLastAssistantUsageInfo(messages, options) : undefined;

  if (!usageInfo) {
    let estimated = staticTokens;
    for (const message of messages) {
      estimated += estimateTokens(message);
    }
    return {
      tokens: estimated,
      usageTokens: 0,
      trailingTokens: estimated,
      lastUsageIndex: null,
      staticTokens,
    };
  }

  const usageTokens = calculateContextTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (let i = usageInfo.index + 1; i < messages.length; i++) {
    trailingTokens += estimateTokens(messages[i]);
  }

  return {
    tokens: staticTokens + usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex: usageInfo.index,
    staticTokens,
  };
}

export function getCompactionTriggerThreshold(contextWindow: number, settings: CompactionSettings): number {
  if (contextWindow <= 0) return Number.POSITIVE_INFINITY;
  const resolved = resolveCompactionSettings(settings);
  const reserveThreshold = Math.max(0, contextWindow - resolved.triggerReserveTokens);
  const ratioThreshold =
    resolved.triggerRatio === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.floor(contextWindow * resolved.triggerRatio));
  return Math.min(reserveThreshold, ratioThreshold);
}

export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
  return createContextBudgetReport(contextTokens, contextWindow, settings).shouldCompact;
}

export function createContextBudgetReport(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings,
): ContextBudgetReport {
  const resolved = resolveCompactionSettings(settings);
  const triggerThreshold = getCompactionTriggerThreshold(contextWindow, settings);
  const shouldRunCompaction = resolved.enabled && Number.isFinite(triggerThreshold) && contextTokens > triggerThreshold;
  return {
    contextTokens,
    contextWindow,
    triggerThreshold,
    triggerReserveTokens: resolved.triggerReserveTokens,
    triggerRatio: resolved.triggerRatio,
    targetContextTokens: resolved.targetContextTokens,
    remainingTokens: Math.max(0, contextWindow - contextTokens),
    shouldCompact: shouldRunCompaction,
  };
}

export function selectKeepRecentTokens(contextTokens: number, settings: CompactionSettings): number {
  const resolved = resolveCompactionSettings(settings);
  const minTokens = Math.max(0, Math.floor(resolved.keepRecentMinTokens));
  const maxTokens = Math.max(minTokens, Math.floor(resolved.keepRecentMaxTokens));
  if (maxTokens === minTokens) return minTokens;

  const rampStart = resolved.targetContextTokens * 4;
  const rampEnd = resolved.targetContextTokens * 8;
  if (contextTokens <= rampStart) return maxTokens;
  if (contextTokens >= rampEnd) return minTokens;

  const pressure = (contextTokens - rampStart) / (rampEnd - rampStart);
  return Math.round(maxTokens - (maxTokens - minTokens) * pressure);
}

export function getToolResultText(message: ToolResultMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function truncateStubLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.length <= TOOL_STUB_LINE_MAX_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, TOOL_STUB_LINE_MAX_CHARS - 15)}... [truncated]`;
}

export function collectKeyLines(text: string): string[] {
  const nonEmptyLines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (nonEmptyLines.length === 0) return [];

  const edgeCount = Math.ceil(TOOL_STUB_KEY_LINE_COUNT / 2);
  const selected =
    nonEmptyLines.length <= TOOL_STUB_KEY_LINE_COUNT
      ? nonEmptyLines
      : [...nonEmptyLines.slice(0, edgeCount), ...nonEmptyLines.slice(-edgeCount)];
  const seen = new Set<string>();
  const keyLines: string[] = [];
  for (const line of selected) {
    const truncated = truncateStubLine(line);
    if (!seen.has(truncated)) {
      seen.add(truncated);
      keyLines.push(truncated);
    }
  }
  return keyLines;
}

export function getArtifactIds(text: string): string[] {
  const artifactIds = new Set<string>();
  const fullOutputPathMatch = text.match(/Full output:\s*([^\]\s]+)/i);
  if (fullOutputPathMatch) {
    artifactIds.add(fullOutputPathMatch[1]);
  }
  const pathMatches = text.matchAll(/(?:^|\s)((?:\/tmp|\/var\/folders|\/Users)\/[^\s\])]+)/gm);
  for (const match of pathMatches) {
    artifactIds.add(match[1]);
    if (artifactIds.size >= 5) break;
  }
  return [...artifactIds];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getToolResultExitCode(message: ToolResultMessage): number | undefined {
  if (!isRecord(message.details)) return undefined;
  const exitCode = message.details.exitCode;
  return typeof exitCode === "number" ? exitCode : undefined;
}

export function getToolResultContextExtract(
  message: ToolResultMessage,
): { summary: string; relevantLines: string[] } | undefined {
  if (!isRecord(message.details)) return undefined;
  const extract = message.details.contextExtract;
  if (!isRecord(extract)) return undefined;
  const summary = typeof extract.summary === "string" ? extract.summary.trim() : "";
  const relevantLines = Array.isArray(extract.relevantLines)
    ? extract.relevantLines.filter((line): line is string => typeof line === "string").slice(0, 12)
    : [];
  return summary || relevantLines.length > 0 ? { summary, relevantLines } : undefined;
}

export function isPinnedToolResult(message: ToolResultMessage, text: string): boolean {
  if (isRecord(message.details)) {
    const pinContext = message.details.pinContext ?? message.details.pinnedContext ?? message.details.keepInContext;
    if (pinContext === true) return true;
  }
  return /\[(?:pin|pinned|pin-context)\]|<pin_context>/i.test(text);
}

export function createToolResultStubText(stub: ToolResultStub, originalTokens: number, stubTokens: number): string {
  const lines = [
    "[Tool result stubbed to reduce prompt context]",
    `Tool: ${stub.toolName}`,
    `Status: ${stub.status}`,
    `Raw pointer: ${stub.rawPointer.id}`,
    `Original estimate: ${originalTokens} tokens`,
    `Stub estimate: ${stubTokens} tokens`,
    `Token savings estimate: ${stub.tokenSavingsEstimate} tokens`,
    `Summary: ${stub.summary}`,
  ];
  if (stub.exitCode !== undefined) {
    lines.push(`Exit code: ${stub.exitCode}`);
  }
  if (stub.artifactIds.length > 0) {
    lines.push("Artifacts:");
    for (const artifactId of stub.artifactIds) {
      lines.push(`- ${artifactId}`);
    }
  }
  if (stub.keyLines.length > 0) {
    lines.push("Key lines:");
    for (const keyLine of stub.keyLines) {
      lines.push(`- ${keyLine}`);
    }
  }
  lines.push(`Retrieve: session_recall("${stub.rawPointer.id}", { includeRaw: true, maxTokens: 4000 })`);
  return lines.join("\n");
}

export function createToolResultStub(
  message: ToolResultMessage,
  index: number,
  originalTokens: number,
): { message: ToolResultMessage; stub: ToolResultStub; stubTokens: number } {
  const text = getToolResultText(message);
  const contextExtract = getToolResultContextExtract(message);
  const keyLines = contextExtract?.relevantLines.length ? contextExtract.relevantLines : collectKeyLines(text);
  const status = message.isError ? "error" : "success";
  const summary =
    contextExtract?.summary ||
    `${message.toolName} ${status} output omitted from prompt context (${text.split("\n").length} lines, ${originalTokens} estimated tokens).`;
  const pointerId = `tool-result:${message.toolCallId || index}`;
  const pointerSummary = keyLines.length > 0 ? `${summary} Evidence: ${keyLines.slice(0, 3).join(" | ")}` : summary;
  const rawPointer: EvidencePointer = {
    id: pointerId,
    kind: "tool_result",
    summary: pointerSummary,
    retrieveWhen: `Need exact raw output for ${message.toolName} tool call ${message.toolCallId}.`,
  };
  const stub: ToolResultStub = {
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    status,
    exitCode: getToolResultExitCode(message),
    summary,
    keyLines,
    artifactIds: getArtifactIds(text),
    rawPointer,
    tokenSavingsEstimate: 0,
  };
  const initialStubText = createToolResultStubText(stub, originalTokens, 0);
  const initialStubMessage: ToolResultMessage = {
    ...message,
    content: [{ type: "text", text: initialStubText }],
  };
  const stubTokens = estimateTokens(initialStubMessage);
  stub.tokenSavingsEstimate = Math.max(0, originalTokens - stubTokens);
  const finalStubText = createToolResultStubText(stub, originalTokens, stubTokens);
  return {
    message: {
      ...message,
      content: [{ type: "text", text: finalStubText }],
    },
    stub,
    stubTokens,
  };
}
