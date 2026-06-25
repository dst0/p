/**
 * Context compaction for long sessions.
 *
 * Pure functions for compaction logic. The session manager handles I/O,
 * and after compaction the session is reloaded.
 */

import type { AgentMessage, StreamFn, ThinkingLevel } from "@dst0/p-agent-core";
import type {
	AssistantMessage,
	Context,
	Model,
	SimpleStreamOptions,
	TextContent,
	ToolResultMessage,
	Usage,
} from "@dst0/p-ai";
import { completeSimple } from "@dst0/p-ai";
import {
	convertToLlm,
	createBranchSummaryMessage,
	createCompactionSummaryMessage,
	createCustomMessage,
} from "../messages.ts";
import { buildSessionContext, type CompactionEntry, type SessionEntry } from "../session-manager.ts";
import { STRUCTURED_SESSION_STATE_CUSTOM_TYPE, type StructuredSessionState } from "./structured-state.ts";
import {
	computeFileLists,
	createFileOps,
	extractFileOpsFromMessage,
	type FileOperations,
	formatFileOperations,
	SUMMARIZATION_SYSTEM_PROMPT,
	serializeConversation,
} from "./utils.ts";

export { DEFAULT_COMPACTION_SETTINGS } from "./default-settings.ts";

import { DEFAULT_COMPACTION_SETTINGS } from "./default-settings.ts";

// ============================================================================
// File Operation Tracking
// ============================================================================

export interface CompactionAudit {
	beforeTokens: number;
	afterTokens: number;
	savedTokens: number;
	summaryTokens: number;
	renderedStateTokens: number;
	recentRawTokens: number;
	toolRawTokens: number;
	toolStubTokens: number;
	droppedEntries: string[];
	stubbedToolResults: string[];
	risks: string[];
}

export type EvidenceKind = "message" | "tool_result" | "bash" | "file" | "web" | "artifact";

export interface EvidencePointer {
	id: string;
	kind: EvidenceKind;
	entryId?: string;
	path?: string;
	summary: string;
	retrieveWhen: string;
}

export interface ToolResultStub {
	toolCallId: string;
	toolName: string;
	status: "success" | "error";
	exitCode?: number;
	summary: string;
	keyLines: string[];
	artifactIds: string[];
	rawPointer: EvidencePointer;
	tokenSavingsEstimate: number;
}

export interface ToolResultStubbingResult {
	messages: AgentMessage[];
	stubs: ToolResultStub[];
	toolRawTokens: number;
	toolStubTokens: number;
	tokenSavingsEstimate: number;
}

/** Details stored in CompactionEntry.details for file tracking and auditability. */
export interface CompactionDetails {
	readFiles: string[];
	modifiedFiles: string[];
	audit?: CompactionAudit;
	markdownSummary?: string;
	structuredState?: StructuredSessionState;
}

/**
 * Extract file operations from messages and previous compaction entries.
 */
function extractFileOperations(
	messages: AgentMessage[],
	entries: SessionEntry[],
	prevCompactionIndex: number,
): FileOperations {
	const fileOps = createFileOps();

	// Collect from previous compaction's details (if pi-generated)
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

// ============================================================================
// Message Extraction
// ============================================================================

/**
 * Extract AgentMessage from an entry if it produces one.
 * Returns undefined for entries that don't contribute to LLM context.
 */
function getMessageFromEntry(entry: SessionEntry): AgentMessage | undefined {
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

function getMessageFromEntryForCompaction(entry: SessionEntry): AgentMessage | undefined {
	if (entry.type === "compaction") {
		return undefined;
	}
	return getMessageFromEntry(entry);
}

function hasMeaningfulUserRequest(pathEntries: SessionEntry[]): boolean {
	return pathEntries.some((entry) => {
		if (entry.type === "custom_message") return true;
		if (entry.type === "message" && entry.message.role === "bashExecution") return true;
		if (entry.type !== "message" || entry.message.role !== "user") {
			return false;
		}
		return (getMessageText(entry.message)?.trim().length ?? 0) > 0;
	});
}

/** Result from compact() - SessionManager adds uuid/parentUuid when saving */
export interface CompactionResult<T = unknown> {
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	/** Estimated token count after compaction. */
	tokensAfter?: number;
	/** Extension-specific data (e.g., ArtifactIndex, version markers for structured compaction) */
	details?: T;
}

// ============================================================================
// Types
// ============================================================================

export interface CompactionSettings {
	enabled: boolean;
	/** @deprecated Use triggerReserveTokens. */
	reserveTokens?: number;
	/** @deprecated Use keepRecentMinTokens/keepRecentMaxTokens. */
	keepRecentTokens?: number;
	triggerReserveTokens?: number;
	triggerRatio?: number;
	keepRecentMinTokens?: number;
	keepRecentMaxTokens?: number;
	summaryMaxTokens?: number;
	renderedStateMaxTokens?: number;
	targetContextTokens?: number;
	toolResultClearThresholdTokens?: number;
	toolResultKeepRecentCount?: number;
	toolResultPromptBudgetTokens?: number;
}

interface ResolvedCompactionSettings {
	enabled: boolean;
	triggerReserveTokens: number;
	triggerRatio?: number;
	keepRecentMinTokens: number;
	keepRecentMaxTokens: number;
	summaryMaxTokens: number;
	renderedStateMaxTokens: number;
	targetContextTokens: number;
	toolResultClearThresholdTokens: number;
	toolResultKeepRecentCount: number;
	toolResultPromptBudgetTokens: number;
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
		toolResultClearThresholdTokens:
			settings.toolResultClearThresholdTokens ?? DEFAULT_COMPACTION_SETTINGS.toolResultClearThresholdTokens!,
		toolResultKeepRecentCount:
			settings.toolResultKeepRecentCount ?? DEFAULT_COMPACTION_SETTINGS.toolResultKeepRecentCount!,
		toolResultPromptBudgetTokens:
			settings.toolResultPromptBudgetTokens ?? DEFAULT_COMPACTION_SETTINGS.toolResultPromptBudgetTokens!,
	};
}

// ============================================================================
// Token calculation
// ============================================================================

/**
 * Calculate total context tokens from usage.
 * Uses the native totalTokens field when available, falls back to computing from components.
 */
export function calculateContextTokens(usage: Usage): number {
	return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

/**
 * Check if usage data is reliable for context token calculations.
 * Local LLM providers (llama.cpp, Ollama) return prompt_tokens: 0 in streaming
 * usage chunks, making input === 0 and totalTokens ≈ output only.
 * When input is zero, the usage only reflects the response size, not the full context.
 * Cache hits (cacheRead) are also reliable indicators of context size.
 */
export function isUsageReliable(usage: Usage): boolean {
	return usage.input > 0 || usage.cacheRead > 0;
}

/**
 * Get usage from an assistant message if available.
 * Skips aborted and error messages as they don't have valid usage data.
 */
function getAssistantUsage(msg: AgentMessage): Usage | undefined {
	if (msg.role === "assistant" && "usage" in msg) {
		const assistantMsg = msg as AssistantMessage;
		if (assistantMsg.stopReason !== "aborted" && assistantMsg.stopReason !== "error" && assistantMsg.usage) {
			return assistantMsg.usage;
		}
	}
	return undefined;
}

/**
 * Find the last non-aborted assistant message usage from session entries.
 */
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

export interface ContextUsageEstimate {
	tokens: number;
	usageTokens: number;
	trailingTokens: number;
	lastUsageIndex: number | null;
	staticTokens: number;
}

export interface ContextUsageEstimateOptions {
	useProviderUsage?: boolean;
	sinceTimestamp?: number;
}

function getLastAssistantUsageInfo(
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

/**
 * Estimate context tokens from messages, using the last assistant usage when available.
 * If there are messages after the last usage, estimate their tokens with estimateTokens.
 */
export function estimateContextTokens(
	messages: AgentMessage[],
	systemPrompt?: string,
	options: ContextUsageEstimateOptions = {},
): ContextUsageEstimate {
	const staticTokens = systemPrompt ? Math.ceil(systemPrompt.length / 4) : 0;
	const useProviderUsage = options.useProviderUsage ?? true;
	const usageInfo = useProviderUsage ? getLastAssistantUsageInfo(messages, options) : undefined;

	if (!usageInfo) {
		let estimated = 0;
		for (let i = 0; i < messages.length; i++) {
			const m = messages[i];
			if (i === 0 && m.role === "system" && m.content === systemPrompt) {
				continue;
			}
			estimated += estimateTokens(m);
		}
		return {
			tokens: staticTokens + estimated,
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
		tokens: usageTokens + trailingTokens,
		usageTokens: usageTokens - staticTokens,
		trailingTokens,
		lastUsageIndex: usageInfo.index,
		staticTokens,
	};
}

export interface ContextBudgetReport {
	contextTokens: number;
	contextWindow: number;
	triggerThreshold: number;
	triggerReserveTokens: number;
	triggerRatio?: number;
	targetContextTokens: number;
	remainingTokens: number;
	shouldCompact: boolean;
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

export function createContextBudgetReport(
	contextTokens: number,
	contextWindow: number,
	settings: CompactionSettings,
): ContextBudgetReport {
	const resolved = resolveCompactionSettings(settings);
	const triggerThreshold = getCompactionTriggerThreshold(contextWindow, settings);
	const shouldRunCompaction =
		resolved.enabled && Number.isFinite(triggerThreshold) && contextTokens > triggerThreshold;
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

/**
 * Check if compaction should trigger based on context usage.
 */
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
	return createContextBudgetReport(contextTokens, contextWindow, settings).shouldCompact;
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

// ============================================================================
// Cut point detection
// ============================================================================

const ESTIMATED_IMAGE_CHARS = 4800;

function estimateTextAndImageContentChars(content: string | Array<{ type: string; text?: string }>): number {
	if (typeof content === "string") {
		return content.length;
	}

	let chars = 0;
	for (const block of content) {
		if (block.type === "text" && block.text) {
			chars += block.text.length;
		} else if (block.type === "image") {
			chars += ESTIMATED_IMAGE_CHARS;
		}
	}
	return chars;
}

/**
 * Estimate token count for a message using chars/4 heuristic.
 * This is conservative (overestimates tokens).
 */
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
			// Include overhead from bashExecutionToText: "Ran ``\n", "```\n", "\n```", etc.
			chars = message.command.length + message.output.length + 15;
			return Math.ceil(chars / 4);
		}
		case "branchSummary": {
			// Include BRANCH_SUMMARY_PREFIX and BRANCH_SUMMARY_SUFFIX (99 chars)
			chars = message.summary.length + 99;
			return Math.ceil(chars / 4);
		}
		case "compactionSummary": {
			// Include COMPACTION_SUMMARY_PREFIX and COMPACTION_SUMMARY_SUFFIX (107 chars)
			chars = message.summary.length + 107;
			return Math.ceil(chars / 4);
		}
	}

	return 0;
}

// ============================================================================
// Prompt-time tool result stubbing

const FAILED_TOOL_RESULT_KEEP_TOKENS = 2000;
const TOOL_STUB_KEY_LINE_COUNT = 12;
const TOOL_STUB_LINE_MAX_CHARS = 240;

function getToolResultText(message: ToolResultMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function truncateStubLine(line: string): string {
	const trimmed = line.trim();
	if (trimmed.length <= TOOL_STUB_LINE_MAX_CHARS) {
		return trimmed;
	}
	return `${trimmed.slice(0, TOOL_STUB_LINE_MAX_CHARS - 15)}... [truncated]`;
}

function collectKeyLines(text: string): string[] {
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

function getArtifactIds(text: string): string[] {
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getToolResultExitCode(message: ToolResultMessage): number | undefined {
	if (!isRecord(message.details)) return undefined;
	const exitCode = message.details.exitCode;
	return typeof exitCode === "number" ? exitCode : undefined;
}

function getToolResultContextExtract(
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

function isPinnedToolResult(message: ToolResultMessage, text: string): boolean {
	if (isRecord(message.details)) {
		const pinContext = message.details.pinContext ?? message.details.pinnedContext ?? message.details.keepInContext;
		if (pinContext === true) return true;
	}
	return /\[(?:pin|pinned|pin-context)\]|<pin_context>/i.test(text);
}

function createToolResultStubText(stub: ToolResultStub, originalTokens: number, stubTokens: number): string {
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

function createToolResultStub(
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
	const rawPointer: EvidencePointer = {
		id: pointerId,
		kind: "tool_result",
		summary,
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

function shouldStubToolResult(
	message: ToolResultMessage,
	index: number,
	recentToolResultStartIndex: number,
	settings: ResolvedCompactionSettings,
	originalTokens: number,
): boolean {
	if (index >= recentToolResultStartIndex) return false;
	const text = getToolResultText(message);
	if (isPinnedToolResult(message, text)) return false;
	if (message.isError && originalTokens <= FAILED_TOOL_RESULT_KEEP_TOKENS) return false;
	return originalTokens > settings.toolResultClearThresholdTokens;
}

function selectRawToolResultIndexes(
	messages: AgentMessage[],
	toolResultIndexes: number[],
	recentToolResultStartIndex: number,
	settings: ResolvedCompactionSettings,
	tokenByIndex: Map<number, number>,
): Set<number> {
	const rawIndexes = new Set<number>();
	let discretionaryTokens = 0;
	for (let position = toolResultIndexes.length - 1; position >= 0; position--) {
		const index = toolResultIndexes[position];
		const message = messages[index] as ToolResultMessage;
		const originalTokens = tokenByIndex.get(index) ?? estimateTokens(message);
		const text = getToolResultText(message);
		const forcedRaw =
			index >= recentToolResultStartIndex ||
			isPinnedToolResult(message, text) ||
			(message.isError && originalTokens <= FAILED_TOOL_RESULT_KEEP_TOKENS);
		if (forcedRaw) {
			rawIndexes.add(index);
			continue;
		}
		if (originalTokens > settings.toolResultClearThresholdTokens) {
			continue;
		}
		if (discretionaryTokens + originalTokens <= settings.toolResultPromptBudgetTokens) {
			rawIndexes.add(index);
			discretionaryTokens += originalTokens;
		}
	}
	return rawIndexes;
}

export function stubToolResultsForPrompt(
	messages: AgentMessage[],
	settings: CompactionSettings,
): ToolResultStubbingResult {
	const resolved = resolveCompactionSettings(settings);
	if (messages.length === 0) {
		return {
			messages,
			stubs: [],
			toolRawTokens: 0,
			toolStubTokens: 0,
			tokenSavingsEstimate: 0,
		};
	}

	const toolResultIndexes: number[] = [];
	for (let index = 0; index < messages.length; index++) {
		if (messages[index].role === "toolResult") {
			toolResultIndexes.push(index);
		}
	}
	if (toolResultIndexes.length === 0) {
		return {
			messages,
			stubs: [],
			toolRawTokens: 0,
			toolStubTokens: 0,
			tokenSavingsEstimate: 0,
		};
	}

	const keepRecentCount = Math.max(0, Math.floor(resolved.toolResultKeepRecentCount));
	const recentToolResultStartIndex =
		keepRecentCount === 0
			? messages.length
			: (toolResultIndexes[toolResultIndexes.length - keepRecentCount] ?? messages.length);
	const stubbedMessages = messages.slice();
	const stubs: ToolResultStub[] = [];
	let toolRawTokens = 0;
	let toolStubTokens = 0;
	const tokenByIndex = new Map<number, number>();

	for (const index of toolResultIndexes) {
		const message = messages[index] as ToolResultMessage;
		const originalTokens = estimateTokens(message);
		tokenByIndex.set(index, originalTokens);
		toolRawTokens += originalTokens;
	}

	const rawIndexes = selectRawToolResultIndexes(
		messages,
		toolResultIndexes,
		recentToolResultStartIndex,
		resolved,
		tokenByIndex,
	);

	for (const index of toolResultIndexes) {
		const message = messages[index] as ToolResultMessage;
		const originalTokens = tokenByIndex.get(index) ?? estimateTokens(message);
		if (
			rawIndexes.has(index) &&
			!shouldStubToolResult(message, index, recentToolResultStartIndex, resolved, originalTokens)
		) {
			toolStubTokens += originalTokens;
			continue;
		}
		const stubResult = createToolResultStub(message, index, originalTokens);
		stubbedMessages[index] = stubResult.message as AgentMessage;
		stubs.push(stubResult.stub);
		toolStubTokens += stubResult.stubTokens;
	}

	return {
		messages: stubs.length > 0 ? stubbedMessages : messages,
		stubs,
		toolRawTokens,
		toolStubTokens,
		tokenSavingsEstimate: Math.max(0, toolRawTokens - toolStubTokens),
	};
}

// Post-compaction message truncation
// ============================================================================

const MAX_KEPT_LINES = 20;
const MAX_KEPT_CHARS = 16000; // ~4000 tokens at chars/4

/**
 * Extract text content from a message as a single string.
 * Returns undefined if the message has no text content.
 */
function getMessageText(message: AgentMessage): string | undefined {
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

/**
 * Truncate text to its last N lines, with a max character limit.
 * Returns the truncated text, or the original if it's already within limits.
 */
function truncateToLastLines(text: string, maxLines: number, maxChars: number): string {
	// First check character limit
	if (text.length <= maxChars && text.split("\n").length <= maxLines) {
		return text;
	}

	const lines = text.split("\n");
	const kept = lines.slice(-maxLines);
	let result = kept.join("\n");

	// Further truncate if still over character limit
	if (result.length > maxChars) {
		result = result.slice(-maxChars);
		// Clean up to start at a line boundary
		const firstNewline = result.indexOf("\n");
		if (firstNewline > 0 && firstNewline < result.length - 1) {
			result = result.slice(firstNewline + 1);
		}
	}

	return `[...truncated, showing last ${kept.length} lines...]\n${result}`;
}

/**
 * Set the text content of a message to the given truncated text.
 * Creates a shallow copy of the message with truncated content.
 * Only handles user, toolResult, and assistant messages.
 */
function setMessageText(message: AgentMessage, truncatedText: string): AgentMessage {
	switch (message.role) {
		case "user": {
			const content = (message as { content: string | Array<{ type: string; text?: string }> }).content;
			if (typeof content === "string") {
				return { ...message, content: truncatedText } as any;
			}
			let textReplaced = false;
			const newContent = content
				.filter((c) => c.type !== "text" || !textReplaced)
				.map((c) => {
					if (c.type === "text") {
						textReplaced = true;
						return { ...c, text: truncatedText };
					}
					return c;
				});
			return { ...message, content: newContent } as any;
		}
		case "toolResult": {
			const content = message.content;
			if (typeof content === "string") {
				return { ...message, content: truncatedText } as any;
			}
			let textReplaced = false;
			const newContent = content
				.filter((c: any) => c.type !== "text" || !textReplaced)
				.map((c: any) => {
					if (c.type === "text") {
						textReplaced = true;
						return { ...c, text: truncatedText };
					}
					return c;
				});
			return { ...message, content: newContent } as any;
		}
		case "assistant": {
			const assistant = message as AssistantMessage;
			let textReplaced = false;
			const newContent = assistant.content
				.filter((c) => c.type !== "text" || !textReplaced)
				.map((c) => {
					if (c.type === "text") {
						textReplaced = true;
						return { ...c, text: truncatedText };
					}
					return c;
				});
			return { ...message, content: newContent } as any;
		}
		case "bashExecution": {
			// Truncate the output, keep the command
			return { ...message, output: truncatedText } as any;
		}
		default:
			return message;
	}
}

/**
 * Truncate kept messages after compaction to enforce the token budget.
 * Each individual message's text is capped to last MAX_KEPT_LINES / MAX_KEPT_CHARS.
 * If total tokens still exceed the budget, messages are truncated further from oldest to newest.
 *
 * budget can be specified as a single number (keepRecentTokens) or as a target for the whole context.
 *
 * Modifies the messages array in place and returns it.
 * The compaction summary message (first message) is never truncated.
 */
export function truncateKeptMessages(
	messages: AgentMessage[],
	budget:
		| number
		| {
				keepRecentTokens: number;
				targetContextTokens?: number;
				systemPromptTokens?: number;
		  },
): AgentMessage[] {
	if (messages.length === 0) return messages;

	const keepRecentTokens = typeof budget === "number" ? budget : budget.keepRecentTokens;
	const targetContextTokens =
		typeof budget === "number" ? keepRecentTokens * 1.5 : (budget.targetContextTokens ?? keepRecentTokens * 1.5);
	const systemPromptTokens = typeof budget === "number" ? 0 : (budget.systemPromptTokens ?? 0);

	// First pass: truncate any individual oversized messages
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		// Never truncate the compaction summary itself
		if (msg.role === "compactionSummary") continue;

		const text = getMessageText(msg);
		if (!text) continue;

		const msgTokens = estimateTokens(msg);
		if (msgTokens > keepRecentTokens) {
			// This single message exceeds the individual budget — truncate aggressively
			const truncated = truncateToLastLines(text, MAX_KEPT_LINES, MAX_KEPT_CHARS);
			messages[i] = setMessageText(msg, truncated);
		}
	}

	// Second pass: if total still exceeds target, truncate from oldest non-summary messages
	let totalContextTokens = systemPromptTokens;
	for (const msg of messages) {
		totalContextTokens += estimateTokens(msg);
	}

	if (totalContextTokens > targetContextTokens) {
		// Truncate older messages more aggressively
		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];
			if (msg.role === "compactionSummary") continue;

			const text = getMessageText(msg);
			if (!text) continue;

			const msgTokens = estimateTokens(msg);
			if (msgTokens > 500) {
				// Truncate to just last 10 lines for older messages
				const truncated = truncateToLastLines(text, 10, MAX_KEPT_CHARS / 4);
				messages[i] = setMessageText(msg, truncated);
			}

			// Recalculate total
			totalContextTokens = systemPromptTokens;
			for (const m of messages) {
				totalContextTokens += estimateTokens(m);
			}
			if (totalContextTokens <= targetContextTokens) break;
		}
	}

	if (totalContextTokens > targetContextTokens) {
		// Third pass: extremely aggressive truncation for very long turns with many tool results
		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];
			if (msg.role === "compactionSummary") continue;

			const text = getMessageText(msg);
			if (!text) continue;

			const msgTokens = estimateTokens(msg);
			if (msgTokens > 50) {
				// Truncate to 0 lines (just the truncated placeholder)
				const truncated = truncateToLastLines(text, 0, 100);
				messages[i] = setMessageText(msg, truncated);
			}

			// Recalculate total
			totalContextTokens = systemPromptTokens;
			for (const m of messages) {
				totalContextTokens += estimateTokens(m);
			}
			if (totalContextTokens <= targetContextTokens) break;
		}
	}

	return messages;
}

/**
 * Find valid cut points: indices of user, assistant, custom, or bashExecution messages.
 * Never cut at tool results (they must follow their tool call).
 * When we cut at an assistant message with tool calls, its tool results follow it
 * and will be kept.
 * BashExecutionMessage is treated like a user message (user-initiated context).
 */
function findValidCutPoints(entries: SessionEntry[], startIndex: number, endIndex: number): number[] {
	const cutPoints: number[] = [];
	for (let i = startIndex; i < endIndex; i++) {
		const entry = entries[i];
		switch (entry.type) {
			case "message": {
				const role = entry.message.role;
				switch (role) {
					case "bashExecution":
					case "custom":
					case "branchSummary":
					case "compactionSummary":
					case "user":
					case "assistant":
						cutPoints.push(i);
						break;
					case "toolResult":
						break;
				}
				break;
			}
			case "thinking_level_change":
			case "model_change":
			case "compaction":
			case "branch_summary":
			case "custom":
			case "custom_message":
			case "label":
			case "session_info":
				break;
		}

		// branch_summary and custom_message are user-role messages, valid cut points
		if (entry.type === "branch_summary" || entry.type === "custom_message") {
			cutPoints.push(i);
		}
	}
	return cutPoints;
}

/**
 * Find the user message (or bashExecution) that starts the turn containing the given entry index.
 * Returns -1 if no turn start found before the index.
 * BashExecutionMessage is treated like a user message for turn boundaries.
 */
export function findTurnStartIndex(entries: SessionEntry[], entryIndex: number, startIndex: number): number {
	for (let i = entryIndex; i >= startIndex; i--) {
		const entry = entries[i];
		// branch_summary and custom_message are user-role messages, can start a turn
		if (entry.type === "branch_summary" || entry.type === "custom_message") {
			return i;
		}
		if (entry.type === "message") {
			const role = entry.message.role;
			if (role === "user" || role === "bashExecution") {
				return i;
			}
		}
	}
	return -1;
}

export interface CutPointResult {
	/** Index of first entry to keep */
	firstKeptEntryIndex: number;
	/** Index of user message that starts the turn being split, or -1 if not splitting */
	turnStartIndex: number;
	/** Whether this cut splits a turn (cut point is not a user message) */
	isSplitTurn: boolean;
}

/**
 * Find the cut point in session entries that keeps approximately `keepRecentTokens`.
 *
 * Algorithm: Walk backwards from newest, accumulating estimated message sizes.
 * Stop when we've accumulated >= keepRecentTokens. Cut at that point.
 *
 * Can cut at user OR assistant messages (never tool results). When cutting at an
 * assistant message with tool calls, its tool results come after and will be kept.
 *
 * Returns CutPointResult with:
 * - firstKeptEntryIndex: the entry index to start keeping from
 * - turnStartIndex: if cutting mid-turn, the user message that started that turn
 * - isSplitTurn: whether we're cutting in the middle of a turn
 *
 * Only considers entries between `startIndex` and `endIndex` (exclusive).
 */
export function findCutPoint(
	entries: SessionEntry[],
	startIndex: number,
	endIndex: number,
	keepRecentTokens: number,
): CutPointResult {
	const cutPoints = findValidCutPoints(entries, startIndex, endIndex);

	if (cutPoints.length === 0) {
		return {
			firstKeptEntryIndex: startIndex,
			turnStartIndex: -1,
			isSplitTurn: false,
		};
	}

	// Walk backwards from newest, accumulating estimated message sizes
	let accumulatedTokens = 0;
	let cutIndex = cutPoints[0]; // Default: keep from first message (not header)

	for (let i = endIndex - 1; i >= startIndex; i--) {
		const entry = entries[i];
		if (entry.type !== "message" && entry.type !== "branch_summary" && entry.type !== "custom_message") continue;

		// Estimate this entry's size
		let entryTokens = 0;
		if (entry.type === "message") {
			entryTokens = estimateTokens(entry.message);
		} else if (entry.type === "branch_summary") {
			entryTokens = Math.ceil(entry.summary.length / 4);
		} else if (entry.type === "custom_message") {
			const contentStr = typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content);
			entryTokens = Math.ceil(contentStr.length / 4);
		}
		accumulatedTokens += entryTokens;

		// Check if we've exceeded the budget
		if (accumulatedTokens >= keepRecentTokens) {
			let foundCut = -1;

			// Always try to exclude the message that pushed us over budget
			// by cutting AFTER it (i.e., finding a cut point > i).
			// This ensures we keep only what fits within keepRecentTokens.
			for (let c = 0; c < cutPoints.length; c++) {
				if (cutPoints[c] > i) {
					foundCut = cutPoints[c];
					break;
				}
			}

			// Fallback: Find the closest valid cut point at or after this entry
			if (foundCut === -1) {
				for (let c = 0; c < cutPoints.length; c++) {
					if (cutPoints[c] >= i) {
						foundCut = cutPoints[c];
						break;
					}
				}
				// If still no cut point found (e.g. entry is after the last valid cut point),
				// fallback to the last valid cut point to at least compact something.
				if (foundCut === -1 && cutPoints.length > 0) {
					foundCut = cutPoints[cutPoints.length - 1];
				}
			}

			if (foundCut !== -1) {
				cutIndex = foundCut;
			}
			break;
		}
	}

	// Scan backwards from cutIndex to include any non-message entries (bash, settings, etc.)
	while (cutIndex > startIndex) {
		const prevEntry = entries[cutIndex - 1];
		// Stop at session header or compaction boundaries
		if (prevEntry.type === "compaction") {
			break;
		}
		if (prevEntry.type === "message") {
			// Stop if we hit any message
			break;
		}
		// Include this non-message entry (bash, settings change, etc.)
		cutIndex--;
	}

	// Determine if this is a split turn
	const cutEntry = entries[cutIndex];
	const isUserMessage = cutEntry.type === "message" && cutEntry.message.role === "user";
	const turnStartIndex = isUserMessage ? -1 : findTurnStartIndex(entries, cutIndex, startIndex);

	return {
		firstKeptEntryIndex: cutIndex,
		turnStartIndex,
		isSplitTurn: !isUserMessage && turnStartIndex !== -1,
	};
}

// ============================================================================
// Summarization
// ============================================================================

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[State the exact current goal. Preserve unchanged the original prompt or updated goal verbatim, incorporating any subsequent user corrections if they changed the goal.]

## Plan & Progress
[Preserve the actual step-by-step plan verbatim. Keep completed and in-progress steps clear, correcting the plan only if new info requires changing it to achieve the goal.]
- [ ] [Not started]
- [.] [In progress]
- [v] [Done]
- [-] [Failed]

## Progress
### Done
- [v] [Completed tasks/changes]

### In Progress
- [.] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE the Plan & Progress section checkboxes: [] not started, [.] in progress, [v] done, [-] failed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve unchanged the original prompt or updated goal verbatim, adding new ones only if the task expanded]

## Plan & Progress
[Preserve the actual plan verbatim. Include previously done items AND newly completed items, updating the plan if new info requires changing it. Use [] not started, [.] in progress, [v] done, [-] failed]

## Progress
### Done
- [v] [Include previously done items AND newly completed items]

### In Progress
- [.] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

function createSummarizationOptions(
	model: Model<any>,
	maxTokens: number,
	apiKey: string | undefined,
	headers: Record<string, string> | undefined,
	signal: AbortSignal | undefined,
	thinkingLevel: ThinkingLevel | undefined,
): SimpleStreamOptions {
	const options: SimpleStreamOptions = { maxTokens, signal, apiKey, headers };
	if (model.reasoning && thinkingLevel && thinkingLevel !== "off") {
		options.reasoning = thinkingLevel;
	}
	return options;
}

async function completeSummarization(
	model: Model<any>,
	context: Context,
	options: SimpleStreamOptions,
	streamFn?: StreamFn,
): Promise<AssistantMessage> {
	if (!streamFn) {
		return completeSimple(model, context, options);
	}
	const stream = await streamFn(model, context, options);
	return stream.result();
}

/**
 * Generate a summary of the conversation using the LLM.
 * If previousSummary is provided, uses the update prompt to merge.
 */
export async function generateSummary(
	currentMessages: AgentMessage[],
	model: Model<any>,
	summaryMaxTokens: number,
	apiKey: string | undefined,
	headers?: Record<string, string>,
	signal?: AbortSignal,
	customInstructions?: string,
	previousSummary?: string,
	thinkingLevel?: ThinkingLevel,
	streamFn?: StreamFn,
): Promise<string> {
	const maxTokens = Math.min(summaryMaxTokens, model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY);

	// Use update prompt if we have a previous summary, otherwise initial prompt
	let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
	if (customInstructions) {
		basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
	}

	// Serialize conversation to text so model doesn't try to continue it
	// Convert to LLM messages first (handles custom types like bashExecution, custom, etc.)
	const llmMessages = convertToLlm(currentMessages);
	const conversationText = serializeConversation(llmMessages);

	// Build the prompt with conversation wrapped in tags
	let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
	if (previousSummary) {
		promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
	}
	promptText += basePrompt;

	const summarizationMessages = [
		{
			role: "user" as const,
			content: [{ type: "text" as const, text: promptText }],
			timestamp: Date.now(),
		},
	];

	const completionOptions = createSummarizationOptions(model, maxTokens, apiKey, headers, signal, thinkingLevel);

	const response = await completeSummarization(
		model,
		{
			systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
			messages: summarizationMessages,
		},
		completionOptions,
		streamFn,
	);

	if (response.stopReason === "error") {
		throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);
	}

	const textContent = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	return textContent;
}

// ============================================================================
// Compaction Preparation (for extensions)
// ============================================================================

export interface CompactionPreparation {
	/** UUID of first entry to keep */
	firstKeptEntryId: string;
	/** Messages that will be summarized and discarded */
	messagesToSummarize: AgentMessage[];
	/** Messages that will be turned into turn prefix summary (if splitting) */
	turnPrefixMessages: AgentMessage[];
	/** Whether this is a split turn (cut point in middle of turn) */
	isSplitTurn: boolean;
	tokensBefore: number;
	/** Summary from previous compaction, for iterative update */
	previousSummary?: string;
	/** File operations extracted from messagesToSummarize */
	fileOps: FileOperations;
	/** Compaction settions from settings.jsonl	*/
	settings: CompactionSettings;
	/** Adaptive recent-token budget selected for this compaction run. */
	keepRecentTokens: number;
	/** Tokens estimated for history that will be summarized. */
	tokensToSummarize: number;
	/** Tokens estimated for raw entries kept after the compaction boundary. */
	recentRawTokens: number;
	/** Entry ids that are replaced by the summary. */
	droppedEntryIds: string[];
	/** Estimated tokens from static prompt context. */
	systemPromptTokens: number;
}

export type CompactionPreparationResult =
	| { ok: true; preparation: CompactionPreparation }
	| {
			ok: false;
			message: string;
			reason: string;
			tokensToSummarize?: number;
			tokensBefore?: number;
	  };

function isAlreadyCompactedBoundary(pathEntries: SessionEntry[]): boolean {
	const lastEntry = pathEntries[pathEntries.length - 1];
	if (!lastEntry) return false;
	if (lastEntry.type === "compaction") return true;
	if (lastEntry.type !== "custom" || lastEntry.customType !== STRUCTURED_SESSION_STATE_CUSTOM_TYPE) return false;
	const previousEntry = pathEntries[pathEntries.length - 2];
	return previousEntry?.type === "compaction";
}

export function prepareCompaction(
	pathEntries: SessionEntry[],
	settings: CompactionSettings,
	systemPrompt?: string,
): CompactionPreparationResult {
	if (pathEntries.length === 0) {
		return {
			ok: false,
			message: "Nothing to compact (session branch has no entries)",
			reason: "empty_session",
		};
	}

	if (isAlreadyCompactedBoundary(pathEntries)) {
		return {
			ok: false,
			message: "Already compacted (latest session entry is a compaction boundary)",
			reason: "already_compacted",
		};
	}

	if (!hasMeaningfulUserRequest(pathEntries)) {
		return {
			ok: false,
			message: "Nothing to compact (no user request has been recorded in this session branch)",
			reason: "no_user_request",
		};
	}

	let prevCompactionIndex = -1;
	for (let i = pathEntries.length - 1; i >= 0; i--) {
		if (pathEntries[i].type === "compaction") {
			prevCompactionIndex = i;
			break;
		}
	}

	let previousSummary: string | undefined;
	let boundaryStart = 0;
	if (prevCompactionIndex >= 0) {
		const prevCompaction = pathEntries[prevCompactionIndex] as CompactionEntry;
		previousSummary = prevCompaction.summary;
		const firstKeptEntryIndex = pathEntries.findIndex((entry) => entry.id === prevCompaction.firstKeptEntryId);
		boundaryStart = firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : prevCompactionIndex + 1;
	}
	const boundaryEnd = pathEntries.length;

	const systemPromptTokens = systemPrompt ? Math.ceil(systemPrompt.length / 4) : 0;
	const tokensBefore = estimateContextTokens(buildSessionContext(pathEntries).messages, systemPrompt).tokens;
	const keepRecentTokens = selectKeepRecentTokens(tokensBefore, settings);

	const cutPoint = findCutPoint(pathEntries, boundaryStart, boundaryEnd, keepRecentTokens);

	// Get UUID of first kept entry
	const firstKeptEntry = pathEntries[cutPoint.firstKeptEntryIndex];
	if (!firstKeptEntry?.id) {
		return {
			ok: false,
			message: "Missing entry ID (session likely needs migration)",
			reason: "missing_kept_entry_id",
			tokensBefore,
		};
	}
	const firstKeptEntryId = firstKeptEntry.id;

	const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;

	// Messages to summarize (will be discarded after summary)
	const messagesToSummarize: AgentMessage[] = [];
	let tokensToSummarize = 0;
	const droppedEntryIds: string[] = [];
	for (let i = boundaryStart; i < historyEnd; i++) {
		const msg = getMessageFromEntryForCompaction(pathEntries[i]);
		if (msg) {
			messagesToSummarize.push(msg);
			tokensToSummarize += estimateTokens(msg);
		}
		if (pathEntries[i].id) {
			droppedEntryIds.push(pathEntries[i].id);
		}
	}

	// Abort compaction if we are discarding less than 500 tokens of history.
	// Summaries themselves cost ~500-1000 tokens, but the main benefit of compaction
	// is also truncating oversized kept messages via post-compaction truncation.
	// However, if we are extremely close to the context limit, we MUST compact.
	const resolvedSettings = resolveCompactionSettings(settings);
	const isNearOverflow = tokensBefore > resolvedSettings.targetContextTokens * 2;

	if (tokensToSummarize < 500 && tokensBefore <= keepRecentTokens * 1.25 && !isNearOverflow) {
		return {
			ok: false,
			message: `History to summarize is too small (only ${tokensToSummarize} tokens) and total session size (${tokensBefore}) is not significantly over budget`,
			reason: "too_little_history",
			tokensToSummarize,
			tokensBefore,
		};
	}

	// Messages for turn prefix summary (if splitting a turn)
	const turnPrefixMessages: AgentMessage[] = [];
	if (cutPoint.isSplitTurn) {
		for (let i = cutPoint.turnStartIndex; i < cutPoint.firstKeptEntryIndex; i++) {
			const msg = getMessageFromEntryForCompaction(pathEntries[i]);
			if (msg) turnPrefixMessages.push(msg);
		}
	}

	// Extract file operations from messages and previous compaction
	const fileOps = extractFileOperations(messagesToSummarize, pathEntries, prevCompactionIndex);

	// Also extract file ops from turn prefix if splitting
	if (cutPoint.isSplitTurn) {
		for (const msg of turnPrefixMessages) {
			extractFileOpsFromMessage(msg, fileOps);
		}
	}

	let recentRawTokens = 0;
	for (let i = cutPoint.firstKeptEntryIndex; i < boundaryEnd; i++) {
		const msg = getMessageFromEntry(pathEntries[i]);
		if (msg) {
			recentRawTokens += estimateTokens(msg);
		}
	}

	return {
		ok: true,
		preparation: {
			firstKeptEntryId,
			messagesToSummarize,
			turnPrefixMessages,
			isSplitTurn: cutPoint.isSplitTurn,
			tokensBefore,
			previousSummary,
			fileOps,
			settings,
			keepRecentTokens,
			tokensToSummarize,
			recentRawTokens,
			droppedEntryIds,
			systemPromptTokens,
		},
	};
}

// ============================================================================
// Main compaction function
// ============================================================================

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`;

/**
 * Summarize a large array of messages by splitting it into chunks that fit within
 * the model's context window. Each chunk is summarized sequentially, with the
 * previous summary passed along to update it.
 */
async function summarizeInChunks(
	messages: AgentMessage[],
	model: Model<any>,
	summaryMaxTokens: number,
	apiKey: string | undefined,
	headers: Record<string, string> | undefined,
	signal: AbortSignal | undefined,
	customInstructions: string | undefined,
	initialSummary: string | undefined,
	thinkingLevel: ThinkingLevel | undefined,
	streamFn: StreamFn | undefined,
	onProgress?: (currentChunk: number, totalChunks: number) => void,
): Promise<string> {
	const maxOutputTokens = Math.min(summaryMaxTokens, model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY);

	// Calculate safe chunk tokens based on model context window.
	// We need space for the system prompt, maxOutputTokens, previous summary (which can be up to maxOutputTokens), and overhead.
	const safeChunkTokens = Math.max(4000, model.contextWindow - maxOutputTokens * 2 - 2000);

	const chunks: AgentMessage[][] = [];
	let currentChunk: AgentMessage[] = [];
	let currentTokens = 0;

	for (const msg of messages) {
		const msgTokens = estimateTokens(msg);
		if (currentChunk.length > 0 && currentTokens + msgTokens > safeChunkTokens) {
			chunks.push(currentChunk);
			currentChunk = [msg];
			currentTokens = msgTokens;
		} else {
			currentChunk.push(msg);
			currentTokens += msgTokens;
		}
	}
	if (currentChunk.length > 0) {
		chunks.push(currentChunk);
	}

	if (chunks.length === 0) {
		return await generateSummary(
			[],
			model,
			summaryMaxTokens,
			apiKey,
			headers,
			signal,
			customInstructions,
			initialSummary,
			thinkingLevel,
			streamFn,
		);
	}

	let currentSummary = initialSummary;
	let i = 0;
	while (i < chunks.length) {
		const chunk = chunks[i];
		try {
			onProgress?.(i + 1, chunks.length);
			currentSummary = await generateSummary(
				chunk,
				model,
				summaryMaxTokens,
				apiKey,
				headers,
				signal,
				customInstructions,
				currentSummary,
				thinkingLevel,
				streamFn,
			);
			i++;
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			const isOverflow =
				errorMsg.match(/exceeds the available context size/i) ||
				errorMsg.match(/context window/i) ||
				errorMsg.match(/too many tokens/i) ||
				errorMsg.match(/prompt is too long/i) ||
				errorMsg.match(/exceeds the limit/i) ||
				errorMsg.match(/maximum context length/i) ||
				errorMsg.match(/502 error sending request for url/i) ||
				errorMsg.match(/502 Bad Gateway/i);

			if (isOverflow && chunk.length > 1) {
				const mid = Math.floor(chunk.length / 2);
				chunks.splice(i, 1, chunk.slice(0, mid), chunk.slice(mid));
				// Loop continues at same 'i' to process the first half
			} else {
				throw error;
			}
		}
	}

	return currentSummary || "No prior history.";
}

/**
 * Generate summaries for compaction using prepared data.
 * Returns CompactionResult - SessionManager adds uuid/parentUuid when saving.
 *
 * @param preparation - Pre-calculated preparation from prepareCompaction()
 * @param model
 * @param apiKey
 * @param headers
 * @param customInstructions - Optional custom focus for the summary
 * @param signal
 * @param thinkingLevel
 * @param streamFn
 * @param onProgress
 */
export async function compact(
	preparation: CompactionPreparation,
	model: Model<any>,
	apiKey: string | undefined,
	headers?: Record<string, string>,
	customInstructions?: string,
	signal?: AbortSignal,
	thinkingLevel?: ThinkingLevel,
	streamFn?: StreamFn,
	onProgress?: (currentChunk: number, totalChunks: number) => void,
): Promise<CompactionResult> {
	const {
		firstKeptEntryId,
		messagesToSummarize,
		turnPrefixMessages,
		isSplitTurn,
		tokensBefore,
		previousSummary,
		fileOps,
		settings,
		recentRawTokens,
		droppedEntryIds,
		systemPromptTokens,
	} = preparation;
	const resolvedSettings = resolveCompactionSettings(settings);

	// Generate summaries (can be parallel if both needed) and merge into one
	let summary: string;

	if (isSplitTurn && turnPrefixMessages.length > 0) {
		// Generate both summaries in parallel
		const [historyResult, turnPrefixResult] = await Promise.all([
			messagesToSummarize.length > 0
				? summarizeInChunks(
						messagesToSummarize,
						model,
						resolvedSettings.summaryMaxTokens,
						apiKey,
						headers,
						signal,
						customInstructions,
						previousSummary,
						thinkingLevel,
						streamFn,
						onProgress,
					)
				: Promise.resolve(previousSummary || "No prior history."),
			generateTurnPrefixSummary(
				turnPrefixMessages,
				model,
				resolvedSettings.summaryMaxTokens,
				apiKey,
				headers,
				signal,
				thinkingLevel,
				streamFn,
			),
		]);
		// Merge into single summary
		summary = `${historyResult}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult}`;
	} else {
		// Just generate history summary
		summary = await summarizeInChunks(
			messagesToSummarize,
			model,
			resolvedSettings.summaryMaxTokens,
			apiKey,
			headers,
			signal,
			customInstructions,
			previousSummary,
			thinkingLevel,
			streamFn,
			onProgress,
		);
	}

	// Compute file lists and append to summary
	const { readFiles, modifiedFiles } = computeFileLists(fileOps);
	summary += formatFileOperations(readFiles, modifiedFiles);
	const summaryTokens = Math.ceil(summary.length / 4);
	const afterTokens = systemPromptTokens + summaryTokens + recentRawTokens;
	const audit: CompactionAudit = {
		beforeTokens: tokensBefore,
		afterTokens,
		savedTokens: Math.max(0, tokensBefore - afterTokens),
		summaryTokens,
		renderedStateTokens: Math.min(summaryTokens, resolvedSettings.renderedStateMaxTokens),
		recentRawTokens,
		toolRawTokens: 0,
		toolStubTokens: 0,
		droppedEntries: droppedEntryIds,
		stubbedToolResults: [],
		risks: afterTokens > resolvedSettings.targetContextTokens ? ["post-compaction context exceeds target"] : [],
	};

	if (!firstKeptEntryId) {
		throw new Error("First kept entry has no UUID - session may need migration");
	}

	return {
		summary,
		firstKeptEntryId,
		tokensBefore,
		details: { readFiles, modifiedFiles, audit } as CompactionDetails,
	};
}

/**
 * Generate a summary for a turn prefix (when splitting a turn).
 */
async function generateTurnPrefixSummary(
	messages: AgentMessage[],
	model: Model<any>,
	summaryMaxTokens: number,
	apiKey: string | undefined,
	headers?: Record<string, string>,
	signal?: AbortSignal,
	thinkingLevel?: ThinkingLevel,
	streamFn?: StreamFn,
): Promise<string> {
	const maxTokens = Math.min(
		Math.floor(0.5 * summaryMaxTokens),
		model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
	); // Smaller budget for turn prefix
	const llmMessages = convertToLlm(messages);
	const conversationText = serializeConversation(llmMessages);
	const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`;
	const summarizationMessages = [
		{
			role: "user" as const,
			content: [{ type: "text" as const, text: promptText }],
			timestamp: Date.now(),
		},
	];

	const response = await completeSummarization(
		model,
		{
			systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
			messages: summarizationMessages,
		},
		createSummarizationOptions(model, maxTokens, apiKey, headers, signal, thinkingLevel),
		streamFn,
	);

	if (response.stopReason === "error") {
		throw new Error(`Turn prefix summarization failed: ${response.errorMessage || "Unknown error"}`);
	}

	return response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}
