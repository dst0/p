import type { AgentMessage, StreamFn, ThinkingLevel } from "@dst0/p-agent-core";
import type { AssistantMessage, Model, ToolResultMessage } from "@dst0/p-ai";
import type { SessionEntry } from "../session-manager.ts";
import {
	compact as compactBase,
	type CompactionDetails,
	type CompactionPreparation as BaseCompactionPreparation,
	type CompactionPreparationResult as BaseCompactionPreparationResult,
	type CompactionResult,
	type CompactionSettings,
	estimateTokens,
	prepareCompaction as prepareCompactionBase,
	resolveCompactionSettings,
	selectKeepRecentTokens,
	stubToolResultsForCompactionSummary,
} from "./compaction.ts";
import {
	createStructuredSessionState,
	getLatestStructuredSessionState,
	hasMeaningfulStructuredSessionState,
	mergeStructuredSessionState,
} from "./session-state-risk-filter.ts";
import type { PlanItem, PlanStatus, StructuredSessionState } from "./structured-state.ts";

const MIN_RECENT_RAW_TOKENS = 512;
const DEFAULT_CHECKPOINT_MAX_CHARS = 4000;
const MAX_MESSAGE_LINES = 20;
const MAX_MESSAGE_CHARS = 16_000;

export interface CompactionPreparation extends BaseCompactionPreparation {
	/** Durable non-context state captured before the compaction model runs. */
	structuredState?: StructuredSessionState;
}

export type CompactionPreparationResult =
	| { ok: true; preparation: CompactionPreparation }
	| Exclude<BaseCompactionPreparationResult, { ok: true }>;

/**
 * Reserve the configured post-compaction target for static prompt content and
 * the durable checkpoint before deciding how much raw recent history to keep.
 */
export function selectKeepRecentTokensForTarget(
	contextTokens: number,
	settings: CompactionSettings,
	systemPromptTokens: number,
): number {
	const resolved = resolveCompactionSettings(settings);
	const adaptive = selectKeepRecentTokens(contextTokens, settings);
	const available = Math.floor(
		resolved.targetContextTokens - Math.max(0, systemPromptTokens) - resolved.renderedStateMaxTokens,
	);
	return Math.min(adaptive, Math.max(MIN_RECENT_RAW_TOKENS, available));
}

/**
 * Prepare compaction with a target-aware recent suffix and attach the durable
 * structured state. Exact discarded entries remain in the session log and are
 * available through session_recall.
 */
export function prepareCompaction(
	pathEntries: SessionEntry[],
	settings: CompactionSettings,
	systemPrompt?: string,
): CompactionPreparationResult {
	const initial = prepareCompactionBase(pathEntries, settings, systemPrompt);
	if (!initial.ok) return initial;

	const targetAwareTokens = selectKeepRecentTokensForTarget(
		initial.preparation.tokensBefore,
		settings,
		initial.preparation.systemPromptTokens,
	);
	let selected = initial;
	if (targetAwareTokens < initial.preparation.keepRecentTokens) {
		const targetAware = prepareCompactionBase(
			pathEntries,
			{
				...settings,
				keepRecentTokens: targetAwareTokens,
			},
			systemPrompt,
		);
		if (targetAware.ok) selected = targetAware;
	}

	return {
		ok: true,
		preparation: {
			...selected.preparation,
			structuredState: getLatestStructuredSessionState(pathEntries),
		},
	};
}

function planStatusCode(status: PlanStatus): string {
	switch (status) {
		case "in_progress":
			return ".";
		case "done":
			return "x";
		case "failed":
			return "-";
		case "blocked":
			return "!";
		case "not_started":
			return " ";
	}
}

function selectPlanItems(plan: PlanItem[], limit: number): PlanItem[] {
	const open = plan.filter((item) => item.status !== "done");
	const completed = plan.filter((item) => item.status === "done");
	const selectedOpen = open.slice(0, limit);
	return [...selectedOpen, ...completed.slice(-Math.max(0, limit - selectedOpen.length))];
}

function compactLine(value: string, maxChars: number): string {
	const text = value.replace(/\s+/g, " ").trim();
	if (text.length <= maxChars) return text;
	const prefix = text.slice(0, Math.max(1, maxChars - 3));
	const wordBreak = prefix.lastIndexOf(" ");
	return `${prefix.slice(0, wordBreak > maxChars * 0.4 ? wordBreak : prefix.length).trimEnd()}...`;
}

function renderList(items: string[]): string[] {
	return items.length > 0 ? items.map((item) => `- ${item}`) : ["- (none)"];
}

/**
 * Render only the active working set into the provider prompt. Full prompts,
 * messages, tool output, and older completed work stay outside context and can
 * be recalled on demand.
 */
export function renderMinimalCompactionCheckpoint(state: StructuredSessionState, maxTokens: number): string {
	const activeConstraints = state.constraints
		.filter((constraint) => constraint.status === "active")
		.slice(0, 10)
		.map(
			(constraint) =>
				`[${constraint.source}/${constraint.enforceability}] ${compactLine(constraint.text, 220)}`,
		);
	const plan = selectPlanItems(state.plan, 12).map(
		(item) => `[${planStatusCode(item.status)}] ${compactLine(item.text, 220)}`,
	);
	const risks = state.audit.knownRisks.slice(0, 10).map((risk) => compactLine(risk, 220));
	const requests = (state.canonicalRequest.originalRequests ?? [])
		.slice(-4)
		.map((request) => `${request.kind}: ${compactLine(request.summary, 200)}`);
	const decisions = state.decisions
		.filter((decision) => decision.status === "active")
		.slice(-6)
		.map(
			(decision) =>
				`**${compactLine(decision.decision, 180)}**${
					decision.rationale ? `: ${compactLine(decision.rationale, 220)}` : ""
				}`,
		);
	const files = state.codebase.touchedFiles
		.slice(-12)
		.map((file) => `${file.status}: ${file.path} - ${compactLine(file.summary, 160)}`);
	const evidence = state.evidence
		.slice(-4)
		.map((pointer) => `${pointer.id}: ${compactLine(pointer.summary, 180)}`);

	const mandatory = [
		"<session_checkpoint>",
		"## Goal",
		compactLine(state.canonicalRequest.current, 520) || "(no user request recorded yet)",
		"",
		"## Constraints",
		...renderList(activeConstraints),
		"",
		"## Plan",
		...renderList(plan),
		"",
		"## Risks",
		...renderList(risks),
		"",
		"## Recall",
		"- Exact compacted messages and tool outputs remain outside the prompt. Use session_recall with specific keywords before guessing or declaring information missing.",
	];
	const optional = [
		"",
		"## Requests",
		...renderList(requests),
		"",
		"## Decisions",
		...renderList(decisions),
		"",
		"## Files",
		...renderList(files),
		...(evidence.length > 0 ? ["", "## Evidence pointers", ...renderList(evidence)] : []),
	];
	const footer = "\n</session_checkpoint>";
	const maxChars = Math.max(800, maxTokens > 0 ? maxTokens * 4 : DEFAULT_CHECKPOINT_MAX_CHARS);
	let checkpoint = [...mandatory, ...optional].join("\n");
	if (checkpoint.length + footer.length > maxChars) {
		checkpoint = mandatory.join("\n");
	}
	if (checkpoint.length + footer.length > maxChars) {
		const available = Math.max(0, maxChars - footer.length);
		const prefix = checkpoint.slice(0, available);
		const lineBreak = prefix.lastIndexOf("\n");
		checkpoint = prefix.slice(0, lineBreak > 0 ? lineBreak : prefix.length);
	}
	return `${checkpoint}${footer}`;
}

function preserveCanonicalRequest(
	state: StructuredSessionState,
	previous: StructuredSessionState | undefined,
): StructuredSessionState {
	if (!previous?.canonicalRequest.current.trim()) return state;
	return {
		...state,
		canonicalRequest: {
			current: previous.canonicalRequest.current,
			sourceEntryIds: [...previous.canonicalRequest.sourceEntryIds],
			originalRequests: (previous.canonicalRequest.originalRequests ?? []).map((request) => ({ ...request })),
			superseded: previous.canonicalRequest.superseded.map((item) => ({ ...item })),
		},
	};
}

/**
 * Run the existing model summarizer as a delta extractor, merge that delta into
 * durable non-context state, and return a small authoritative checkpoint rather
 * than putting the lossy free-form summary back into the live prompt.
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
	const raw = await compactBase(
		preparation,
		model,
		apiKey,
		headers,
		customInstructions,
		signal,
		thinkingLevel,
		streamFn,
		onProgress,
	);
	const rawDetails = raw.details as CompactionDetails | undefined;
	const resolved = resolveCompactionSettings(preparation.settings);
	const previous = preparation.structuredState;
	if (!previous || !hasMeaningfulStructuredSessionState(previous)) {
		const recallNote =
			"\n\n## Recall\n- Exact compacted messages and tool outputs remain in the session log. Use session_recall before guessing.";
		const summary = `${raw.summary}${recallNote}`;
		const summaryTokens = Math.ceil(summary.length / 4);
		return {
			...raw,
			summary,
			tokensAfter: preparation.systemPromptTokens + summaryTokens + preparation.recentRawTokens,
			details: {
				...rawDetails,
				markdownSummary: raw.summary,
			} satisfies CompactionDetails,
		};
	}

	let state = createStructuredSessionState({
		sessionId: previous.sessionId,
		previous,
		summary: raw.summary,
		entries: [],
		readFiles: rawDetails?.readFiles,
		modifiedFiles: rawDetails?.modifiedFiles,
		audit: rawDetails?.audit ? { ...rawDetails.audit, risks: [] } : undefined,
		timestamp: new Date().toISOString(),
	});
	state = preserveCanonicalRequest(state, previous);

	const stubbedPointers = [
		...stubToolResultsForCompactionSummary(preparation.messagesToSummarize).stubs.map((stub) => stub.rawPointer),
		...stubToolResultsForCompactionSummary(preparation.turnPrefixMessages).stubs.map((stub) => stub.rawPointer),
	];
	if (stubbedPointers.length > 0) {
		state = mergeStructuredSessionState(state, { evidence: { add: stubbedPointers } });
	}

	const summary = renderMinimalCompactionCheckpoint(state, resolved.renderedStateMaxTokens);
	const summaryTokens = Math.ceil(summary.length / 4);
	const tokensAfter = preparation.systemPromptTokens + summaryTokens + preparation.recentRawTokens;
	const audit = rawDetails?.audit
		? {
				...rawDetails.audit,
				afterTokens: tokensAfter,
				savedTokens: Math.max(0, preparation.tokensBefore - tokensAfter),
				summaryTokens,
				renderedStateTokens: summaryTokens,
				risks: tokensAfter > resolved.targetContextTokens ? ["post-compaction context exceeds target"] : [],
			}
		: undefined;

	return {
		...raw,
		summary,
		tokensAfter,
		details: {
			readFiles: rawDetails?.readFiles ?? [],
			modifiedFiles: rawDetails?.modifiedFiles ?? [],
			audit,
			markdownSummary: raw.summary,
			structuredState: state,
		} satisfies CompactionDetails,
	};
}

function messageText(message: AgentMessage): string | undefined {
	switch (message.role) {
		case "user":
		case "custom":
			return typeof message.content === "string"
				? message.content
				: message.content
						.filter((block) => block.type === "text")
						.map((block) => block.text)
						.join("\n");
		case "toolResult":
			return message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
		case "assistant":
			return message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
		case "bashExecution":
			return `${message.command}\n${message.output}`;
		case "branchSummary":
		case "compactionSummary":
			return message.summary;
	}
}

function replaceText(message: AgentMessage, text: string): AgentMessage {
	switch (message.role) {
		case "user":
		case "custom": {
			if (typeof message.content === "string") return { ...message, content: text };
			let replaced = false;
			return {
				...message,
				content: message.content
					.filter((block) => block.type !== "text" || !replaced)
					.map((block) => {
						if (block.type !== "text") return block;
						replaced = true;
						return { ...block, text };
					}),
			};
		}
		case "toolResult": {
			let replaced = false;
			return {
				...message,
				content: message.content
					.filter((block) => block.type !== "text" || !replaced)
					.map((block) => {
						if (block.type !== "text") return block;
						replaced = true;
						return { ...block, text };
					}),
			} as ToolResultMessage;
		}
		case "assistant": {
			let replaced = false;
			return {
				...message,
				content: message.content
					.filter((block) => block.type !== "text" || !replaced)
					.map((block) => {
						if (block.type !== "text") return block;
						replaced = true;
						return { ...block, text };
					}),
			} as AssistantMessage;
		}
		case "bashExecution":
			return { ...message, output: text };
		default:
			return message;
	}
}

function truncateHeadAndTail(text: string, maxLines: number, maxChars: number): string {
	const lines = text.split("\n");
	if (text.length <= maxChars && lines.length <= maxLines) return text;
	if (maxLines <= 0 || maxChars <= 0) {
		return "[...compacted content omitted; use session_recall for the exact message...]";
	}
	const headCount = Math.ceil(maxLines / 2);
	const tailCount = Math.floor(maxLines / 2);
	let result = [...lines.slice(0, headCount), ...lines.slice(-tailCount)].join("\n");
	if (result.length > maxChars) {
		const separator = "\n... [middle omitted] ...\n";
		const available = Math.max(0, maxChars - separator.length);
		const headChars = Math.ceil(available / 2);
		const tailChars = Math.floor(available / 2);
		result = `${result.slice(0, headChars)}${separator}${result.slice(-tailChars)}`;
	}
	return `[...compacted; showing beginning and end, use session_recall for exact content...]\n${result}`;
}

function totalTokens(messages: AgentMessage[], systemPromptTokens: number): number {
	return systemPromptTokens + messages.reduce((total, message) => total + estimateTokens(message), 0);
}

/**
 * Enforce the final prompt target without destroying the beginning of old
 * requests. Oversized kept messages retain both setup and outcome; exact raw
 * content remains retrievable from the persisted session.
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

	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (message.role === "compactionSummary") continue;
		const text = messageText(message);
		if (text && estimateTokens(message) > keepRecentTokens) {
			messages[index] = replaceText(message, truncateHeadAndTail(text, MAX_MESSAGE_LINES, MAX_MESSAGE_CHARS));
		}
	}

	for (const [maxTokens, maxLines, maxChars] of [
		[500, 10, 4000],
		[50, 4, 800],
		[0, 0, 0],
	] as const) {
		if (totalTokens(messages, systemPromptTokens) <= targetContextTokens) break;
		for (let index = 0; index < messages.length; index++) {
			if (totalTokens(messages, systemPromptTokens) <= targetContextTokens) break;
			const message = messages[index];
			if (message.role === "compactionSummary") continue;
			const text = messageText(message);
			if (!text || estimateTokens(message) <= maxTokens) continue;
			messages[index] = replaceText(message, truncateHeadAndTail(text, maxLines, maxChars));
		}
	}
	return messages;
}
