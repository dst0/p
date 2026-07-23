/**
 * AgentSession - Core abstraction for agent lifecycle and session management.
 *
 * This class is shared between all run modes (interactive, print, rpc).
 * It encapsulates:
 * - Agent state access
 * - Event subscription with automatic session persistence
 * - Model and thinking level management
 * - Compaction (manual and auto)
 * - Bash execution
 * - Session switching and branching
 *
 * Modes use this class and add their own I/O layer on top.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import {
	Agent,
	type AgentEvent,
	type AgentMessage,
	type AgentState,
	type AgentTool,
	type CompletionMode,
	FINISH_WORK_TOOL_NAME,
	type ThinkingLevel,
} from "@dst0/p-agent-core";
import type { AssistantMessage, ImageContent, Message, Model, TextContent } from "@dst0/p-ai";
import {
	clampThinkingLevel,
	cleanupSessionResources,
	completeSimple,
	getSupportedThinkingLevels,
	isContextOverflow,
	modelsAreEqual,
	resetApiProviders,
	streamSimple,
} from "@dst0/p-ai";
import { Type } from "typebox";
import { getThemeByName, theme } from "../modes/interactive/theme/theme.ts";
import { stripFrontmatter } from "../utils/frontmatter.ts";
import { resolvePath } from "../utils/paths.ts";
import { sleep } from "../utils/sleep.ts";
import { formatNoApiKeyFoundMessage, formatNoModelSelectedMessage } from "./auth-guidance.ts";
import { type BashResult, executeBashWithOperations } from "./bash-executor.ts";
import {
	type CompactionDetails,
	type CompactionPreparation,
	type CompactionResult,
	type CompactionSettings,
	type ContextUsageEstimate,
	collectEntriesForBranchSummary,
	compact as compactWithModel,
	computeFileLists,
	createContextBudgetReport,
	createInitialStructuredSessionState,
	createLiveStructuredSessionState,
	createStructuredSessionState,
	type EvidenceKind,
	type EvidencePointer,
	estimateContextTokens,
	estimateTokens,
	type FileTouchStatus,
	findMatchingPlanItem,
	generateBranchSummary,
	getLatestStructuredSessionState,
	hasMeaningfulStructuredSessionState,
	isStructuredSessionState,
	mergeStructuredSessionState,
	type PlanStatus,
	parseSessionStateUpdateBlock,
	prepareCompaction,
	readSessionStateFile,
	renderStructuredSessionCheckpoint,
	renderWorkingSessionState,
	STRUCTURED_SESSION_STATE_CUSTOM_TYPE,
	type StatePatch,
	type StructuredSessionState,
	selectKeepRecentTokens,
	shouldCompact,
	stripSessionStateUpdateBlocks,
	stubToolResultsForCompactionSummary,
	type TouchedFile,
	truncateKeptMessages,
	writeSessionStateFile,
} from "./compaction/index.ts";
import { DEFAULT_THINKING_LEVEL } from "./defaults.ts";
import { exportSessionToHtml, type ToolHtmlRenderer } from "./export-html/index.ts";
import { createToolHtmlRenderer } from "./export-html/tool-renderer.ts";
import {
	type ContextUsage,
	type ExtensionCommandContextActions,
	type ExtensionErrorListener,
	type ExtensionMode,
	ExtensionRunner,
	type ExtensionUIContext,
	type InputSource,
	type MessageEndEvent,
	type MessageStartEvent,
	type MessageUpdateEvent,
	type ReplacedSessionContext,
	type SessionBeforeCompactResult,
	type SessionBeforeTreeResult,
	type SessionStartEvent,
	type ShutdownHandler,
	type ToolDefinition,
	type ToolExecutionEndEvent,
	type ToolExecutionStartEvent,
	type ToolExecutionUpdateEvent,
	type ToolInfo,
	type TreePreparation,
	type TurnEndEvent,
	type TurnStartEvent,
	wrapRegisteredTools,
} from "./extensions/index.ts";
import { emitSessionShutdownEvent } from "./extensions/runner.ts";
import { type ConstraintPhase, evaluateGuardrails, type GuardrailReport } from "./guardrails.ts";
import {
	type BashExecutionMessage,
	type CustomMessage,
	FAST_RESPONDER_CUSTOM_TYPE,
	filterSleepToolUseForHistory,
	SLEEP_TOOL_NAME,
} from "./messages.ts";
import type { ModelRegistry } from "./model-registry.ts";
import { installAgentSessionPrepareNextTurn } from "./prepare-next-turn.ts";
import {
	createProjectMemoryContext,
	diffProjectMemorySnapshot,
	forgetProjectMemory,
	initProjectMemory,
	type ProjectMemoryDiffResult,
	type ProjectMemoryForgetResult,
	type ProjectMemoryInitResult,
	type ProjectMemoryPinResult,
	type ProjectMemorySearchResult,
	type ProjectMemoryUpdateResult,
	pinProjectMemory,
	searchProjectMemory,
	updateProjectMemorySnapshot,
} from "./project-memory.ts";
import {
	createRulesContext,
	explainProjectRules,
	lintProjectRules,
	type RuleExplainResult,
	type RuleLintResult,
} from "./project-rules.ts";
import { expandPromptTemplate, type PromptTemplate } from "./prompt-templates.ts";
import { createRepoMapContext, type RepoMap, updateRepoMap } from "./repo-map.ts";
import type { ResourceExtensionPaths, ResourceLoader } from "./resource-loader.ts";
import type { BranchSummaryEntry, CompactionEntry, SessionEntry, SessionManager } from "./session-manager.ts";
import { CURRENT_SESSION_VERSION, getLatestCompactionEntry, type SessionHeader } from "./session-manager.ts";
import type { SettingsManager } from "./settings-manager.ts";
import type { SlashCommandInfo } from "./slash-commands.ts";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.ts";
import {
	BUILTIN_SUBAGENT_PROFILES,
	createSubagentDigestContext,
	createSubagentProfilesPrompt,
	getSubagentAllowedTools,
	persistSubagentDigest,
	persistSubagentTranscript,
	type RunSubagentInput,
	type RunSubagentResult,
	readSubagentDigests,
	type SubagentDigest,
	type SubagentName,
} from "./subagents.ts";
import { type BuildSystemPromptOptions, buildSystemPrompt } from "./system-prompt.ts";
import { createTokenBreakdown, type TokenBreakdown } from "./token-accounting.ts";
import { type BashOperations, createLocalBashOperations } from "./tools/bash.ts";
import {
	createAllToolDefinitions,
	createFinishWorkToolDefinition,
	createSubmitPlanToolDefinition,
} from "./tools/index.ts";
import { createToolDefinitionFromAgentTool } from "./tools/tool-definition-wrapper.ts";
import { createTurnCheckpointMessages } from "./turn-checkpoint.ts";
import { createVerificationLedger, type VerificationLedger } from "./verification-ledger.ts";

const RETRYABLE_ERROR_PATTERN =
	/overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|connection.?reset|econnreset|econnrefused|etimedout|eai_again|enotfound|websocket.?closed|websocket.?error|other side closed|socket.?hang.?up|socket.?closed|fetch failed|upstream.?connect|reset before headers|headers.?timeout|body.?timeout|und_err|request.?aborted|response.?aborted|aborted before response|premature.?close|ended without|stream ended before message_stop|http2 request did not get a response|timed? out|timeout|terminated|retry delay|failed to parse|could not parse|invalid json|unexpected token|unexpected end of json|response body|no response body|body is unusable/i;
const MODEL_RECOVERY_RETRY_PATTERN =
	/loading model|model.*loading|model load|model.*not ready|no available workers?|no workers? available|workers?.*(?:unavailable|not ready|loading)/i;
const MODEL_RECOVERY_MIN_RETRIES = 15;
const MODEL_RECOVERY_BASE_DELAY_MS = 1_000;
const MODEL_RECOVERY_MAX_RETRY_DELAY_MS = 15_000;
const UPDATE_SESSION_STATE_TOOL_NAME = "update_session_state";
const MARK_SESSION_PROGRESS_TOOL_NAME = "mark_session_progress";
export const TOOL_SEARCH_TOOL_NAME = "tool_search";
const TOOL_SEARCH_SCHEMA = Type.Object({
	query: Type.Optional(
		Type.String({
			description:
				"Capability to find, such as 'Chrome tabs', 'Gmail', 'TypeScript diagnostics', or 'memory search'",
		}),
	),
	names: Type.Optional(
		Type.Array(Type.String(), {
			description: "Exact tool names to activate when they are already known",
			maxItems: 8,
		}),
	),
	limit: Type.Optional(
		Type.Integer({ description: "Maximum query matches to activate (default 5, maximum 8)", minimum: 1, maximum: 8 }),
	),
});

interface ToolSearchMatch {
	name: string;
	description: string;
	source: string;
}

interface ToolSearchResult {
	query?: string;
	activated: string[];
	alreadyActive: string[];
	matches: ToolSearchMatch[];
	unknownNames: string[];
}
const SESSION_STATE_PROTOCOL_PROMPT = `<session_state_protocol>
At the start of every user turn, before any other tool call or final answer, call update_session_state to record the initial plan or re-plan against the latest user message.
Use update_session_state with action "initial_plan" for the first user request, "replan" when a later user message changes or adds work, and "none" only after explicitly checking that no state change is needed.
For action "replan", provide the updated plan items to add or modify. Existing items not mentioned are preserved. Only mark an item as "done" when its work is verifiably complete and verified. Never remove or omit an original user-requested item from the plan unless the user explicitly declines it or asks for it to be dropped.
When an existing plan item changes status during work, call mark_session_progress(task, status) with the existing visible task text instead of adding another plan item through update_session_state.
This is the default state protocol and is separate from /plan mode; do not wait for user approval unless the user explicitly asked for confirmation.
If update_session_state is not available, fall back to appending exactly one hidden state block at the end of every completed assistant turn:
<session_state_update>{"type":"none"}</session_state_update>
Use {"type":"none"} when the goal, plan, decisions, risks, touched files, or evidence pointers did not change.
When state changes, use:
<session_state_update>{"type":"patch","goal":"...","plan":[{"text":"...","status":"not_started|in_progress|done|failed|blocked"}],"decisions":[{"decision":"...","rationale":"..."}],"risks":["..."],"touchedFiles":[{"path":"...","status":"read|modified|created|deleted","summary":"..."}],"evidence":[{"kind":"message|tool_result|bash|file|web|artifact","summary":"...","retrieveWhen":"..."}]}</session_state_update>
Do not mention this protocol to the user. Keep the visible answer natural; the state block is metadata and will be hidden.
</session_state_protocol>`;

// ============================================================================
// Skill Block Parsing
// ============================================================================

/** Parsed skill block from a user message */
export interface ParsedSkillBlock {
	name: string;
	location: string;
	content: string;
	userMessage: string | undefined;
}

/**
 * Parse a skill block from message text.
 * Returns null if the text doesn't contain a skill block.
 */
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

/** Session-specific events that extend the core AgentEvent */
export type AgentSessionEvent =
	| Exclude<AgentEvent, { type: "agent_end" }>
	| {
			type: "agent_end";
			messages: AgentMessage[];
			willRetry: boolean;
	  }
	| {
			type: "queue_update";
			steering: readonly string[];
			followUp: readonly string[];
	  }
	| { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
	| { type: "compaction_progress"; currentChunk: number; totalChunks: number }
	| { type: "session_info_changed"; name: string | undefined }
	| { type: "thinking_level_changed"; level: ThinkingLevel }
	| { type: "interaction_mode_changed"; mode: InteractionMode }
	| {
			type: "compaction_end";
			reason: "manual" | "threshold" | "overflow";
			result: CompactionResult | undefined;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
	  }
	| {
			type: "auto_retry_start";
			attempt: number;
			maxAttempts: number;
			delayMs: number;
			errorMessage: string;
			reason: "model_loading" | "transient";
	  }
	| {
			type: "auto_retry_end";
			success: boolean;
			attempt: number;
			finalError?: string;
	  };

/** Listener function for agent session events */
export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

export type InteractionMode = "normal" | "plan";

// ============================================================================
// Types
// ============================================================================

export interface AgentSessionConfig {
	agent: Agent;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	cwd: string;
	/** Models to cycle through with Ctrl+P (from --models flag) */
	scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
	/** Resource loader for skills, prompts, themes, context files, system prompt */
	resourceLoader: ResourceLoader;
	/** SDK custom tools registered outside extensions */
	customTools?: ToolDefinition[];
	/** Whether every registered extension/custom tool starts active. */
	includeAllExtensionTools?: boolean;
	/** Model registry for API key resolution and model discovery */
	modelRegistry: ModelRegistry;
	/** Initial active built-in tool names. Default: [read, bash, edit, write] */
	initialActiveToolNames?: string[];
	/** Optional allowlist of tool names. When provided, only these tool names are exposed. */
	allowedToolNames?: string[];
	/** Optional denylist of tool names. When provided, these tool names are not exposed. */
	excludedToolNames?: string[];
	/**
	 * Override base tools (useful for custom runtimes).
	 *
	 * These are synthesized into minimal ToolDefinitions internally so AgentSession can keep
	 * a definition-first registry even when callers provide plain AgentTool instances.
	 */
	baseToolsOverride?: Record<string, AgentTool>;
	/** Mutable ref used by Agent to access the current ExtensionRunner */
	extensionRunnerRef?: { current?: ExtensionRunner };
	/** Session start event metadata emitted when extensions bind to this runtime. */
	sessionStartEvent?: SessionStartEvent;
	/** Completion protocol used by this session. */
	completionMode?: CompletionMode;
}

export interface ExtensionBindings {
	uiContext?: ExtensionUIContext;
	mode?: ExtensionMode;
	commandContextActions?: ExtensionCommandContextActions;
	abortHandler?: () => void;
	shutdownHandler?: ShutdownHandler;
	onError?: ExtensionErrorListener;
}

/** Options for AgentSession.prompt() */
export interface PromptOptions {
	/** Whether to expand file-based prompt templates (default: true) */
	expandPromptTemplates?: boolean;
	/** Image attachments */
	images?: ImageContent[];
	/** When streaming, how to queue the message: "steer" (interrupt) or "followUp" (wait). Required if streaming. */
	streamingBehavior?: "steer" | "followUp";
	/** Source of input for extension input event handlers. Defaults to "interactive". */
	source?: InputSource;
	/** Internal hook used by RPC mode to observe prompt preflight acceptance or rejection. */
	preflightResult?: (success: boolean) => void;
}

/** Result from cycleModel() */
export interface ModelCycleResult {
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	/** Whether cycling through scoped models (--models flag) or all available */
	isScoped: boolean;
}

/** Session statistics for /session command */
export interface SessionStats {
	sessionFile: string | undefined;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	cost: number;
	contextUsage?: ContextUsage;
}

export interface CompactionDryRunResult {
	ok: boolean;
	reason?: string;
	message?: string;
	contextTokens: number;
	contextWindow: number;
	triggerThreshold: number;
	shouldCompact: boolean;
	keepRecentTokens?: number;
	firstKeptEntryId?: string;
	tokensToSummarize?: number;
	recentRawTokens?: number;
	projectedAfterTokens?: number;
	droppedEntries?: string[];
	toolRawTokens: number;
	toolStubTokens: number;
	toolStubSavings: number;
	stubbedToolResults: string[];
	tokenBreakdown?: TokenBreakdown;
}

export interface SessionStateSnapshot {
	sessionId: string;
	checkpoint: string;
	state: StructuredSessionState;
	contextUsage?: ContextUsage;
	lastCompaction?: {
		id: string;
		timestamp: string;
		audit?: CompactionDetails["audit"];
	};
}

interface ToolDefinitionEntry {
	definition: ToolDefinition;
	sourceInfo: SourceInfo;
}

// ============================================================================
// Constants
// ============================================================================

/** Standard thinking levels */
const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStateText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function capStateToolText(text: string, maxChars: number): string {
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

function createStateToolStableId(prefix: string, text: string): string {
	const normalized = normalizeStateText(text).toLowerCase();
	let hash = 2166136261;
	for (let index = 0; index < normalized.length; index++) {
		hash ^= normalized.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `${prefix}-${(hash >>> 0).toString(16)}`;
}

function hasStateToolPatchContent(patch: StatePatch): boolean {
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

function getOpenSessionStateItems(state: StructuredSessionState): string[] {
	const openPlanItems = state.plan
		.filter((item) => item.status !== "done")
		.map((item) => `${item.text} (${item.status})`);
	if (openPlanItems.length > 0) {
		return openPlanItems;
	}
	return [];
}

function getFinishWorkStatus(args: unknown): string | undefined {
	return isRecord(args) && typeof args.status === "string" ? args.status : undefined;
}

/**
 * Transition not_started and in_progress plan items to done.
 * Does NOT touch failed or blocked items — those remain suspicious.
 */
function reconcilePlanItemsForSuccessFinish(state: StructuredSessionState): StructuredSessionState | undefined {
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

function getFinishWorkRemainingWork(args: unknown): string[] {
	if (!isRecord(args) || !Array.isArray(args.remaining_work)) {
		return [];
	}
	return args.remaining_work
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function isInternalCompletionProtocolRepairMessage(message: AgentMessage): boolean {
	return (
		message.role === "user" &&
		isRecord(message.metadata) &&
		message.metadata.pInternal === "completion_protocol_repair"
	);
}

function normalizeCompactionDetails(details: unknown): CompactionDetails {
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

// ============================================================================
const SESSION_RECALL_SCHEMA = Type.Object({
	query: Type.String({
		description: "Pointer id or search query for old session evidence",
	}),
	kind: Type.Optional(
		Type.Array(
			Type.Union([
				Type.Literal("message"),
				Type.Literal("tool_result"),
				Type.Literal("bash"),
				Type.Literal("file"),
				Type.Literal("web"),
				Type.Literal("artifact"),
			]),
		),
	),
	maxTokens: Type.Optional(
		Type.Number({
			description: "Maximum returned excerpt tokens; default 1200, or 4000 with includeRaw",
		}),
	),
	includeRaw: Type.Optional(Type.Boolean({ description: "Include raw excerpts when available" })),
});

const KEEP_CONTEXT_SCHEMA = Type.Object({
	toolCallId: Type.String({
		description: "The ID of the tool call whose result you want to keep or summarize.",
	}),
	summary: Type.Optional(
		Type.String({
			description: "A concise summary of the relevant parts of the output.",
		}),
	),
	relevantLines: Type.Optional(
		Type.Array(Type.String(), {
			description: "Key lines from the output that should be preserved verbatim.",
		}),
	),
	pin: Type.Optional(
		Type.Boolean({
			description: "If true, keep the entire raw output in context for as long as possible (use sparingly).",
		}),
	),
});

interface SessionRecallInput {
	query: string;
	kind?: EvidenceKind[];
	maxTokens?: number;
	includeRaw?: boolean;
}

const UPDATE_SESSION_STATE_PLAN_STATUS_SCHEMA = Type.Union([
	Type.Literal("not_started"),
	Type.Literal("in_progress"),
	Type.Literal("done"),
	Type.Literal("failed"),
	Type.Literal("blocked"),
]);

const UPDATE_SESSION_STATE_FILE_STATUS_SCHEMA = Type.Union([
	Type.Literal("read"),
	Type.Literal("modified"),
	Type.Literal("created"),
	Type.Literal("deleted"),
]);

const UPDATE_SESSION_STATE_EVIDENCE_KIND_SCHEMA = Type.Union([
	Type.Literal("message"),
	Type.Literal("tool_result"),
	Type.Literal("bash"),
	Type.Literal("file"),
	Type.Literal("web"),
	Type.Literal("artifact"),
]);

const UPDATE_SESSION_STATE_SCHEMA = Type.Object({
	action: Type.Union([
		Type.Literal("initial_plan"),
		Type.Literal("replan"),
		Type.Literal("progress_update"),
		Type.Literal("none"),
	]),
	goal: Type.Optional(
		Type.String({
			description: "Canonical current user goal after considering the latest user message.",
		}),
	),
	plan: Type.Optional(
		Type.Array(
			Type.Object({
				text: Type.String(),
				op: Type.Optional(Type.Union([Type.Literal("add"), Type.Literal("update"), Type.Literal("remove")])),
				status: Type.Optional(UPDATE_SESSION_STATE_PLAN_STATUS_SCHEMA),
			}),
		),
	),
	decisions: Type.Optional(
		Type.Array(
			Type.Object({
				decision: Type.String(),
				rationale: Type.Optional(Type.String()),
			}),
		),
	),
	risks: Type.Optional(Type.Array(Type.String())),
	touchedFiles: Type.Optional(
		Type.Array(
			Type.Object({
				path: Type.String(),
				status: Type.Optional(UPDATE_SESSION_STATE_FILE_STATUS_SCHEMA),
				summary: Type.Optional(Type.String()),
			}),
		),
	),
	evidence: Type.Optional(
		Type.Array(
			Type.Object({
				kind: Type.Optional(UPDATE_SESSION_STATE_EVIDENCE_KIND_SCHEMA),
				summary: Type.String(),
				path: Type.Optional(Type.String()),
				retrieveWhen: Type.Optional(Type.String()),
			}),
		),
	),
});

const MARK_SESSION_PROGRESS_SCHEMA = Type.Object({
	task: Type.String({
		description: "Existing plan item text to update. Use the visible task text from the working state.",
	}),
	status: UPDATE_SESSION_STATE_PLAN_STATUS_SCHEMA,
});

interface UpdateSessionStateInput {
	action: "initial_plan" | "replan" | "progress_update" | "none";
	goal?: string;
	plan?: Array<{ text: string; op?: "add" | "update" | "remove"; status?: PlanStatus }>;
	decisions?: Array<{ decision: string; rationale?: string }>;
	risks?: string[];
	touchedFiles?: Array<{ path: string; status?: FileTouchStatus; summary?: string }>;
	evidence?: Array<{ kind?: EvidenceKind; summary: string; path?: string; retrieveWhen?: string }>;
}

interface UpdateSessionStateResult {
	status: "updated" | "unchanged";
	action: UpdateSessionStateInput["action"];
	goal: string;
	planItems: number;
	toolCalls: number;
}

interface MarkSessionProgressInput {
	task: string;
	status: PlanStatus;
}

interface MarkSessionProgressResult {
	status: "updated" | "not_found";
	task: string;
	matchedTask?: string;
	goal: string;
	planItems: number;
	toolCalls: number;
}

const RUN_SUBAGENT_SCHEMA = Type.Object({
	profile: Type.Union([Type.Literal("explore"), Type.Literal("scout"), Type.Literal("review")]),
	task: Type.String({ description: "Task description for the subagent" }),
});

interface RecallHit {
	pointer: EvidencePointer;
	relevance: number;
	summary: string;
	excerpt?: string;
	rawTokens?: number;
	excerptTokens?: number;
	truncated?: boolean;
}

interface RecallResult {
	query: string;
	hits: RecallHit[];
}

interface RecallCandidate {
	pointer: EvidencePointer;
	searchText: string;
	rawText?: string;
}

interface RuntimeContextPrompts {
	baseSystemPrompt?: string;
	stateProtocolPrompt?: string;
	workingStatePrompt?: string;
	memoryPrompt?: string;
	rulesPrompt?: string;
	repoMapPrompt?: string;
	subagentProfilesPrompt?: string;
	subagentDigestPrompt?: string;
	combinedPrompt?: string;
	turnContextPrompt?: string;
}

interface PromptContextPreparation {
	messages: AgentMessage[];
	estimate: ContextUsageEstimate;
	budgetEstimate: ContextUsageEstimate;
	source: "provider_usage" | "estimated";
	toolRawTokens: number;
}

interface WorkingStatePromptInsertion {
	anchorKey: string;
	content: string;
	timestamp: number;
}

interface WorkingStatePromptInsertionOptions {
	recordWorkingState?: boolean;
	minimumAnchorTimestamp?: number;
}

const WORKING_STATE_PROMPT_CUSTOM_TYPE = "working_state";
const RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE = "runtime_context";
const TOOL_RESULT_EXTRACT_MIN_TOKENS = 1_200;
const TOOL_RESULT_EXTRACT_INPUT_TOKENS = 6_000;
const TOOL_RESULT_EXTRACT_OUTPUT_TOKENS = 500;
const FAST_RESPONDER_INPUT_TOKENS = 800;

interface ToolResultContextExtract {
	summary: string;
	relevantLines: string[];
	source: "service_model" | "deterministic";
	model?: string;
	error?: string;
}

function getMessageTextForRecall(message: AgentMessage): string {
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

function estimateToolResultTokens(messages: AgentMessage[]): number {
	let tokens = 0;
	for (const message of messages) {
		if (message.role === "toolResult") {
			tokens += estimateTokens(message);
		}
	}
	return tokens;
}

function hashAnchorText(text: string): string {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function getUserMessageAnchorKey(message: AgentMessage): string | undefined {
	if (message.role !== "user") return undefined;
	const text = getMessageTextForRecall(message);
	return `${message.timestamp}:${text.length}:${hashAnchorText(text)}`;
}

function capTextByTokens(text: string, maxTokens: number): string {
	const maxChars = Math.max(0, Math.floor(maxTokens * 4));
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n[...truncated to ${maxTokens} tokens...]`;
}

function estimateTextTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function summarizeSubagentTranscript(messages: AgentMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "assistant") continue;
		const text = getMessageTextForRecall(message).replace(/\s+/g, " ").trim();
		if (text) return capTextByTokens(text, 300);
	}
	return "Subagent completed without a textual assistant digest.";
}

function getTextContentBlocks(content: (TextContent | ImageContent)[]): TextContent[] {
	return content.filter((block): block is TextContent => block.type === "text");
}

function getToolResultText(content: (TextContent | ImageContent)[]): string {
	return getTextContentBlocks(content)
		.map((block) => block.text)
		.join("\n");
}

function normalizeToolExtractLine(line: string): string {
	return line.replace(/\s+/g, " ").trim();
}

function createDeterministicToolExtract(
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

function parseToolExtractResponse(
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

function normalizeFastResponderText(text: string): string | undefined {
	const stripped = stripSessionStateUpdateBlocks(text).replace(/\s+/g, " ").trim();
	if (!stripped) {
		return undefined;
	}
	return capTextByTokens(stripped, 180);
}

function getLatestUserText(messages: AgentMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "user") continue;
		const text = getMessageTextForRecall(message).replace(/\s+/g, " ").trim();
		if (text.length > 0) return capTextByTokens(text, 250);
	}
	return "";
}

function scoreRecallCandidate(query: string, candidate: RecallCandidate): number {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return 0;
	const pointerId = candidate.pointer.id.toLowerCase();
	if (pointerId === normalizedQuery) return 1;
	if (pointerId.includes(normalizedQuery)) return 0.95;

	const haystack = `${candidate.pointer.summary}\n${candidate.searchText}`.toLowerCase();
	const terms = normalizedQuery.split(/\s+/).filter((term) => term.length > 1);
	if (terms.length === 0) return haystack.includes(normalizedQuery) ? 0.5 : 0;
	const matchedTerms = terms.filter((term) => haystack.includes(term)).length;
	return matchedTerms === 0 ? 0 : matchedTerms / terms.length;
}

function formatRecallResult(result: RecallResult): string {
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

function addOriginalRequestRecallCandidates(
	candidates: RecallCandidate[],
	state: StructuredSessionState,
	seenRequestIds: Set<string>,
): void {
	for (const request of state.canonicalRequest.originalRequests ?? []) {
		if (seenRequestIds.has(request.id)) continue;
		seenRequestIds.add(request.id);
		const kindLabel = request.kind === "follow_up" ? "follow-up" : request.kind;
		candidates.push({
			pointer: {
				id: request.id,
				kind: "message",
				entryId: request.entryId,
				summary: `User ${kindLabel}: ${request.summary}`,
				retrieveWhen: "Need the exact original user prompt preserved across compaction.",
			},
			searchText: [
				"all user prompts in this session",
				"original prompts prompt requests request user messages",
				request.kind,
				state.canonicalRequest.current,
				request.summary,
				request.text,
			].join("\n"),
			rawText: request.text,
		});
	}
}

const MAX_OVERFLOW_RECOVERY_COMPACTIONS = 3;

// AgentSession Class
// ============================================================================

export class AgentSession {
	readonly agent: Agent;
	readonly sessionManager: SessionManager;
	readonly settingsManager: SettingsManager;

	private _scopedModels: Array<{
		model: Model<any>;
		thinkingLevel?: ThinkingLevel;
	}>;

	// Event subscription state
	private _unsubscribeAgent?: () => void;
	private _eventListeners: AgentSessionEventListener[] = [];

	/** Tracks pending steering messages for UI display. Removed when delivered. */
	private _steeringMessages: string[] = [];
	/** Tracks pending follow-up messages for UI display. Removed when delivered. */
	private _followUpMessages: string[] = [];
	/** Messages queued to be included with the next user prompt as context ("asides"). */
	private _pendingNextTurnMessages: CustomMessage[] = [];

	// Compaction state
	private _compactionAbortController: AbortController | undefined = undefined;
	private _autoCompactionAbortController: AbortController | undefined = undefined;
	private _overflowRecoveryAttempts = 0;

	// Branch summarization state
	private _branchSummaryAbortController: AbortController | undefined = undefined;

	// Retry state
	private _retryAbortController: AbortController | undefined = undefined;
	private _retryAttempt = 0;

	// Bash execution state
	private _bashAbortController: AbortController | undefined = undefined;
	private _pendingBashMessages: BashExecutionMessage[] = [];
	private _recentBashCommands: string[] = [];

	// Extension system
	private _extensionRunner!: ExtensionRunner;
	private _turnIndex = 0;

	private _resourceLoader: ResourceLoader;
	private _customTools: ToolDefinition[];
	private _baseToolDefinitions: Map<string, ToolDefinition> = new Map();
	private _cwd: string;
	private _extensionRunnerRef?: { current?: ExtensionRunner };
	private _initialActiveToolNames?: string[];
	private _allowedToolNames?: Set<string>;
	private _excludedToolNames?: Set<string>;
	private _baseToolsOverride?: Record<string, AgentTool>;
	private _includeAllExtensionTools = false;
	private _sessionStartEvent: SessionStartEvent;
	private _extensionUIContext?: ExtensionUIContext;
	private _extensionMode: ExtensionMode = "print";
	private _extensionCommandContextActions?: ExtensionCommandContextActions;
	private _extensionAbortHandler?: () => void;
	private _extensionShutdownHandler?: ShutdownHandler;
	private _extensionErrorListener?: ExtensionErrorListener;
	private _extensionErrorUnsubscriber?: () => void;
	private _completionMode: CompletionMode;
	private _interactionMode: InteractionMode = "normal";
	private _planModePreviousActiveToolNames: string[] | undefined;
	private _stateUpdateRequiredForCurrentUserTurn = false;
	private _progressUpdateRequiredBeforeFinish = false;

	// Model registry for API key resolution
	private _modelRegistry: ModelRegistry;

	// Tool registry for extension getTools/setTools
	private _toolRegistry: Map<string, AgentTool> = new Map();
	private _toolDefinitions: Map<string, ToolDefinitionEntry> = new Map();
	private _toolPromptSnippets: Map<string, string> = new Map();
	private _toolPromptGuidelines: Map<string, string[]> = new Map();

	// Base system prompt (without extension appends) - used to apply fresh appends each turn
	private _baseSystemPrompt = "";
	private _baseSystemPromptOptions!: BuildSystemPromptOptions;
	private _lastRuntimePromptComponents: RuntimeContextPrompts = {};
	private _workingStatePromptInsertions: WorkingStatePromptInsertion[] = [];
	private _lastTokenBreakdown: TokenBreakdown | undefined = undefined;

	// Verification ledger for tracking required pre-commit/pre-push checks
	private _verificationLedger: VerificationLedger;

	constructor(config: AgentSessionConfig) {
		this.agent = config.agent;
		this.sessionManager = config.sessionManager;
		this.agent.sessionId = this.sessionManager.getSessionId();
		this.settingsManager = config.settingsManager;
		this._scopedModels = config.scopedModels ?? [];
		this._resourceLoader = config.resourceLoader;
		this._customTools = config.customTools ?? [];
		this._cwd = config.cwd;
		this._modelRegistry = config.modelRegistry;
		this._extensionRunnerRef = config.extensionRunnerRef;
		this._initialActiveToolNames = config.initialActiveToolNames;
		this._allowedToolNames = config.allowedToolNames ? new Set(config.allowedToolNames) : undefined;
		this._excludedToolNames = config.excludedToolNames ? new Set(config.excludedToolNames) : undefined;
		this._baseToolsOverride = config.baseToolsOverride;
		this._includeAllExtensionTools = config.includeAllExtensionTools ?? false;
		this._sessionStartEvent = config.sessionStartEvent ?? {
			type: "session_start",
			reason: "startup",
		};
		this._completionMode = config.completionMode ?? this.agent.completionMode;

		// Verification ledger for tracking required pre-commit/pre-push checks
		this._verificationLedger = createVerificationLedger();

		// Always subscribe to agent events for internal handling
		// (session persistence, extensions, auto-compaction, retry logic)
		this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
		this._installAgentToolHooks();
		this._installPromptContextTransform();

		this._buildRuntime({
			activeToolNames: this._initialActiveToolNames,
			includeAllExtensionTools: this._includeAllExtensionTools,
		});
		installAgentSessionPrepareNextTurn(this.agent, this, this.settingsManager);
	}

	/** Model registry for API key resolution and model discovery */
	get modelRegistry(): ModelRegistry {
		return this._modelRegistry;
	}

	private async _getRequiredRequestAuth(model: Model<any>): Promise<{
		apiKey: string;
		headers?: Record<string, string>;
	}> {
		const result = await this._modelRegistry.getApiKeyAndHeaders(model);
		if (!result.ok) {
			if (result.error.startsWith("No API key found")) {
				throw new Error(formatNoApiKeyFoundMessage(model.provider));
			}
			throw new Error(result.error);
		}
		if (result.apiKey) {
			return { apiKey: result.apiKey, headers: result.headers };
		}

		const isOAuth = this._modelRegistry.isUsingOAuth(model);
		if (isOAuth) {
			throw new Error(
				`Authentication failed for "${model.provider}". ` +
					`Credentials may have expired or network is unavailable. ` +
					`Run '/login ${model.provider}' to re-authenticate.`,
			);
		}
		throw new Error(formatNoApiKeyFoundMessage(model.provider));
	}

	private async _getCompactionRequestAuth(model: Model<any>): Promise<{
		apiKey?: string;
		headers?: Record<string, string>;
	}> {
		if (this.agent.streamFn === streamSimple) {
			return this._getRequiredRequestAuth(model);
		}

		const result = await this._modelRegistry.getApiKeyAndHeaders(model);
		return result.ok ? { apiKey: result.apiKey, headers: result.headers } : {};
	}

	private _getServiceModelRequest(minContextTokens = 0): {
		model: Model<any>;
		thinkingLevel: ThinkingLevel;
	} {
		const fallbackModel = this.model;
		if (!fallbackModel) {
			throw new Error(formatNoModelSelectedMessage());
		}

		const selection = this.settingsManager.getServiceModelSelection();
		let selectedModel: Model<any> | undefined;
		if (selection.provider && selection.modelId) {
			selectedModel = this._modelRegistry.find(selection.provider, selection.modelId);
		} else if (selection.modelId) {
			selectedModel = this._modelRegistry.find(fallbackModel.provider, selection.modelId);
		}

		if (selectedModel) {
			const hasEnoughContext =
				minContextTokens <= 0 ||
				selectedModel.contextWindow <= 0 ||
				selectedModel.contextWindow >= minContextTokens;
			if (hasEnoughContext) {
				return {
					model: selectedModel,
					thinkingLevel: clampThinkingLevel(selectedModel, selection.thinkingLevel ?? "off") as ThinkingLevel,
				};
			}
		}

		return {
			model: fallbackModel,
			thinkingLevel: this.thinkingLevel,
		};
	}

	private async _getServiceAuthWithCurrentFallback(request: {
		model: Model<any>;
		thinkingLevel: ThinkingLevel;
	}): Promise<{
		model: Model<any>;
		thinkingLevel: ThinkingLevel;
		apiKey?: string;
		headers?: Record<string, string>;
	}> {
		try {
			const { apiKey, headers } = await this._getCompactionRequestAuth(request.model);
			return { ...request, apiKey, headers };
		} catch (err) {
			if (!this.model || modelsAreEqual(request.model, this.model)) {
				throw err;
			}
			const { apiKey, headers } = await this._getCompactionRequestAuth(this.model);
			return {
				model: this.model,
				thinkingLevel: this.thinkingLevel,
				apiKey,
				headers,
			};
		}
	}

	private _getFastResponderModelRequest():
		| {
				model: Model<string>;
				thinkingLevel: ThinkingLevel;
		  }
		| undefined {
		const settings = this.settingsManager.getFastResponderSettings();
		if (!settings.enabled || !settings.modelId) {
			return undefined;
		}

		const fallbackModel = this.model;
		if (!fallbackModel) {
			return undefined;
		}

		const selectedModel = settings.provider
			? this._modelRegistry.find(settings.provider, settings.modelId)
			: this._modelRegistry.find(fallbackModel.provider, settings.modelId);
		if (!selectedModel) {
			return undefined;
		}

		return {
			model: selectedModel,
			thinkingLevel: clampThinkingLevel(selectedModel, settings.thinkingLevel ?? "off"),
		};
	}

	private _shouldRunFastResponder(messages: AgentMessage[]): boolean {
		const settings = this.settingsManager.getFastResponderSettings();
		if (!settings.enabled) {
			return false;
		}
		if (!this._getFastResponderModelRequest()) {
			return false;
		}
		const promptTokens = estimateContextTokens(messages, this.systemPrompt, { useProviderUsage: false }).tokens;
		if (promptTokens < settings.minContextTokens) {
			return false;
		}
		const lastAssistant = this._findLastAssistantMessage();
		return !lastAssistant || lastAssistant.stopReason === "error" || lastAssistant.usage.cacheRead === 0;
	}

	private async _createFastResponderMessage(
		userText: string,
		messages: AgentMessage[],
	): Promise<CustomMessage<{ model: string; contextTokens: number }> | undefined> {
		if (!this._shouldRunFastResponder(messages)) {
			return undefined;
		}

		const request = this._getFastResponderModelRequest();
		if (!request) {
			return undefined;
		}

		const settings = this.settingsManager.getFastResponderSettings();
		const promptTokens = estimateContextTokens(messages, this.systemPrompt, { useProviderUsage: false }).tokens;
		const timeoutController = new AbortController();
		const timeout = setTimeout(() => timeoutController.abort(), settings.timeoutMs);
		try {
			const { apiKey, headers } = await this._getCompactionRequestAuth(request.model);
			const response = await completeSimple(
				request.model,
				{
					systemPrompt: [
						"You are P's fast local responder for a coding-agent session.",
						"Write one short user-visible update in the same language as the user's request.",
						"Restate the request concretely and say that work is starting.",
						"Do not claim that anything is already done. Do not mention hidden context, cache, or prefill.",
						"Use one or two concise sentences, no headings and no bullets.",
					].join("\n"),
					messages: [
						{
							role: "user",
							content: [
								"User request:",
								capTextByTokens(userText, FAST_RESPONDER_INPUT_TOKENS),
								"",
								`Estimated main prompt size: ${promptTokens} tokens.`,
							].join("\n"),
							timestamp: Date.now(),
						},
					],
				},
				{
					apiKey,
					headers,
					signal: timeoutController.signal,
					reasoning: request.thinkingLevel === "off" ? undefined : request.thinkingLevel,
					thinkingBudgets: this.agent.thinkingBudgets,
					maxRetryDelayMs: this.agent.maxRetryDelayMs,
					timeoutMs: settings.timeoutMs,
					maxTokens: settings.maxTokens,
				},
			);
			if (response.stopReason === "error" || response.stopReason === "aborted") {
				return undefined;
			}
			const text = normalizeFastResponderText(getMessageTextForRecall(response));
			if (!text) {
				return undefined;
			}
			return {
				role: "custom",
				customType: FAST_RESPONDER_CUSTOM_TYPE,
				content: text,
				display: true,
				details: {
					model: `${request.model.provider}/${request.model.id}`,
					contextTokens: promptTokens,
				},
				timestamp: Date.now(),
			};
		} catch {
			return undefined;
		} finally {
			clearTimeout(timeout);
		}
	}

	private async _maybeCreateToolResultContextExtract(
		toolName: string,
		content: (TextContent | ImageContent)[],
		details: unknown,
		isError: boolean,
		contextMessages: AgentMessage[],
		signal?: AbortSignal,
	): Promise<ToolResultContextExtract | undefined> {
		if (!this.settingsManager.isToolResultContextExtractionEnabled()) {
			return undefined;
		}

		if (isRecord(details) && isRecord(details.contextExtract)) {
			return undefined;
		}

		const text = getToolResultText(content).trim();
		if (!text) {
			return undefined;
		}

		const textTokens = estimateTextTokens(text);
		if (!isError && textTokens < TOOL_RESULT_EXTRACT_MIN_TOKENS) {
			return undefined;
		}

		const fallback = createDeterministicToolExtract(toolName, text, isError);
		const serviceRequest = this._getServiceModelRequest(
			TOOL_RESULT_EXTRACT_INPUT_TOKENS + TOOL_RESULT_EXTRACT_OUTPUT_TOKENS,
		);

		try {
			const authRequest = await this._getServiceAuthWithCurrentFallback(serviceRequest);
			const modelLabel = `${authRequest.model.provider}/${authRequest.model.id}`;
			const latestUserText = getLatestUserText(contextMessages);
			const output = capTextByTokens(text, TOOL_RESULT_EXTRACT_INPUT_TOKENS);
			const response = await completeSimple(
				authRequest.model,
				{
					systemPrompt: [
						"Extract a compact context note from one coding-agent tool result.",
						"The main agent will see only this note unless it explicitly recalls raw evidence.",
						"First line: one concise summary sentence.",
						"Then include up to 12 short evidence lines with exact file paths, commands, errors, counts, or decisions.",
						"Drop boilerplate, progress logs, duplicate lines, and unimportant long output.",
						"Do not invent facts and do not mention content that is not visible in the tool output.",
					].join("\n"),
					messages: [
						{
							role: "user",
							content: [
								`Current user task hint: ${latestUserText || "(unknown)"}`,
								`Tool: ${toolName}`,
								`Status: ${isError ? "error" : "success"}`,
								"Tool output:",
								output,
							].join("\n\n"),
							timestamp: Date.now(),
						},
					],
				},
				{
					apiKey: authRequest.apiKey,
					headers: authRequest.headers,
					signal,
					reasoning: authRequest.thinkingLevel === "off" ? undefined : authRequest.thinkingLevel,
					thinkingBudgets: this.agent.thinkingBudgets,
					maxRetryDelayMs: this.agent.maxRetryDelayMs,
					timeoutMs: 45_000,
				},
			);
			if (response.stopReason === "error" || response.stopReason === "aborted") {
				throw new Error(response.errorMessage ?? `tool-result extraction stopped with ${response.stopReason}`);
			}
			const responseText = getMessageTextForRecall(response).trim();
			return parseToolExtractResponse(responseText, modelLabel, fallback);
		} catch (err) {
			return {
				...fallback,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}

	/**
	 * Install tool hooks once on the Agent instance.
	 *
	 * The callbacks read `this._extensionRunner` at execution time, so extension reload swaps in the
	 * new runner without reinstalling hooks. Extension-specific tool wrappers are still used to adapt
	 * registered tool execution to the extension context. Tool call and tool result interception now
	 * happens here instead of in wrappers.
	 */
	private _installAgentToolHooks(): void {
		this.agent.beforeToolCall = async ({ toolCall, args }) => {
			if (
				this._stateUpdateRequiredForCurrentUserTurn &&
				toolCall.name !== UPDATE_SESSION_STATE_TOOL_NAME &&
				toolCall.name !== SLEEP_TOOL_NAME
			) {
				if (toolCall.name === FINISH_WORK_TOOL_NAME) {
					this._autoExecuteUpdateSessionStateForFinishWork();
				} else {
					return {
						block: true,
						reason:
							`Before calling ${toolCall.name}, call ${UPDATE_SESSION_STATE_TOOL_NAME} first to ` +
							"record or revise the goal, plan, and next action for the latest user message.",
					};
				}
			}
			if (this._progressUpdateRequiredBeforeFinish && toolCall.name === FINISH_WORK_TOOL_NAME) {
				this._autoExecuteUpdateSessionStateForFinishWork();
			}
			if (toolCall.name === FINISH_WORK_TOOL_NAME) {
				const blockReason = this._getFinishWorkSessionStateBlockReason(args);
				if (blockReason) {
					this._autoExecuteUpdateSessionStateForFinishWork();
					const updatedBlockReason = this._getFinishWorkSessionStateBlockReason(args);
					if (updatedBlockReason) {
						return { block: true, reason: updatedBlockReason };
					}
				}
			}

			const runner = this._extensionRunner;
			if (!runner.hasHandlers("tool_call")) {
				return undefined;
			}

			try {
				return await runner.emitToolCall({
					type: "tool_call",
					toolName: toolCall.name,
					toolCallId: toolCall.id,
					input: args as Record<string, unknown>,
				});
			} catch (err) {
				if (err instanceof Error) {
					throw err;
				}
				throw new Error(`Extension failed, blocking execution: ${String(err)}`);
			}
		};

		this.agent.afterToolCall = async ({ toolCall, args, result, isError, context }, signal) => {
			const runner = this._extensionRunner;
			let content = result.content;
			let details: unknown = result.details;
			let nextIsError = isError;
			let changed = false;

			if (runner.hasHandlers("tool_result")) {
				const hookResult = await runner.emitToolResult({
					type: "tool_result",
					toolName: toolCall.name,
					toolCallId: toolCall.id,
					input: args as Record<string, unknown>,
					content,
					details,
					isError: nextIsError,
				});

				if (hookResult) {
					content = hookResult.content ?? content;
					details = hookResult.details ?? details;
					nextIsError = hookResult.isError ?? nextIsError;
					changed = true;
				}
			}

			const extract = await this._maybeCreateToolResultContextExtract(
				toolCall.name,
				content,
				details,
				nextIsError,
				context.messages,
				signal,
			);
			if (extract) {
				details = {
					...(isRecord(details) ? details : {}),
					contextExtract: extract,
				};
				changed = true;
			}

			if (toolCall.name === UPDATE_SESSION_STATE_TOOL_NAME && !nextIsError) {
				this._stateUpdateRequiredForCurrentUserTurn = false;
				this._progressUpdateRequiredBeforeFinish = false;
			} else if (toolCall.name === MARK_SESSION_PROGRESS_TOOL_NAME && !nextIsError) {
				this._progressUpdateRequiredBeforeFinish = false;
			} else if (!nextIsError && toolCall.name !== SLEEP_TOOL_NAME && toolCall.name !== FINISH_WORK_TOOL_NAME) {
				this._progressUpdateRequiredBeforeFinish = true;
			}

			if (
				toolCall.name === FINISH_WORK_TOOL_NAME &&
				getFinishWorkStatus(args) === "success" &&
				!nextIsError
			) {
				this._reconcileSuccessfulFinishWorkState();
			}

			if (!changed) {
				return undefined;
			}

			return {
				content,
				details,
				isError: nextIsError,
			};
		};
	}

	private _getFinishWorkSessionStateBlockReason(args: unknown): string | undefined {
		const state =
			getLatestStructuredSessionState(this.sessionManager.getBranch()) ??
			readSessionStateFile(this._cwd, this.sessionManager.getSessionId());
		if (!state) {
			return undefined;
		}

		const status = getFinishWorkStatus(args);
		const openItems =
			status === "success"
				? state.plan
						.filter((item) => item.status === "failed" || item.status === "blocked")
						.map((item) => `${item.text} (${item.status})`)
				: getOpenSessionStateItems(state);
		if (openItems.length === 0) {
			return undefined;
		}

		const remainingWork = getFinishWorkRemainingWork(args);
		if ((status === "partial" || status === "failed") && remainingWork.length > 0) {
			return undefined;
		}

		const preview = openItems
			.slice(0, 8)
			.map((item) => `- ${item}`)
			.join("\n");
		const suffix = openItems.length > 8 ? `\n- ...and ${openItems.length - 8} more` : "";
		if (status === "partial" || status === "failed") {
			return (
				`Cannot call ${FINISH_WORK_TOOL_NAME} with status "${status}" while session state has unresolved work ` +
				`unless remaining_work lists what is still unfinished:\n${preview}${suffix}`
			);
		}
		return (
			`Cannot call ${FINISH_WORK_TOOL_NAME} with status "${status ?? "success"}" while session state has ` +
			`unresolved work:\n${preview}${suffix}\n` +
			`Do not retry ${FINISH_WORK_TOOL_NAME} until a state-changing tool call succeeds. Call ` +
			`${MARK_SESSION_PROGRESS_TOOL_NAME} for completed existing items, call ${UPDATE_SESSION_STATE_TOOL_NAME} ` +
			`with action "replan" if the scope changed, or finish with status "partial" and remaining_work.`
		);
	}

	// =========================================================================
	// Event Subscription
	// =========================================================================

	/** Emit an event to all listeners */
	private _emit(event: AgentSessionEvent): void {
		for (const l of this._eventListeners) {
			l(event);
		}
	}

	private _emitQueueUpdate(): void {
		this._emit({
			type: "queue_update",
			steering: [...this._steeringMessages],
			followUp: [...this._followUpMessages],
		});
	}

	// Track last assistant message for auto-compaction check
	private _lastAssistantMessage: AssistantMessage | undefined = undefined;

	/** Internal handler for agent events - shared by subscribe and reconnect */
	private _handleAgentEvent = async (event: AgentEvent): Promise<void> => {
		const isInternalRepairEvent =
			(event.type === "message_start" || event.type === "message_end") &&
			isInternalCompletionProtocolRepairMessage(event.message);
		// When a user message starts, check if it's from either queue and remove it BEFORE emitting
		// This ensures the UI sees the updated queue state
		if (event.type === "message_start" && event.message.role === "user") {
			this._overflowRecoveryAttempts = 0;
			const messageText = this._getUserMessageText(event.message);
			if (messageText) {
				// Check steering queue first
				const steeringIndex = this._steeringMessages.indexOf(messageText);
				if (steeringIndex !== -1) {
					this._steeringMessages.splice(steeringIndex, 1);
					this._emitQueueUpdate();
				} else {
					// Check follow-up queue
					const followUpIndex = this._followUpMessages.indexOf(messageText);
					if (followUpIndex !== -1) {
						this._followUpMessages.splice(followUpIndex, 1);
						this._emitQueueUpdate();
					}
				}
			}
		}

		// Emit to extensions first
		if (!isInternalRepairEvent) {
			await this._emitExtensionEvent(event);
		}

		let assistantStateUpdateText: string | undefined;
		if (event.type === "message_end" && event.message.role === "assistant") {
			assistantStateUpdateText = this._getAssistantMessageText(event.message);
			const strippedText = stripSessionStateUpdateBlocks(assistantStateUpdateText);
			if (strippedText !== assistantStateUpdateText) {
				this._replaceMessageInPlace(event.message, this._replaceAssistantMessageText(event.message, strippedText));
			}
		}

		const hideContextOverflowMessage =
			event.type === "message_end" &&
			event.message.role === "assistant" &&
			this._shouldHideContextOverflowMessage(event.message as AssistantMessage);

		// Notify all listeners
		if (!hideContextOverflowMessage && !isInternalRepairEvent) {
			this._emit(
				event.type === "agent_end"
					? {
							...event,
							messages: event.messages.filter((message) => !isInternalCompletionProtocolRepairMessage(message)),
							willRetry: this._willRetryAfterAgentEnd(event),
						}
					: event,
			);
		}

		// Handle session persistence
		if (event.type === "message_end") {
			let persistedEntryId: string | undefined;
			// Check if this is a custom message from extensions
			if (hideContextOverflowMessage) {
				// Context overflow errors are an internal recovery signal. Persisting
				// them leaks invalid assistant error messages back into compacted retry
				// context and can make providers reject the recovered request.
			} else if (event.message.role === "custom") {
				// Persist as CustomMessageEntry
				persistedEntryId = this.sessionManager.appendCustomMessageEntry(
					event.message.customType,
					event.message.content,
					event.message.display,
					event.message.details,
				);
			} else {
				const messageForHistory = filterSleepToolUseForHistory(event.message);
				if (
					messageForHistory &&
					(messageForHistory.role === "user" ||
						messageForHistory.role === "assistant" ||
						messageForHistory.role === "toolResult")
				) {
					// Regular LLM message - persist as SessionMessageEntry
					persistedEntryId = this.sessionManager.appendMessage(messageForHistory);
				}
			}
			// Other message types (bashExecution, compactionSummary, branchSummary) are persisted elsewhere

			// Track assistant message for auto-compaction (checked on agent_end)
			if (event.message.role === "user" && !isInternalCompletionProtocolRepairMessage(event.message)) {
				this._stateUpdateRequiredForCurrentUserTurn =
					this.getActiveToolNames().includes(UPDATE_SESSION_STATE_TOOL_NAME);
				this._progressUpdateRequiredBeforeFinish = false;
			} else if (event.message.role === "assistant") {
				this._lastAssistantMessage = event.message;
				if (assistantStateUpdateText && persistedEntryId) {
					this._applyAssistantSessionStateUpdate(assistantStateUpdateText, persistedEntryId);
				}

				const assistantMsg = event.message as AssistantMessage;
				if (assistantMsg.stopReason !== "error") {
					this._overflowRecoveryAttempts = 0;
				}

				// Reset retry counter immediately on successful assistant response
				// This prevents accumulation across multiple LLM calls within a turn
				if (assistantMsg.stopReason !== "error" && this._retryAttempt > 0) {
					this._emit({
						type: "auto_retry_end",
						success: true,
						attempt: this._retryAttempt,
					});
					this._retryAttempt = 0;
				}
			}
		}
	};

	private _willRetryAfterAgentEnd(event: Extract<AgentEvent, { type: "agent_end" }>): boolean {
		const settings = this.settingsManager.getRetrySettings();
		if (!settings.enabled) {
			return false;
		}

		for (let i = event.messages.length - 1; i >= 0; i--) {
			const message = event.messages[i];
			if (message.role === "assistant") {
				return this.willRetryMessage(message as AssistantMessage);
			}
		}
		return false;
	}

	private _isContextOverflowForCurrentModel(message: AssistantMessage): boolean {
		if (!this.model) return false;
		const sameModel = message.provider === this.model.provider && message.model === this.model.id;
		return sameModel && isContextOverflow(message, this.model.contextWindow ?? 0);
	}

	private _removeContextOverflowMessages(messages: AgentMessage[]): AgentMessage[] {
		return messages.filter((message) => {
			return message.role !== "assistant" || !this._isContextOverflowForCurrentModel(message as AssistantMessage);
		});
	}

	private _shouldHideContextOverflowMessage(message: AssistantMessage): boolean {
		return this._getEffectiveCompactionSettings().enabled && this._isContextOverflowForCurrentModel(message);
	}

	/** Extract text content from a message */
	private _getUserMessageText(message: Message): string {
		if (message.role !== "user") return "";
		const content = message.content;
		if (typeof content === "string") return content;
		const textBlocks = content.filter((c) => c.type === "text");
		return textBlocks.map((c) => (c as TextContent).text).join("");
	}

	/** Find the last assistant message in agent state (including aborted ones) */
	private _findLastAssistantMessage(): AssistantMessage | undefined {
		const messages = this.agent.state.messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "assistant") {
				return msg as AssistantMessage;
			}
		}
		return undefined;
	}

	private _replaceMessageInPlace(target: AgentMessage, replacement: AgentMessage): void {
		// Agent-core stores the finalized message object in its state before emitting message_end.
		// SessionManager persistence happens later in _handleAgentEvent() with event.message.
		// Mutating this object in place keeps agent state, later turn/agent events, listeners,
		// and the eventual SessionManager.appendMessage(event.message) persistence in sync.
		if (target === replacement) {
			return;
		}

		const targetRecord = target as unknown as Record<string, unknown>;
		for (const key of Object.keys(targetRecord)) {
			delete targetRecord[key];
		}
		Object.assign(targetRecord, replacement);
	}

	private _getAssistantMessageText(message: AssistantMessage): string {
		return message.content
			.filter((block): block is TextContent => block.type === "text")
			.map((block) => block.text)
			.join("\n");
	}

	private _replaceAssistantMessageText(message: AssistantMessage, text: string): AssistantMessage {
		let replacedFirstTextBlock = false;
		const content = message.content
			.map((block) => {
				if (block.type !== "text") {
					return block;
				}
				if (!replacedFirstTextBlock) {
					replacedFirstTextBlock = true;
					return { ...block, text };
				}
				return { ...block, text: "" };
			})
			.filter((block) => block.type !== "text" || block.text.length > 0);
		return {
			...message,
			content: replacedFirstTextBlock ? content : message.content,
		};
	}

	private _applyAssistantSessionStateUpdate(rawAssistantText: string, sourceEntryId: string): void {
		const parsed = parseSessionStateUpdateBlock(rawAssistantText, [sourceEntryId]);
		if (!parsed.patch) {
			return;
		}
		const branchEntries = this.sessionManager.getBranch();
		const previous = this._getCurrentStructuredSessionState(branchEntries);
		const state = mergeStructuredSessionState(previous, parsed.patch);
		this.sessionManager.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, state);
		writeSessionStateFile(this._cwd, state);
	}

	/** Emit extension events based on agent events */
	private async _emitExtensionEvent(event: AgentEvent): Promise<void> {
		if (event.type === "agent_start") {
			this._turnIndex = 0;
			await this._extensionRunner.emit({ type: "agent_start" });
		} else if (event.type === "agent_end") {
			await this._extensionRunner.emit({
				type: "agent_end",
				messages: event.messages.filter((message) => !isInternalCompletionProtocolRepairMessage(message)),
			});
		} else if (event.type === "turn_start") {
			const extensionEvent: TurnStartEvent = {
				type: "turn_start",
				turnIndex: this._turnIndex,
				timestamp: Date.now(),
			};
			await this._extensionRunner.emit(extensionEvent);
		} else if (event.type === "turn_end") {
			const extensionEvent: TurnEndEvent = {
				type: "turn_end",
				turnIndex: this._turnIndex,
				message: event.message,
				toolResults: event.toolResults,
			};
			await this._extensionRunner.emit(extensionEvent);
			this._turnIndex++;
		} else if (event.type === "message_start") {
			const extensionEvent: MessageStartEvent = {
				type: "message_start",
				message: event.message,
			};
			await this._extensionRunner.emit(extensionEvent);
		} else if (event.type === "message_update") {
			const extensionEvent: MessageUpdateEvent = {
				type: "message_update",
				message: event.message,
				assistantMessageEvent: event.assistantMessageEvent,
			};
			await this._extensionRunner.emit(extensionEvent);
		} else if (event.type === "message_end") {
			const extensionEvent: MessageEndEvent = {
				type: "message_end",
				message: event.message,
			};
			const replacement = await this._extensionRunner.emitMessageEnd(extensionEvent);
			if (replacement) {
				this._replaceMessageInPlace(event.message, replacement);
			}
		} else if (event.type === "tool_execution_start") {
			const extensionEvent: ToolExecutionStartEvent = {
				type: "tool_execution_start",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
			};
			await this._extensionRunner.emit(extensionEvent);
		} else if (event.type === "tool_execution_update") {
			const extensionEvent: ToolExecutionUpdateEvent = {
				type: "tool_execution_update",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				partialResult: event.partialResult,
			};
			await this._extensionRunner.emit(extensionEvent);
		} else if (event.type === "tool_execution_end") {
			const extensionEvent: ToolExecutionEndEvent = {
				type: "tool_execution_end",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				result: event.result,
				isError: event.isError,
			};
			await this._extensionRunner.emit(extensionEvent);
		}
	}

	/**
	 * Subscribe to agent events.
	 * Session persistence is handled internally (saves messages on message_end).
	 * Multiple listeners can be added. Returns unsubscribe function for this listener.
	 */
	subscribe(listener: AgentSessionEventListener): () => void {
		this._eventListeners.push(listener);

		// Return unsubscribe function for this specific listener
		return () => {
			const index = this._eventListeners.indexOf(listener);
			if (index !== -1) {
				this._eventListeners.splice(index, 1);
			}
		};
	}

	/**
	 * Temporarily disconnect from agent events.
	 * User listeners are preserved and will receive events again after resubscribe().
	 * Used internally during operations that need to pause event processing.
	 */
	private _disconnectFromAgent(): void {
		if (this._unsubscribeAgent) {
			this._unsubscribeAgent();
			this._unsubscribeAgent = undefined;
		}
	}

	/**
	 * Reconnect to agent events after _disconnectFromAgent().
	 * Preserves all existing listeners.
	 */
	private _reconnectToAgent(): void {
		if (this._unsubscribeAgent) return; // Already connected
		this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
	}

	/**
	 * Remove all listeners and disconnect from agent.
	 * Call this when completely done with the session.
	 */
	dispose(): void {
		try {
			this.abortRetry();
			this.abortCompaction();
			this.abortBranchSummary();
			this.abortBash();
			this.agent.abort();
		} catch {
			// Dispose must succeed even if an abort hook throws.
		}

		this._extensionRunner.invalidate(
			"This extension ctx is stale after session replacement or reload. Do not use a captured p or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().",
		);
		this._disconnectFromAgent();
		this._eventListeners = [];
		cleanupSessionResources(this.sessionId);
	}

	// =========================================================================
	// Read-only State Access
	// =========================================================================

	/** Full agent state */
	get state(): AgentState {
		return this.agent.state;
	}

	/** Current model (may be undefined if not yet selected) */
	get model(): Model<any> | undefined {
		return this.agent.state.model;
	}

	/** Current thinking level */
	get thinkingLevel(): ThinkingLevel {
		return this.agent.state.thinkingLevel;
	}

	/** Whether agent is currently streaming a response */
	get isStreaming(): boolean {
		return this.agent.state.isStreaming;
	}

	/** Current effective system prompt (includes any per-turn extension modifications) */
	get systemPrompt(): string {
		return this.agent.state.systemPrompt;
	}

	/** Current user-selected interaction mode. */
	get interactionMode(): InteractionMode {
		return this._interactionMode;
	}

	/** Whether plan mode is currently active. */
	get isPlanMode(): boolean {
		return this._interactionMode === "plan";
	}

	getLastTokenBreakdown(): TokenBreakdown | undefined {
		return this._lastTokenBreakdown;
	}

	/** Current retry attempt (0 if not retrying) */
	get retryAttempt(): number {
		return this._retryAttempt;
	}

	willRetryMessage(message: AssistantMessage): boolean {
		const settings = this.settingsManager.getRetrySettings();
		if (!settings.enabled) {
			return false;
		}
		const maxRetries = this._getEffectiveRetryMaxAttempts(message, settings.maxRetries);
		return this._retryAttempt < maxRetries && this._isRetryableError(message);
	}

	/**
	 * Get the names of currently active tools.
	 * Returns the names of tools currently set on the agent.
	 */
	getActiveToolNames(): string[] {
		return this.agent.state.tools.map((t) => t.name);
	}

	/**
	 * Get all configured tools with name, description, parameter schema, prompt guidelines, and source metadata.
	 */
	getAllTools(): ToolInfo[] {
		return Array.from(this._toolDefinitions.values()).map(({ definition, sourceInfo }) => ({
			name: definition.name,
			description: definition.description,
			parameters: definition.parameters,
			promptGuidelines: definition.promptGuidelines,
			sourceInfo,
		}));
	}

	getToolDefinition(name: string): ToolDefinition | undefined {
		return this._toolDefinitions.get(name)?.definition;
	}

	/**
	 * Set active tools by name.
	 * Only tools in the registry can be enabled. Unknown tool names are ignored.
	 * Also rebuilds the system prompt to reflect the new tool set.
	 * Changes take effect on the next agent turn.
	 */
	setActiveToolsByName(toolNames: string[]): void {
		const tools: AgentTool[] = [];
		const validToolNames: string[] = [];
		for (const name of toolNames) {
			const tool = this._toolRegistry.get(name);
			if (tool) {
				tools.push(tool);
				validToolNames.push(name);
			}
		}
		this.agent.state.tools = tools;

		// Rebuild base system prompt with new tool set
		const effectiveCompletionMode = this._getEffectiveCompletionModeForActiveTools(validToolNames.length);
		this.agent.completionMode = effectiveCompletionMode;
		this._baseSystemPrompt = this._rebuildSystemPrompt(validToolNames, effectiveCompletionMode);
		this.agent.state.systemPrompt = this._baseSystemPrompt;
	}

	enablePlanMode(): { enabled: boolean; missingTools: string[] } {
		const planTools = ["ask_user", "confirm_user", "submit_plan"];
		const missingTools = planTools.filter((toolName) => !this._toolRegistry.has(toolName));
		if (missingTools.includes("submit_plan")) {
			return { enabled: false, missingTools };
		}

		if (this._interactionMode !== "plan") {
			this._planModePreviousActiveToolNames = this.getActiveToolNames();
		}

		this._interactionMode = "plan";
		const activeTools = new Set(this.getActiveToolNames());
		for (const toolName of planTools) {
			if (this._toolRegistry.has(toolName)) {
				activeTools.add(toolName);
			}
		}
		this.setActiveToolsByName([...activeTools]);
		this._emit({ type: "interaction_mode_changed", mode: this._interactionMode });
		return { enabled: true, missingTools };
	}

	disablePlanMode(): void {
		if (this._interactionMode !== "plan") {
			return;
		}

		const restoredToolNames =
			this._planModePreviousActiveToolNames ??
			this.getActiveToolNames().filter((toolName) => toolName !== "submit_plan");
		this._planModePreviousActiveToolNames = undefined;
		this._interactionMode = "normal";
		this.setActiveToolsByName(restoredToolNames);
		this._emit({ type: "interaction_mode_changed", mode: this._interactionMode });
	}

	/** Whether compaction or branch summarization is currently running */
	get isCompacting(): boolean {
		return (
			this._autoCompactionAbortController !== undefined ||
			this._compactionAbortController !== undefined ||
			this._branchSummaryAbortController !== undefined
		);
	}

	/** All messages including custom types like BashExecutionMessage */
	get messages(): AgentMessage[] {
		return this.agent.state.messages
			.filter((message) => !isInternalCompletionProtocolRepairMessage(message))
			.map(filterSleepToolUseForHistory)
			.filter((message): message is AgentMessage => message !== undefined);
	}

	/** Current steering mode */
	get steeringMode(): "all" | "one-at-a-time" {
		return this.agent.steeringMode;
	}

	/** Current follow-up mode */
	get followUpMode(): "all" | "one-at-a-time" {
		return this.agent.followUpMode;
	}

	/** Current session file path, or undefined if sessions are disabled */
	get sessionFile(): string | undefined {
		return this.sessionManager.getSessionFile();
	}

	/** Current session ID */
	get sessionId(): string {
		return this.sessionManager.getSessionId();
	}

	/** Current session display name, if set */
	get sessionName(): string | undefined {
		return this.sessionManager.getSessionName();
	}

	/** Scoped models for cycling (from --models flag) */
	get scopedModels(): ReadonlyArray<{
		model: Model<any>;
		thinkingLevel?: ThinkingLevel;
	}> {
		return this._scopedModels;
	}

	/** Update scoped models for cycling */
	setScopedModels(scopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>): void {
		this._scopedModels = scopedModels;
	}

	/** File-based prompt templates */
	get promptTemplates(): ReadonlyArray<PromptTemplate> {
		return this._resourceLoader.getPrompts().prompts;
	}

	private _normalizePromptSnippet(text: string | undefined): string | undefined {
		if (!text) return undefined;
		const oneLine = text
			.replace(/[\r\n]+/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		return oneLine.length > 0 ? oneLine : undefined;
	}

	private _normalizePromptGuidelines(guidelines: string[] | undefined): string[] {
		if (!guidelines || guidelines.length === 0) {
			return [];
		}

		const unique = new Set<string>();
		for (const guideline of guidelines) {
			const normalized = guideline.trim();
			if (normalized.length > 0) {
				unique.add(normalized);
			}
		}
		return Array.from(unique);
	}

	private _getEffectiveCompletionModeForActiveTools(activeToolCount: number): CompletionMode {
		return activeToolCount === 0 && this._completionMode !== "implicit" ? "implicit" : this._completionMode;
	}

	private _getInteractionModeSystemPrompt(): string | undefined {
		if (this._interactionMode !== "plan") {
			return undefined;
		}
		return `<plan_mode>
Plan mode is active because the user invoked /plan.
- Gather enough context to propose a concrete plan. Read files or run read-only inspection commands when needed.
- Ask targeted questions with ask_user only when user input would materially improve the plan.
- Do not edit files, write files, run implementation commands, or otherwise start execution while plan mode is active.
- When the plan is ready, call submit_plan with a concise summary, ordered steps, risks, and any open questions.
- Plan mode remains active if the user rejects the plan. Revise the plan or ask a follow-up question, then call submit_plan again.
- After submit_plan reports user approval, plan mode is off. Proceed with the approved plan without asking for the same approval again.
</plan_mode>`;
	}

	private _rebuildSystemPrompt(
		toolNames: string[],
		completionMode = this._getEffectiveCompletionModeForActiveTools(toolNames.length),
	): string {
		const validToolNames = toolNames.filter((name) => this._toolRegistry.has(name));
		const promptToolNames =
			completionMode === "implicit"
				? validToolNames
				: [...validToolNames.filter((name) => name !== FINISH_WORK_TOOL_NAME), FINISH_WORK_TOOL_NAME];
		const toolSnippets: Record<string, string> = {};
		const promptGuidelines: string[] = [];
		for (const name of validToolNames) {
			const snippet = this._toolPromptSnippets.get(name);
			if (snippet) {
				toolSnippets[name] = snippet;
			}

			const toolGuidelines = this._toolPromptGuidelines.get(name);
			if (toolGuidelines) {
				promptGuidelines.push(...toolGuidelines);
			}
		}
		if (completionMode !== "implicit") {
			toolSnippets[FINISH_WORK_TOOL_NAME] =
				"finish_work({ status, summary, result?, files_changed?, tests_run?, remaining_work?, notes? }): explicitly terminate the task with the final status and user-visible result";
		}

		const loaderSystemPrompt = this._resourceLoader.getSystemPrompt();
		const loaderAppendSystemPrompt = this._resourceLoader.getAppendSystemPrompt();
		const interactionModeSystemPrompt = this._getInteractionModeSystemPrompt();
		const appendSystemPrompt = [...loaderAppendSystemPrompt, interactionModeSystemPrompt]
			.filter((text): text is string => text !== undefined && text.trim().length > 0)
			.join("\n\n");
		const loadedSkills = this._resourceLoader.getSkills().skills;
		const loadedContextFiles = this._resourceLoader.getAgentsFiles().agentsFiles;

		this._baseSystemPromptOptions = {
			cwd: this._cwd,
			skills: loadedSkills,
			contextFiles: loadedContextFiles,
			customPrompt: loaderSystemPrompt,
			appendSystemPrompt: appendSystemPrompt || undefined,
			selectedTools: promptToolNames,
			toolSnippets,
			promptGuidelines,
			completionMode,
		};
		return buildSystemPrompt(this._baseSystemPromptOptions);
	}

	// =========================================================================
	// Prompting
	// =========================================================================

	private async _runAgentPrompt(messages: AgentMessage | AgentMessage[]): Promise<void> {
		try {
			await this.agent.prompt(messages);
			while (await this._handlePostAgentRun()) {
				await this.agent.continue();
			}
		} finally {
			this._flushPendingBashMessages();
			this._syncProjectMemory();
		}
	}

	private async _handlePostAgentRun(): Promise<boolean> {
		const msg = this._lastAssistantMessage;
		this._lastAssistantMessage = undefined;
		if (!msg) {
			return false;
		}

		if (this._isRetryableError(msg) && (await this._prepareRetry(msg))) {
			return true;
		}

		if (msg.stopReason === "error" && this._retryAttempt > 0) {
			this._emit({
				type: "auto_retry_end",
				success: false,
				attempt: this._retryAttempt,
				finalError: msg.errorMessage,
			});
			this._retryAttempt = 0;
		}

		if (await this.checkCompaction(msg)) {
			return true;
		}

		// The agent loop drains both queues before emitting agent_end. Any messages
		// here were queued by agent_end extension handlers and need a continuation.
		return this.agent.hasQueuedMessages();
	}

	/**
	 * Send a prompt to the agent.
	 * - Handles extension commands (registered via p.registerCommand) immediately, even during streaming
	 * - Expands file-based prompt templates by default
	 * - During streaming, queues via steer() or followUp() based on streamingBehavior option
	 * - Validates model and API key before sending (when not streaming)
	 * @throws Error if streaming and no streamingBehavior specified
	 * @throws Error if no model selected or no API key available (when not streaming)
	 */
	async prompt(text: string, options?: PromptOptions): Promise<void> {
		const expandPromptTemplates = options?.expandPromptTemplates ?? true;
		const preflightResult = options?.preflightResult;
		let messages: AgentMessage[] | undefined;

		try {
			// Handle extension commands first (execute immediately, even during streaming)
			// Extension commands manage their own LLM interaction via p.sendMessage()
			if (expandPromptTemplates && text.startsWith("/")) {
				const handled = await this._tryExecuteExtensionCommand(text);
				if (handled) {
					// Extension command executed, no prompt to send
					preflightResult?.(true);
					return;
				}
			}

			// Emit input event for extension interception (before skill/template expansion)
			let currentText = text;
			let currentImages = options?.images;
			if (this._extensionRunner.hasHandlers("input")) {
				const inputResult = await this._extensionRunner.emitInput(
					currentText,
					currentImages,
					options?.source ?? "interactive",
					this.isStreaming ? options?.streamingBehavior : undefined,
				);
				if (inputResult.action === "handled") {
					preflightResult?.(true);
					return;
				}
				if (inputResult.action === "transform") {
					currentText = inputResult.text;
					currentImages = inputResult.images ?? currentImages;
				}
			}

			// Expand skill commands (/skill:name args) and prompt templates (/template args)
			let expandedText = currentText;
			if (expandPromptTemplates) {
				expandedText = this._expandSkillCommand(expandedText);
				expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
			}

			// If streaming, queue via steer() or followUp() based on option
			if (this.isStreaming) {
				if (!options?.streamingBehavior) {
					throw new Error(
						"Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
					);
				}
				if (options.streamingBehavior === "followUp") {
					await this._queueFollowUp(expandedText, currentImages);
				} else {
					await this._queueSteer(expandedText, currentImages);
				}
				preflightResult?.(true);
				return;
			}

			// Flush any pending bash messages before the new prompt
			this._flushPendingBashMessages();

			// Validate model
			if (!this.model) {
				throw new Error(formatNoModelSelectedMessage());
			}

			if (!this._modelRegistry.hasConfiguredAuth(this.model)) {
				const isOAuth = this._modelRegistry.isUsingOAuth(this.model);
				if (isOAuth) {
					throw new Error(
						`Authentication failed for "${this.model.provider}". ` +
							`Credentials may have expired or network is unavailable. ` +
							`Run '/login ${this.model.provider}' to re-authenticate.`,
					);
				}
				throw new Error(formatNoApiKeyFoundMessage(this.model.provider));
			}

			// Build messages array (custom message if any, then user message)
			messages = [];

			// Add user message
			const userContent: (TextContent | ImageContent)[] = [{ type: "text", text: expandedText }];
			if (currentImages) {
				userContent.push(...currentImages);
			}
			messages.push({
				role: "user",
				content: userContent,
				timestamp: Date.now(),
			});

			// Inject any pending "nextTurn" messages as context alongside the user message
			for (const msg of this._pendingNextTurnMessages) {
				messages.push(msg);
			}
			this._pendingNextTurnMessages = [];

			// Emit before_agent_start extension event
			const result = await this._extensionRunner.emitBeforeAgentStart(
				expandedText,
				currentImages,
				this._baseSystemPrompt,
				this._baseSystemPromptOptions,
			);
			// Add all custom messages from extensions
			if (result?.messages) {
				for (const msg of result.messages) {
					messages.push({
						role: "custom",
						customType: msg.customType,
						content: msg.content,
						display: msg.display,
						details: msg.details,
						timestamp: Date.now(),
					});
				}
			}
			const effectiveSystemPrompt = result?.systemPrompt ?? this._baseSystemPrompt;
			const runtimePrompts = this._createRuntimeContextPrompts(expandedText, effectiveSystemPrompt, messages);
			this._lastRuntimePromptComponents = runtimePrompts;
			this.agent.state.systemPrompt = runtimePrompts.combinedPrompt
				? `${effectiveSystemPrompt}\n\n${runtimePrompts.combinedPrompt}`
				: effectiveSystemPrompt;
			if (runtimePrompts.turnContextPrompt) {
				messages.push(this._createRuntimeContextPromptMessage(runtimePrompts.turnContextPrompt, Date.now()));
			}
			if (runtimePrompts.workingStatePrompt) {
				messages.push(this._createWorkingStatePromptMessage(runtimePrompts.workingStatePrompt, Date.now()));
			}
			this._lastTokenBreakdown = this._createTokenBreakdownForPrompt(messages);

			// Check if we need to compact before sending (catches aborted responses and preempts overflow with new messages)
			const lastAssistant = this._findLastAssistantMessage();
			if (await this.checkCompaction(lastAssistant, false, messages)) {
				try {
					await this.agent.continue();
					while (await this._handlePostAgentRun()) {
						await this.agent.continue();
					}
				} finally {
					this._flushPendingBashMessages();
				}
			}

			const fastResponderMessage = await this._createFastResponderMessage(expandedText, messages);
			if (fastResponderMessage) {
				const firstUserIndex = messages.findIndex((message) => message.role === "user");
				messages.splice(firstUserIndex === -1 ? 0 : firstUserIndex + 1, 0, fastResponderMessage);
			}
		} catch (error) {
			preflightResult?.(false);
			throw error;
		}

		if (!messages) {
			return;
		}

		preflightResult?.(true);
		await this._runAgentPrompt(messages);
	}

	/**
	 * Try to execute an extension command. Returns true if command was found and executed.
	 */
	private async _tryExecuteExtensionCommand(text: string): Promise<boolean> {
		// Parse command name and args
		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

		const command = this._extensionRunner.getCommand(commandName);
		if (!command) return false;

		// Get command context from extension runner (includes session control methods)
		const ctx = this._extensionRunner.createCommandContext();

		try {
			await command.handler(args, ctx);
			return true;
		} catch (err) {
			// Emit error via extension runner
			this._extensionRunner.emitError({
				extensionPath: `command:${commandName}`,
				event: "command",
				error: err instanceof Error ? err.message : String(err),
			});
			return true;
		}
	}

	/**
	 * Expand skill commands (/skill:name args) to their full content.
	 * Returns the expanded text, or the original text if not a skill command or skill not found.
	 * Emits errors via extension runner if file read fails.
	 */
	private _expandSkillCommand(text: string): string {
		if (!text.startsWith("/skill:")) return text;

		const spaceIndex = text.indexOf(" ");
		const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

		const skill = this.resourceLoader.getSkills().skills.find((s) => s.name === skillName);
		if (!skill) return text; // Unknown skill, pass through

		try {
			const content = readFileSync(skill.filePath, "utf-8");
			const body = stripFrontmatter(content).trim();
			const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
			return args ? `${skillBlock}\n\n${args}` : skillBlock;
		} catch (err) {
			// Emit error like extension commands do
			this._extensionRunner.emitError({
				extensionPath: skill.filePath,
				event: "skill_expansion",
				error: err instanceof Error ? err.message : String(err),
			});
			return text; // Return original on error
		}
	}

	/**
	 * Queue a steering message while the agent is running.
	 * Delivered after the current assistant turn finishes executing its tool calls,
	 * before the next LLM call.
	 * Expands skill commands and prompt templates. Errors on extension commands.
	 * @param images Optional image attachments to include with the message
	 * @throws Error if text is an extension command
	 */
	async steer(text: string, images?: ImageContent[]): Promise<void> {
		// Check for extension commands (cannot be queued)
		if (text.startsWith("/")) {
			this._throwIfExtensionCommand(text);
		}

		// Expand skill commands and prompt templates
		let expandedText = this._expandSkillCommand(text);
		expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);

		await this._queueSteer(expandedText, images);
	}

	/**
	 * Queue a follow-up message to be processed after the agent finishes.
	 * Delivered only when agent has no more tool calls or steering messages.
	 * Expands skill commands and prompt templates. Errors on extension commands.
	 * @param images Optional image attachments to include with the message
	 * @throws Error if text is an extension command
	 */
	async followUp(text: string, images?: ImageContent[]): Promise<void> {
		// Check for extension commands (cannot be queued)
		if (text.startsWith("/")) {
			this._throwIfExtensionCommand(text);
		}

		// Expand skill commands and prompt templates
		let expandedText = this._expandSkillCommand(text);
		expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);

		await this._queueFollowUp(expandedText, images);
	}

	/**
	 * Internal: Queue a steering message (already expanded, no extension command check).
	 */
	private async _queueSteer(text: string, images?: ImageContent[]): Promise<void> {
		this._steeringMessages.push(text);
		this._emitQueueUpdate();
		const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
		if (images) {
			content.push(...images);
		}
		this.agent.steer({
			role: "user",
			content,
			timestamp: Date.now(),
		});
	}

	/**
	 * Internal: Queue a follow-up message (already expanded, no extension command check).
	 */
	private async _queueFollowUp(text: string, images?: ImageContent[]): Promise<void> {
		this._followUpMessages.push(text);
		this._emitQueueUpdate();
		const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
		if (images) {
			content.push(...images);
		}
		this.agent.followUp({
			role: "user",
			content,
			timestamp: Date.now(),
		});
	}

	/**
	 * Throw an error if the text is an extension command.
	 */
	private _throwIfExtensionCommand(text: string): void {
		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		const command = this._extensionRunner.getCommand(commandName);

		if (command) {
			throw new Error(
				`Extension command "/${commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`,
			);
		}
	}

	/**
	 * Send a custom message to the session. Creates a CustomMessageEntry.
	 *
	 * Handles three cases:
	 * - Streaming: queues message, processed when loop pulls from queue
	 * - Not streaming + triggerTurn: appends to state/session, starts new turn
	 * - Not streaming + no trigger: appends to state/session, no turn
	 *
	 * @param message Custom message with customType, content, display, details
	 * @param options.triggerTurn If true and not streaming, triggers a new LLM turn
	 * @param options.deliverAs Delivery mode: "steer", "followUp", or "nextTurn"
	 */
	async sendCustomMessage<T = unknown>(
		message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
		options?: {
			triggerTurn?: boolean;
			deliverAs?: "steer" | "followUp" | "nextTurn";
		},
	): Promise<void> {
		const appMessage = {
			role: "custom" as const,
			customType: message.customType,
			content: message.content,
			display: message.display,
			details: message.details,
			timestamp: Date.now(),
		} satisfies CustomMessage<T>;
		if (options?.deliverAs === "nextTurn") {
			this._pendingNextTurnMessages.push(appMessage);
		} else if (this.isStreaming) {
			if (options?.deliverAs === "followUp") {
				this.agent.followUp(appMessage);
			} else {
				this.agent.steer(appMessage);
			}
		} else if (options?.triggerTurn) {
			await this._runAgentPrompt(appMessage);
		} else {
			this.agent.state.messages.push(appMessage);
			this.sessionManager.appendCustomMessageEntry(
				message.customType,
				message.content,
				message.display,
				message.details,
			);
			this._emit({ type: "message_start", message: appMessage });
			this._emit({ type: "message_end", message: appMessage });
		}
	}

	/**
	 * Send a user message to the agent. Always triggers a turn.
	 * When the agent is streaming, use deliverAs to specify how to queue the message.
	 *
	 * @param content User message content (string or content array)
	 * @param options.deliverAs Delivery mode when streaming: "steer" or "followUp"
	 */
	async sendUserMessage(
		content: string | (TextContent | ImageContent)[],
		options?: { deliverAs?: "steer" | "followUp" },
	): Promise<void> {
		// Normalize content to text string + optional images
		let text: string;
		let images: ImageContent[] | undefined;

		if (typeof content === "string") {
			text = content;
		} else {
			const textParts: string[] = [];
			images = [];
			for (const part of content) {
				if (part.type === "text") {
					textParts.push(part.text);
				} else {
					images.push(part);
				}
			}
			text = textParts.join("\n");
			if (images.length === 0) images = undefined;
		}

		// Use prompt() with expandPromptTemplates: false to skip command handling and template expansion
		await this.prompt(text, {
			expandPromptTemplates: false,
			streamingBehavior: options?.deliverAs,
			images,
			source: "extension",
		});
	}

	/**
	 * Clear all queued messages and return them.
	 * Useful for restoring to editor when user aborts.
	 * @returns Object with steering and followUp arrays
	 */
	clearQueue(): { steering: string[]; followUp: string[] } {
		const steering = [...this._steeringMessages];
		const followUp = [...this._followUpMessages];
		this._steeringMessages = [];
		this._followUpMessages = [];
		this.agent.clearAllQueues();
		this._emitQueueUpdate();
		return { steering, followUp };
	}

	/** Number of pending messages (includes both steering and follow-up) */
	get pendingMessageCount(): number {
		return this._steeringMessages.length + this._followUpMessages.length;
	}

	/** Get pending steering messages (read-only) */
	getSteeringMessages(): readonly string[] {
		return this._steeringMessages;
	}

	/** Get pending follow-up messages (read-only) */
	getFollowUpMessages(): readonly string[] {
		return this._followUpMessages;
	}

	get resourceLoader(): ResourceLoader {
		return this._resourceLoader;
	}

	/**
	 * Abort current operation and wait for agent to become idle.
	 */
	async abort(): Promise<void> {
		this.abortRetry();
		this.agent.abort();
		await this.agent.waitForIdle();
	}

	// =========================================================================
	// Model Management
	// =========================================================================

	private async _emitModelSelect(
		nextModel: Model<any>,
		previousModel: Model<any> | undefined,
		source: "set" | "cycle" | "restore",
	): Promise<void> {
		if (modelsAreEqual(previousModel, nextModel)) return;
		await this._extensionRunner.emit({
			type: "model_select",
			model: nextModel,
			previousModel,
			source,
		});
	}

	/**
	 * Set model directly.
	 * Validates that auth is configured, saves to session and settings.
	 * @throws Error if no auth is configured for the model
	 */
	async setModel(model: Model<any>): Promise<void> {
		if (modelsAreEqual(this.model, model)) {
			return;
		}

		if (!this._modelRegistry.hasConfiguredAuth(model)) {
			throw new Error(`No API key for ${model.provider}/${model.id}`);
		}

		const previousModel = this.model;
		const thinkingLevel = this._getThinkingLevelForModelSwitch();
		this.agent.state.model = model;
		this.sessionManager.appendModelChange(model.provider, model.id);
		this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);

		// Re-clamp thinking level for new model's capabilities
		this.setThinkingLevel(thinkingLevel);

		await this._emitModelSelect(model, previousModel, "set");
	}

	/**
	 * Cycle to next/previous model.
	 * Uses scoped models (from --models flag) if available, otherwise all available models.
	 * @param direction - "forward" (default) or "backward"
	 * @returns The new model info, or undefined if only one model available
	 */
	async cycleModel(direction: "forward" | "backward" = "forward"): Promise<ModelCycleResult | undefined> {
		if (this._scopedModels.length > 0) {
			return this._cycleScopedModel(direction);
		}
		return this._cycleAvailableModel(direction);
	}

	private async _cycleScopedModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const scopedModels = this._scopedModels.filter((scoped) => this._modelRegistry.hasConfiguredAuth(scoped.model));
		if (scopedModels.length <= 1) return undefined;

		const currentModel = this.model;
		let currentIndex = scopedModels.findIndex((sm) => modelsAreEqual(sm.model, currentModel));

		if (currentIndex === -1) currentIndex = 0;
		const len = scopedModels.length;
		const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
		const next = scopedModels[nextIndex];
		const thinkingLevel = this._getThinkingLevelForModelSwitch(next.thinkingLevel);

		// Apply model
		this.agent.state.model = next.model;
		this.sessionManager.appendModelChange(next.model.provider, next.model.id);
		this.settingsManager.setDefaultModelAndProvider(next.model.provider, next.model.id);

		// Apply thinking level.
		// - Explicit scoped model thinking level overrides current session level
		// - Undefined scoped model thinking level inherits the current session preference
		// setThinkingLevel clamps to model capabilities.
		this.setThinkingLevel(thinkingLevel);

		await this._emitModelSelect(next.model, currentModel, "cycle");

		return {
			model: next.model,
			thinkingLevel: this.thinkingLevel,
			isScoped: true,
		};
	}

	private async _cycleAvailableModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const availableModels = await this._modelRegistry.getAvailable();
		if (availableModels.length <= 1) return undefined;

		const currentModel = this.model;
		let currentIndex = availableModels.findIndex((m) => modelsAreEqual(m, currentModel));

		if (currentIndex === -1) currentIndex = 0;
		const len = availableModels.length;
		const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
		const nextModel = availableModels[nextIndex];

		const thinkingLevel = this._getThinkingLevelForModelSwitch();
		this.agent.state.model = nextModel;
		this.sessionManager.appendModelChange(nextModel.provider, nextModel.id);
		this.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);

		// Re-clamp thinking level for new model's capabilities
		this.setThinkingLevel(thinkingLevel);

		await this._emitModelSelect(nextModel, currentModel, "cycle");

		return {
			model: nextModel,
			thinkingLevel: this.thinkingLevel,
			isScoped: false,
		};
	}

	// =========================================================================
	// Thinking Level Management
	// =========================================================================

	/**
	 * Set thinking level.
	 * Clamps to model capabilities based on available thinking levels.
	 * Saves to session and settings only if the level actually changes.
	 */
	setThinkingLevel(level: ThinkingLevel): void {
		const availableLevels = this.getAvailableThinkingLevels();
		const effectiveLevel = availableLevels.includes(level) ? level : this._clampThinkingLevel(level, availableLevels);

		// Only persist if actually changing
		const previousLevel = this.agent.state.thinkingLevel;
		const isChanging = effectiveLevel !== previousLevel;

		this.agent.state.thinkingLevel = effectiveLevel;

		if (isChanging) {
			this.sessionManager.appendThinkingLevelChange(effectiveLevel);
			if (this.supportsThinking() || effectiveLevel !== "off") {
				this.settingsManager.setDefaultThinkingLevel(effectiveLevel);
			}
			this._emit({ type: "thinking_level_changed", level: effectiveLevel });
			void this._extensionRunner.emit({
				type: "thinking_level_select",
				level: effectiveLevel,
				previousLevel,
			});
		}
	}

	/**
	 * Cycle to next thinking level.
	 * @returns New level, or undefined if model doesn't support thinking
	 */
	cycleThinkingLevel(): ThinkingLevel | undefined {
		if (!this.supportsThinking()) return undefined;

		const levels = this.getAvailableThinkingLevels();
		const currentIndex = levels.indexOf(this.thinkingLevel);
		const nextIndex = (currentIndex + 1) % levels.length;
		const nextLevel = levels[nextIndex];

		this.setThinkingLevel(nextLevel);
		return nextLevel;
	}

	/**
	 * Get available thinking levels for current model.
	 * The provider will clamp to what the specific model supports internally.
	 */
	getAvailableThinkingLevels(): ThinkingLevel[] {
		if (!this.model) return THINKING_LEVELS;
		return getSupportedThinkingLevels(this.model) as ThinkingLevel[];
	}

	/**
	 * Check if current model supports thinking/reasoning.
	 */
	supportsThinking(): boolean {
		return !!this.model?.reasoning;
	}

	private _getThinkingLevelForModelSwitch(explicitLevel?: ThinkingLevel): ThinkingLevel {
		if (explicitLevel !== undefined) {
			return explicitLevel;
		}
		if (!this.supportsThinking()) {
			return this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
		}
		return this.thinkingLevel;
	}

	private _clampThinkingLevel(level: ThinkingLevel, _availableLevels: ThinkingLevel[]): ThinkingLevel {
		return this.model ? (clampThinkingLevel(this.model, level) as ThinkingLevel) : "off";
	}

	// =========================================================================
	// Queue Mode Management
	// =========================================================================

	private syncQueueModesFromSettings(): void {
		this.agent.steeringMode = this.settingsManager.getSteeringMode();
		this.agent.followUpMode = this.settingsManager.getFollowUpMode();
	}

	/**
	 * Set steering message mode.
	 * Saves to settings.
	 */
	setSteeringMode(mode: "all" | "one-at-a-time"): void {
		this.agent.steeringMode = mode;
		this.settingsManager.setSteeringMode(mode);
	}

	/**
	 * Set follow-up message mode.
	 * Saves to settings.
	 */
	setFollowUpMode(mode: "all" | "one-at-a-time"): void {
		this.agent.followUpMode = mode;
		this.settingsManager.setFollowUpMode(mode);
	}

	// =========================================================================
	// Compaction
	// =========================================================================

	getSessionStateSnapshot(): SessionStateSnapshot {
		const branchEntries = this.sessionManager.getBranch();
		const state = this._getCurrentStructuredSessionState(branchEntries);
		const settings = this._getEffectiveCompactionSettings();
		const checkpoint = renderStructuredSessionCheckpoint(state, settings.renderedStateMaxTokens);
		const latestCompaction = getLatestCompactionEntry(branchEntries);
		const details = latestCompaction ? normalizeCompactionDetails(latestCompaction.details) : undefined;
		return {
			sessionId: this.sessionManager.getSessionId(),
			checkpoint,
			state,
			contextUsage: this.getContextUsage(),
			lastCompaction: latestCompaction
				? {
						id: latestCompaction.id,
						timestamp: latestCompaction.timestamp,
						audit: details?.audit,
					}
				: undefined,
		};
	}

	private _getCurrentStructuredSessionState(branchEntries = this.sessionManager.getBranch()): StructuredSessionState {
		const previous = getLatestStructuredSessionState(branchEntries);
		const fallbackEntries = this._getLiveStateFallbackEntries(branchEntries);
		if (previous && fallbackEntries.length === 0) {
			return previous;
		}
		return this._createLiveStructuredSessionState(
			fallbackEntries.length > 0 ? fallbackEntries : branchEntries,
			previous,
		);
	}

	private _getLiveStateFallbackEntries(branchEntries: SessionEntry[]): SessionEntry[] {
		for (let index = branchEntries.length - 1; index >= 0; index--) {
			const entry = branchEntries[index];
			if (entry.type === "custom" && entry.customType === STRUCTURED_SESSION_STATE_CUSTOM_TYPE) {
				return branchEntries.slice(index + 1);
			}
		}
		return branchEntries;
	}

	private _createLiveStructuredSessionState(
		branchEntries: SessionEntry[],
		previous?: StructuredSessionState,
	): StructuredSessionState {
		return createLiveStructuredSessionState({
			sessionId: this.sessionManager.getSessionId(),
			previous,
			entries: branchEntries,
			timestamp: new Date().toISOString(),
		});
	}

	private _syncProjectMemory(): void {
		try {
			const snapshot = this.getSessionStateSnapshot();
			updateProjectMemorySnapshot({
				cwd: this._cwd,
				sessionId: snapshot.sessionId,
				checkpoint: snapshot.checkpoint,
				state: snapshot.state,
				contextUsage: snapshot.contextUsage,
			});
		} catch {
			// Project memory is a durability aid; prompt execution must not fail because the workspace is read-only.
		}
	}

	private _createProjectMemoryPrompt(query: string): string | undefined {
		const context = createProjectMemoryContext(this._cwd, query);
		return context?.content;
	}

	private _createRuntimeContextPrompts(
		query: string,
		baseSystemPrompt: string,
		pendingMessages: AgentMessage[] = [],
	): RuntimeContextPrompts {
		const settings = this._getEffectiveCompactionSettings();
		const branchEntries = this.sessionManager.getBranch();
		const previousStructuredState = getLatestStructuredSessionState(branchEntries);
		const structuredState = previousStructuredState
			? this._getCurrentStructuredSessionState(this._withPendingMessageEntries(branchEntries, pendingMessages))
			: undefined;
		const workingStatePrompt =
			structuredState && hasMeaningfulStructuredSessionState(structuredState)
				? renderWorkingSessionState(structuredState, settings.renderedStateMaxTokens)
				: undefined;
		const memoryPrompt = this._createProjectMemoryPrompt(query);
		const rulesPrompt = createRulesContext(this._cwd, query);
		const repoMapPrompt = createRepoMapContext(this._cwd, query)?.content;
		const subagentDigestPrompt = createSubagentDigestContext(this._cwd, query);
		const subagentProfilesPrompt = createSubagentProfilesPrompt();
		// NOTE: volatile per-turn context is NOT included in the system prompt.
		// It is persisted as hidden custom messages next to the user message that
		// selected it, so later turns replay the exact same prefix for KV cache reuse.
		const prompts = [SESSION_STATE_PROTOCOL_PROMPT, subagentProfilesPrompt].filter(
			(prompt): prompt is string => prompt !== undefined && prompt.length > 0,
		);
		const turnContextPrompts = [memoryPrompt, rulesPrompt, repoMapPrompt, subagentDigestPrompt].filter(
			(prompt): prompt is string => prompt !== undefined && prompt.length > 0,
		);
		return {
			baseSystemPrompt,
			stateProtocolPrompt: SESSION_STATE_PROTOCOL_PROMPT,
			workingStatePrompt,
			memoryPrompt,
			rulesPrompt,
			repoMapPrompt,
			subagentProfilesPrompt,
			subagentDigestPrompt,
			combinedPrompt: prompts.length > 0 ? prompts.join("\n\n") : undefined,
			turnContextPrompt: turnContextPrompts.length > 0 ? turnContextPrompts.join("\n\n") : undefined,
		};
	}

	private _withPendingMessageEntries(branchEntries: SessionEntry[], pendingMessages: AgentMessage[]): SessionEntry[] {
		if (pendingMessages.length === 0) {
			return branchEntries;
		}
		const pendingEntries: SessionEntry[] = pendingMessages.map((message, index) => ({
			type: "message",
			id: `pending:${message.timestamp}:${index}`,
			parentId: null,
			timestamp: new Date(message.timestamp).toISOString(),
			message,
		}));
		return [...branchEntries, ...pendingEntries];
	}

	private _createToolPromptAccountingText(): string {
		return this.agent.state.tools
			.map((tool) => {
				const definition = this._toolDefinitions.get(tool.name)?.definition;
				const promptSnippet = this._toolPromptSnippets.get(tool.name);
				return [tool.name, definition?.description, promptSnippet].filter(Boolean).join(": ");
			})
			.join("\n");
	}

	private _installPromptContextTransform(): void {
		const previousTransform = this.agent.transformContext?.bind(this.agent);
		this.agent.transformContext = async (messages: AgentMessage[], signal?: AbortSignal): Promise<AgentMessage[]> => {
			const transformed = previousTransform ? await previousTransform(messages, signal) : messages;
			return this._preparePromptContext(transformed, this.systemPrompt, { recordWorkingState: true }).messages;
		};
	}

	private _createWorkingStatePromptMessage(content: string, timestamp: number): CustomMessage {
		return {
			role: "custom",
			customType: WORKING_STATE_PROMPT_CUSTOM_TYPE,
			content,
			display: false,
			timestamp,
		};
	}

	private _createRuntimeContextPromptMessage(content: string, timestamp: number): CustomMessage {
		return {
			role: "custom",
			customType: RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE,
			content,
			display: false,
			timestamp,
		};
	}

	private _withWorkingStatePromptInsertions(
		messages: AgentMessage[],
		workingStatePrompt: string | undefined,
		options: WorkingStatePromptInsertionOptions = {},
	): AgentMessage[] {
		const validAnchorKeys = new Set<string>();
		const persistedInsertionAnchorKeys = new Set<string>();
		let currentAnchorKey: string | undefined;
		let latestUserAnchorKey: string | undefined;
		for (const message of messages) {
			if (options.minimumAnchorTimestamp !== undefined && message.timestamp < options.minimumAnchorTimestamp) {
				continue;
			}
			const anchorKey = getUserMessageAnchorKey(message);
			if (anchorKey) {
				validAnchorKeys.add(anchorKey);
				latestUserAnchorKey = anchorKey;
				currentAnchorKey = anchorKey;
				continue;
			}
			if (currentAnchorKey && message.role === "custom" && message.customType === WORKING_STATE_PROMPT_CUSTOM_TYPE) {
				persistedInsertionAnchorKeys.add(currentAnchorKey);
			}
		}

		const sourceInsertions = options.recordWorkingState
			? this._workingStatePromptInsertions.filter((insertion) => validAnchorKeys.has(insertion.anchorKey))
			: this._workingStatePromptInsertions;
		if (options.recordWorkingState) {
			this._workingStatePromptInsertions = sourceInsertions;
		}

		const insertionsByAnchor = new Map(
			sourceInsertions.map((insertion) => [insertion.anchorKey, insertion] as const),
		);
		if (
			latestUserAnchorKey &&
			workingStatePrompt &&
			!insertionsByAnchor.has(latestUserAnchorKey) &&
			!persistedInsertionAnchorKeys.has(latestUserAnchorKey)
		) {
			const insertion = {
				anchorKey: latestUserAnchorKey,
				content: workingStatePrompt,
				timestamp: Date.now(),
			};
			insertionsByAnchor.set(latestUserAnchorKey, insertion);
			if (options.recordWorkingState) {
				this._workingStatePromptInsertions.push(insertion);
			}
		}

		if (insertionsByAnchor.size === 0) {
			return messages;
		}

		const withInsertions: AgentMessage[] = [];
		for (const message of messages) {
			withInsertions.push(message);
			const anchorKey = getUserMessageAnchorKey(message);
			const insertion = anchorKey ? insertionsByAnchor.get(anchorKey) : undefined;
			if (insertion) {
				withInsertions.push(this._createWorkingStatePromptMessage(insertion.content, insertion.timestamp));
			}
		}
		return withInsertions;
	}

	private _preparePromptContext(
		messages: AgentMessage[],
		systemPrompt = this.systemPrompt,
		options: { recordWorkingState?: boolean } = {},
	): PromptContextPreparation {
		const settings = this._getEffectiveCompactionSettings();
		const latestCompactionTimestamp = this._getLatestCompactionTimestamp();
		if (!settings.enabled) {
			const estimate = estimateContextTokens(messages, systemPrompt, { sinceTimestamp: latestCompactionTimestamp });
			return {
				messages,
				estimate,
				budgetEstimate: estimate,
				source: estimate.lastUsageIndex === null ? "estimated" : "provider_usage",
				toolRawTokens: estimateToolResultTokens(messages),
			};
		}

		const initialEstimate = estimateContextTokens(messages, systemPrompt, { useProviderUsage: false });
		const pressureEstimate = initialEstimate;
		const preparedMessages = this._withWorkingStatePromptInsertions(
			messages,
			this._lastRuntimePromptComponents.workingStatePrompt,
			{ ...options, minimumAnchorTimestamp: latestCompactionTimestamp },
		);

		const finalEstimate = estimateContextTokens(preparedMessages, systemPrompt, { useProviderUsage: false });
		return {
			messages: preparedMessages,
			estimate: finalEstimate,
			budgetEstimate: pressureEstimate,
			source: "estimated",
			toolRawTokens: estimateToolResultTokens(preparedMessages),
		};
	}

	private _createTokenBreakdownForPrompt(
		messages: AgentMessage[],
		options: {
			totalOverride?: number;
			source?: "provider_usage" | "estimated";
			toolRawTokens?: number;
		} = {},
	): TokenBreakdown {
		const components = this._lastRuntimePromptComponents;
		return createTokenBreakdown({
			source: options.source ?? "estimated",
			systemPrompt: components.baseSystemPrompt ?? this.systemPrompt,
			toolsPrompt: this._createToolPromptAccountingText(),
			memoryPrompt: components.memoryPrompt,
			rulesPrompt: components.rulesPrompt,
			repoMapPrompt: components.repoMapPrompt,
			checkpoint: [components.stateProtocolPrompt, components.workingStatePrompt]
				.filter((prompt): prompt is string => prompt !== undefined && prompt.length > 0)
				.join("\n\n"),
			retrievedPrompt: [components.subagentProfilesPrompt, components.subagentDigestPrompt]
				.filter((prompt): prompt is string => prompt !== undefined && prompt.length > 0)
				.join("\n\n"),
			recentMessages: messages,
			toolRawTokens: options.toolRawTokens,
			totalOverride: options.totalOverride,
		});
	}

	initProjectMemory(): ProjectMemoryInitResult {
		return initProjectMemory(this._cwd);
	}

	syncProjectMemory(): ProjectMemoryUpdateResult {
		const snapshot = this.getSessionStateSnapshot();
		return updateProjectMemorySnapshot({
			cwd: this._cwd,
			sessionId: snapshot.sessionId,
			checkpoint: snapshot.checkpoint,
			state: snapshot.state,
			contextUsage: snapshot.contextUsage,
		});
	}

	diffProjectMemory(): ProjectMemoryDiffResult {
		const snapshot = this.getSessionStateSnapshot();
		return diffProjectMemorySnapshot({
			cwd: this._cwd,
			sessionId: snapshot.sessionId,
			checkpoint: snapshot.checkpoint,
			state: snapshot.state,
			contextUsage: snapshot.contextUsage,
		});
	}

	searchProjectMemory(query: string): ProjectMemorySearchResult {
		return searchProjectMemory(this._cwd, query);
	}

	pinProjectMemory(text: string): ProjectMemoryPinResult {
		const result = pinProjectMemory(this._cwd, text);
		this._syncProjectMemory();
		return result;
	}

	forgetProjectMemory(id: string): ProjectMemoryForgetResult {
		return forgetProjectMemory(this._cwd, id);
	}

	lintProjectRules(): RuleLintResult {
		return lintProjectRules(this._cwd);
	}

	explainProjectRules(query: string): RuleExplainResult {
		return explainProjectRules(this._cwd, query);
	}

	updateRepoMap(): RepoMap {
		return updateRepoMap(this._cwd);
	}

	recordSubagentDigest(
		profile: SubagentName,
		query: string,
		summary: string,
		evidencePointers: string[] = [],
	): SubagentDigest {
		return persistSubagentDigest(this._cwd, {
			profile,
			query,
			summary,
			evidencePointers,
		});
	}

	evaluateGuardrails(phase: ConstraintPhase = "final"): GuardrailReport {
		return evaluateGuardrails({
			cwd: this._cwd,
			phase,
			recentCommands: this._recentBashCommands,
		});
	}

	getCompactionDryRun(): CompactionDryRunResult {
		const settings = this._getEffectiveCompactionSettings();
		const contextWindow = this.model?.contextWindow ?? 0;
		const promptContext = this._preparePromptContext(this._getEffectiveCompactedMessages());
		const estimate = promptContext.estimate;
		const tokenBreakdown = this._createTokenBreakdownForPrompt(promptContext.messages, {
			source: promptContext.source,
			totalOverride: estimate.tokens,
			toolRawTokens: promptContext.toolRawTokens,
		});
		const budget = createContextBudgetReport(promptContext.budgetEstimate.tokens, contextWindow, settings);
		const pathEntries = this.sessionManager.getBranch();
		const preparationResult = prepareCompaction(pathEntries, settings, this.systemPrompt);

		if (!preparationResult.ok) {
			return {
				ok: false,
				reason: preparationResult.reason,
				message: preparationResult.message,
				contextTokens: estimate.tokens,
				contextWindow,
				triggerThreshold: budget.triggerThreshold,
				shouldCompact: budget.shouldCompact,
				tokensToSummarize: preparationResult.tokensToSummarize,
				toolRawTokens: promptContext.toolRawTokens,
				toolStubTokens: 0,
				toolStubSavings: 0,
				stubbedToolResults: [],
				tokenBreakdown,
			};
		}

		const preparation = preparationResult.preparation;
		const historyStubContext = stubToolResultsForCompactionSummary(preparation.messagesToSummarize);
		const turnPrefixStubContext = stubToolResultsForCompactionSummary(preparation.turnPrefixMessages);
		const toolRawTokens = historyStubContext.toolRawTokens + turnPrefixStubContext.toolRawTokens;
		const toolStubTokens = historyStubContext.toolStubTokens + turnPrefixStubContext.toolStubTokens;
		const stubbedToolResults = [
			...new Set([
				...historyStubContext.stubs.map((stub) => stub.rawPointer.id),
				...turnPrefixStubContext.stubs.map((stub) => stub.rawPointer.id),
			]),
		];
		const projectedAfterTokens =
			preparation.systemPromptTokens +
			Math.min(settings.summaryMaxTokens, settings.renderedStateMaxTokens) +
			preparation.recentRawTokens;
		return {
			ok: true,
			contextTokens: estimate.tokens,
			contextWindow,
			triggerThreshold: budget.triggerThreshold,
			shouldCompact: budget.shouldCompact,
			keepRecentTokens: preparation.keepRecentTokens,
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensToSummarize: preparation.tokensToSummarize,
			recentRawTokens: preparation.recentRawTokens,
			projectedAfterTokens,
			droppedEntries: preparation.droppedEntryIds,
			toolRawTokens,
			toolStubTokens,
			toolStubSavings: Math.max(0, toolRawTokens - toolStubTokens),
			stubbedToolResults,
			tokenBreakdown,
		};
	}

	private _createUpdateSessionStateToolDefinition(): ToolDefinition<
		typeof UPDATE_SESSION_STATE_SCHEMA,
		UpdateSessionStateResult
	> {
		return {
			name: UPDATE_SESSION_STATE_TOOL_NAME,
			label: "Update Session State",
			description:
				"Record or revise the canonical goal, plan, decisions, files, and risks for the latest user message.",
			promptSnippet:
				"update_session_state(action, goal?, plan?, decisions?, risks?): call before other tools on every user turn to set the initial plan or re-plan against the latest user message.",
			promptGuidelines: [
				`Call ${UPDATE_SESSION_STATE_TOOL_NAME} before any other tool on every new user turn, including the first request and queued follow-ups.`,
				"Use it to preserve the durable goal when the latest user message is a follow-up, or to explicitly change the goal when the user corrects the objective.",
				`For action "replan", provide updated plan items. Each item can have an optional "op" field: "add" (default, adds new or updates matched existing), "update" (updates matched existing item), or "remove" (removes matched item by exact text). Items not mentioned are preserved.`,
				`To fully replace the entire plan mid-task, mark all items done then use "initial_plan".`,
				`Use "action": "progress_update" to update existing plan items (status/text) without adding new ones.`,
				`Use ${MARK_SESSION_PROGRESS_TOOL_NAME} instead when only an existing plan item changes status.`,
				"Do not wait for user approval in normal mode; this is internal state maintenance, not /plan approval mode.",
			],
			parameters: UPDATE_SESSION_STATE_SCHEMA,
			executionMode: "sequential",
			execute: async (_toolCallId, params) => {
				const result = this._applyUpdateSessionState(params as UpdateSessionStateInput);
				return {
					content: [
						{
							type: "text",
							text:
								result.status === "updated"
									? `Session state updated. Goal: ${result.goal || "(none)"}. Plan items: ${result.planItems}.`
									: `Session state unchanged. Goal: ${result.goal || "(none)"}.`,
						},
					],
					details: result,
				};
			},
		};
	}

	private _applyUpdateSessionState(input: UpdateSessionStateInput): UpdateSessionStateResult {
		const branchEntries = this.sessionManager.getBranch();
		const previous =
			getLatestStructuredSessionState(branchEntries) ??
			createInitialStructuredSessionState(this.sessionManager.getSessionId());
		const liveState = createLiveStructuredSessionState({
			sessionId: this.sessionManager.getSessionId(),
			previous: createInitialStructuredSessionState(this.sessionManager.getSessionId()),
			entries: branchEntries,
			timestamp: new Date().toISOString(),
		});
		const sourceEntryIds = liveState.canonicalRequest.sourceEntryIds;
		const patch = this._createStatePatchFromUpdateSessionStateInput(input, previous, sourceEntryIds, liveState);
		if (!patch) {
			return {
				status: "unchanged",
				action: input.action,
				goal: previous.canonicalRequest.current,
				planItems: previous.plan.length,
				toolCalls: this.getSessionStats().toolCalls,
			};
		}
		const state = mergeStructuredSessionState(previous, patch);
		this.sessionManager.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, state);
		writeSessionStateFile(this._cwd, state);
		return {
			status: "updated",
			action: input.action,
			goal: state.canonicalRequest.current,
			planItems: state.plan.length,
			toolCalls: this.getSessionStats().toolCalls,
		};
	}

	/**
	 * Silently execute update_session_state using current session state as defaults.
	 * Clears the blocking flags so that a subsequent finish_work call can proceed.
	 */
	private _autoExecuteUpdateSessionStateForFinishWork(): void {
		if (!this._progressUpdateRequiredBeforeFinish && !this._stateUpdateRequiredForCurrentUserTurn) {
			return;
		}

		const state = getLatestStructuredSessionState(this.sessionManager.getBranch());
		const params: UpdateSessionStateInput = {
			action: "progress_update",
			goal: state?.canonicalRequest.current ?? "",
			plan: (state?.plan ?? []).map((item) => ({ text: item.text, status: item.status })),

			decisions: (state?.decisions ?? []).map((item) => ({ decision: item.decision, rationale: item.rationale })),
			risks: state?.audit.knownRisks ?? [],
			touchedFiles: (state?.codebase.touchedFiles ?? []).map((file: TouchedFile) => ({
				path: file.path,
				status: file.status,
				summary: file.summary,
			})),
			evidence: (state?.evidence ?? []).map((item: EvidencePointer) => ({
				kind: item.kind,
				summary: item.summary,
				path: item.path,
				retrieveWhen: item.retrieveWhen,
			})),
		};

		this._applyUpdateSessionState(params);
		this._progressUpdateRequiredBeforeFinish = false;
		this._stateUpdateRequiredForCurrentUserTurn = false;
	}

	/**
	 * When finish_work(status: "success") is called, treat it as the authoritative
	 * final declaration and auto-transition not_started / in_progress plan items
	 * to done so the consistency gate passes without a protocol-repair turn.
	 * Does NOT touch failed or blocked items — those remain suspicious.
	 */
	private _reconcileSuccessfulFinishWorkState(): void {
		const branchEntries = this.sessionManager.getBranch();
		const state =
			getLatestStructuredSessionState(branchEntries) ??
			readSessionStateFile(this._cwd, this.sessionManager.getSessionId());
		if (!state) {
			return;
		}
		const reconciled = reconcilePlanItemsForSuccessFinish(state);
		if (!reconciled) {
			return;
		}
		this.sessionManager.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, reconciled);
		writeSessionStateFile(this._cwd, reconciled);
	}

	private _createStatePatchFromUpdateSessionStateInput(
		input: UpdateSessionStateInput,
		previous: StructuredSessionState,
		sourceEntryIds: string[],
		liveState: StructuredSessionState,
	): StatePatch | undefined {
		if (input.action === "none") {
			return undefined;
		}
		const goal = normalizeStateText(input.goal ?? "");
		const rawPlanItems = (input.plan ?? [])
			.map((item) => ({
				op: item.op ?? "add",
				id: createStateToolStableId("plan", item.text),
				text: capStateToolText(item.text, 280),
				status: item.status ?? "not_started",
				evidenceEntryIds: [...sourceEntryIds],
			}))
			.filter((item) => item.text.length > 0);
		const decisions = (input.decisions ?? [])
			.map((item) => ({
				id: createStateToolStableId("decision", item.decision),
				decision: capStateToolText(item.decision, 260),
				rationale: capStateToolText(item.rationale ?? "", 320),
				evidencePointers: [],
				status: "active" as const,
			}))
			.filter((item) => item.decision.length > 0);
		const touchedFiles = (input.touchedFiles ?? [])
			.map((file) => ({
				path: file.path.trim(),
				status: file.status ?? "modified",
				summary: capStateToolText(file.summary ?? "Touched during this session.", 320),
			}))
			.filter((file) => file.path.length > 0);
		const evidence = (input.evidence ?? [])
			.map((pointer) => ({
				id: createStateToolStableId("evidence", `${pointer.path ?? ""}:${pointer.summary}`),
				kind: pointer.kind ?? "message",
				path: normalizeStateText(pointer.path ?? "") || undefined,
				summary: capStateToolText(pointer.summary, 260),
				retrieveWhen: capStateToolText(pointer.retrieveWhen ?? "Need exact supporting evidence.", 260),
			}))
			.filter((pointer) => pointer.summary.length > 0);
		const risks = (input.risks ?? []).map((risk) => capStateToolText(risk, 260)).filter((risk) => risk.length > 0);
		const replaceCompletedPlan =
			input.action === "initial_plan" &&
			previous.plan.length > 0 &&
			previous.plan.every((item) => item.status === "done");
		const plan =
			rawPlanItems.length === 0
				? undefined
				: input.action === "progress_update"
					? {
							update: rawPlanItems.map((item) => ({
								id: item.id,
								matchText: item.text,
								text: item.text,
								status: item.status,
								evidenceEntryIds: item.evidenceEntryIds,
							})),
						}
					: replaceCompletedPlan
						? { replace: rawPlanItems }
						: (() => {
								const addItems = rawPlanItems.filter((i) => i.op === "add");
								const updateItems = rawPlanItems
									.filter((i) => i.op === "update")
									.map((i) => ({
										id: i.id,
										matchText: i.text,
										text: i.text,
										status: i.status,
										evidenceEntryIds: i.evidenceEntryIds,
									}));
								const removeItems = rawPlanItems
									.filter((i) => i.op === "remove")
									.map((i) => ({ id: i.id, text: i.text }));
								const p: NonNullable<StatePatch["plan"]> = {};
								if (addItems.length > 0) p.add = addItems;
								if (updateItems.length > 0) p.update = updateItems;
								if (removeItems.length > 0) p.remove = removeItems;
								return Object.keys(p).length > 0 ? p : undefined;
							})();
		const patch: StatePatch = {
			canonicalRequest:
				goal || liveState.canonicalRequest.originalRequests.length > 0
					? {
							current: goal || undefined,
							sourceEntryIds,
							originalRequests: liveState.canonicalRequest.originalRequests,
						}
					: undefined,
			plan,

			decisions: decisions.length > 0 ? { add: decisions } : undefined,
			codebase: touchedFiles.length > 0 ? { touchedFiles, relevantSymbols: [] } : undefined,
			evidence: evidence.length > 0 ? { add: evidence } : undefined,
			audit: risks.length > 0 ? { knownRisks: risks } : undefined,
		};
		return hasStateToolPatchContent(patch) ? patch : undefined;
	}

	private _createMarkSessionProgressToolDefinition(): ToolDefinition<
		typeof MARK_SESSION_PROGRESS_SCHEMA,
		MarkSessionProgressResult
	> {
		return {
			name: MARK_SESSION_PROGRESS_TOOL_NAME,
			label: "Mark Session Progress",
			description: "Update the status of an existing session plan item without adding duplicate plan steps.",
			promptSnippet:
				"mark_session_progress(task, status): update an existing visible plan item by task text; use update_session_state replan for new tasks.",
			promptGuidelines: [
				"Use the exact visible task text from the working state whenever possible.",
				"Do not use this to create new plan items; call update_session_state with action replan when the task is new.",
				`Call ${MARK_SESSION_PROGRESS_TOOL_NAME} before ${FINISH_WORK_TOOL_NAME} after completing meaningful tool work.`,
			],
			parameters: MARK_SESSION_PROGRESS_SCHEMA,
			executionMode: "sequential",
			execute: async (_toolCallId, params) => {
				const result = this._applyMarkSessionProgress(params as MarkSessionProgressInput);
				return {
					content: [
						{
							type: "text",
							text:
								result.status === "updated"
									? `Session progress updated. Task: ${result.matchedTask ?? result.task}.`
									: `Session progress task not found: ${result.task}. Call ${UPDATE_SESSION_STATE_TOOL_NAME} with action "replan" if this is new work.`,
						},
					],
					details: result,
					isError: result.status === "not_found",
				};
			},
		};
	}

	private _applyMarkSessionProgress(input: MarkSessionProgressInput): MarkSessionProgressResult {
		const task = capStateToolText(input.task, 280);
		const branchEntries = this.sessionManager.getBranch();
		const previous =
			getLatestStructuredSessionState(branchEntries) ??
			createInitialStructuredSessionState(this.sessionManager.getSessionId());
		const matchedPlanItem = findMatchingPlanItem(previous.plan, task);
		if (!task || !matchedPlanItem) {
			return {
				status: "not_found",
				task,
				goal: previous.canonicalRequest.current,
				planItems: previous.plan.length,
				toolCalls: this.getSessionStats().toolCalls,
			};
		}

		const sourceEntryIds = branchEntries.map((entry) => entry.id).filter((id) => id.length > 0);
		const patch: StatePatch = {
			plan: {
				update: [
					{
						id: matchedPlanItem.id,
						matchText: task,
						status: input.status,
						evidenceEntryIds: sourceEntryIds,
					},
				],
			},
		};
		const state = mergeStructuredSessionState(previous, patch);
		this.sessionManager.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, state);
		writeSessionStateFile(this._cwd, state);
		return {
			status: "updated",
			task,
			matchedTask: matchedPlanItem.text,
			goal: state.canonicalRequest.current,
			planItems: state.plan.length,
			toolCalls: this.getSessionStats().toolCalls,
		};
	}

	private _createSessionRecallToolDefinition(): ToolDefinition<typeof SESSION_RECALL_SCHEMA, RecallResult> {
		return {
			name: "session_recall",
			label: "Session Recall",
			description:
				"Retrieve bounded snippets from older session history by pointer id or query. Use this when tool results were stubbed or exact old evidence is needed.",
			promptSnippet:
				"session_recall(query, options): retrieve bounded snippets from old session history by pointer id or search query. For stubbed tool output, use { includeRaw: true, maxTokens: 4000 }.",
			promptGuidelines: [
				"When a tool result is stubbed, call session_recall with its raw pointer and { includeRaw: true, maxTokens: 4000 } before rereading the same file or relying on omitted raw output.",
			],
			parameters: SESSION_RECALL_SCHEMA,
			executionMode: "parallel",
			execute: async (_toolCallId, params) => {
				const result = this._recallSessionEvidence(params as SessionRecallInput);
				return {
					content: [{ type: "text", text: formatRecallResult(result) }],
					details: result,
				};
			},
		};
	}

	private _createToolSearchToolDefinition(): ToolDefinition<typeof TOOL_SEARCH_SCHEMA, ToolSearchResult> {
		return {
			name: TOOL_SEARCH_TOOL_NAME,
			label: "Tool Search",
			description:
				"Search registered extension and MCP tools by capability and activate a small relevant set for the next turn. " +
				"Use this before browser, external-service, language-server, memory, or other specialized work when the needed tool is not already available.",
			promptSnippet:
				"tool_search(query, names?, limit?): find and activate relevant extension or MCP tools without loading every tool schema",
			promptGuidelines: [
				"When specialized tools are needed but not active, call tool_search with a specific capability, then use the activated tools on the next turn.",
			],
			parameters: TOOL_SEARCH_SCHEMA,
			executionMode: "sequential",
			execute: async (_toolCallId, params) => {
				const query = params.query?.trim();
				const requestedNames = [...new Set(params.names ?? [])].slice(0, 8);
				const activeNames = new Set(this.getActiveToolNames());
				const alreadyActive = requestedNames.filter((name) => activeNames.has(name));
				const unknownNames = requestedNames.filter((name) => !this._toolDefinitions.has(name));
				const exactMatches = requestedNames.filter(
					(name) => this._toolDefinitions.has(name) && !activeNames.has(name),
				);
				const limit = Math.min(8, Math.max(1, params.limit ?? 5));
				const terms = query
					?.toLowerCase()
					.split(/[^a-z0-9_]+/u)
					.filter((term) => term.length >= 2);
				const compactQuery = terms?.join("") ?? "";
				const rankedMatches = query
					? Array.from(this._toolDefinitions.entries())
							.filter(([name, entry]) => !activeNames.has(name) && entry.sourceInfo.source !== "builtin")
							.map(([name, entry]) => {
								const normalizedName = name.toLowerCase();
								const normalizedLabel = entry.definition.label.toLowerCase();
								const normalizedDescription = entry.definition.description.toLowerCase();
								const normalizedSnippet = entry.definition.promptSnippet?.toLowerCase() ?? "";
								const normalizedSource = entry.sourceInfo.path.toLowerCase();
								let score = normalizedName === query.toLowerCase() ? 1_000 : 0;
								if (
									compactQuery.length >= 3 &&
									normalizedName.replace(/[^a-z0-9]/gu, "").includes(compactQuery)
								) {
									score += 150;
								}
								for (const term of terms ?? []) {
									if (normalizedName.includes(term)) score += 20;
									if (normalizedLabel.includes(term)) score += 10;
									if (normalizedDescription.includes(term)) score += 5;
									if (normalizedSnippet.includes(term)) score += 3;
									if (normalizedSource.includes(term)) score += 3;
								}
								return { name, entry, score };
							})
							.filter(({ score }) => score > 0)
							.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
							.slice(0, limit)
					: [];
				const queryMatches = rankedMatches.map(({ name }) => name);
				const activated = [...new Set([...exactMatches, ...queryMatches])].slice(0, 8);
				if (activated.length > 0) {
					this.setActiveToolsByName([...activeNames, ...activated]);
				}
				const matches = activated.map((name) => {
					const entry = this._toolDefinitions.get(name)!;
					return {
						name,
						description: entry.definition.description,
						source: entry.sourceInfo.path,
					};
				});
				const result: ToolSearchResult = {
					query,
					activated,
					alreadyActive,
					matches,
					unknownNames,
				};
				const lines = matches.map((match) => `- ${match.name}: ${match.description}`);
				const summary =
					lines.length > 0
						? `Activated for the next turn:\n${lines.join("\n")}`
						: "No matching inactive tools were found. Use a more specific capability or exact tool names.";
				return {
					content: [{ type: "text", text: summary }],
					details: result,
				};
			},
		};
	}

	private _createKeepContextToolDefinition(): ToolDefinition<typeof KEEP_CONTEXT_SCHEMA, any> {
		return {
			name: "keep_context",
			label: "Keep Context",
			description:
				"Control how a large tool result is preserved in future context. " +
				"Use this to summarize long outputs or pin important evidence before it gets automatically stubbed.",
			parameters: KEEP_CONTEXT_SCHEMA,
			execute: async (_toolCallId, params) => {
				const input = params as {
					toolCallId: string;
					summary?: string;
					relevantLines?: string[];
					pin?: boolean;
				};
				const message = this.agent.state.messages.find(
					(m) => m.role === "toolResult" && (m as any).toolCallId === input.toolCallId,
				) as any | undefined;

				if (!message) {
					return {
						content: [
							{
								type: "text",
								text: `Error: Tool result with ID ${input.toolCallId} not found.`,
							},
						],
						details: { error: "not_found" },
						isError: true,
					};
				}

				message.details = {
					...(isRecord(message.details) ? message.details : {}),
					contextExtract:
						input.summary || input.relevantLines
							? {
									summary: input.summary || "",
									relevantLines: input.relevantLines || [],
									source: "service_model" as const,
								}
							: message.details?.contextExtract,
					keepInContext: input.pin ?? message.details?.keepInContext,
				};

				return {
					content: [
						{
							type: "text",
							text: `Context settings updated for tool result ${input.toolCallId}.`,
						},
					],
					details: { status: "updated" },
				};
			},
		};
	}

	private _createRunSubagentToolDefinition(): ToolDefinition<typeof RUN_SUBAGENT_SCHEMA, RunSubagentResult> {
		return {
			name: "run_subagent",
			label: "Run Subagent",
			description:
				"Run a read-only subagent with restricted permissions for noisy exploration tasks. " +
				"The parent context receives only a concise digest; the full subagent session is stored separately. " +
				"Use 'explore' for codebase exploration, 'scout' for web research, 'review' for code review.",
			promptSnippet:
				"run_subagent(profile, task): run a read-only subagent (explore, scout, review) with restricted permissions",
			promptGuidelines: [
				"Use 'explore' for codebase exploration (read, grep, ls only).",
				"Use 'scout' for web/dependency research.",
				"Use 'review' for read-only code review.",
				"Parent context receives only a digest; raw subagent session is stored separately.",
			],
			parameters: RUN_SUBAGENT_SCHEMA,
			executionMode: "sequential",
			execute: async (_toolCallId, params) => {
				const input = params as RunSubagentInput;
				const result = await this._runSubagent(input);
				return {
					content: [{ type: "text", text: this._formatSubagentResult(result) }],
					details: result,
				};
			},
		};
	}

	private async _runSubagent(input: RunSubagentInput): Promise<RunSubagentResult> {
		const profile = BUILTIN_SUBAGENT_PROFILES.find((p) => p.name === input.profile);
		if (!profile) {
			throw new Error(`Unknown subagent profile: ${input.profile}`);
		}
		const model = this.model;
		if (!model) {
			throw new Error(formatNoModelSelectedMessage());
		}

		const allowedToolNames = getSubagentAllowedTools(input.profile);
		const tools = this.agent.state.tools.filter((tool) => allowedToolNames.has(tool.name));
		const systemPrompt = [
			`You are the ${input.profile} read-only subagent.`,
			profile.description,
			"Return a concise digest with findings, evidence pointers, and unresolved risks.",
			"Do not edit files. Do not run tools outside your allowed tool list.",
			"Do not continue the parent task; only answer the delegated subtask.",
		].join("\n");
		const subagent = new Agent({
			initialState: {
				model,
				systemPrompt,
				tools,
			},
			convertToLlm: this.agent.convertToLlm,
			transformContext: async (messages, signal) => {
				const transformed = this.agent.transformContext
					? await this.agent.transformContext(messages, signal)
					: messages;
				return this._preparePromptContext(transformed, systemPrompt).messages;
			},
			streamFn: this.agent.streamFn,
			getApiKey: this.agent.getApiKey,
			onPayload: this.agent.onPayload,
			onResponse: this.agent.onResponse,
			beforeToolCall: this.agent.beforeToolCall,
			afterToolCall: this.agent.afterToolCall,
			prepareNextTurn: (_signal, context) => ({
				appendMessages: context
					? createTurnCheckpointMessages(
							context,
							this._getCurrentStructuredSessionState(),
							this.settingsManager.getCompactionRenderedStateMaxTokens(),
						)
					: undefined,
			}),
			toolExecution: "parallel",
			completionMode: "implicit",
			thinkingBudgets: this.agent.thinkingBudgets,
			transport: this.agent.transport,
			maxRetryDelayMs: this.agent.maxRetryDelayMs,
		});
		const transcript: AgentMessage[] = [];
		const unsubscribe = subagent.subscribe((event) => {
			if (event.type === "message_end") {
				transcript.push(event.message);
			}
		});
		try {
			await subagent.prompt(input.task);
		} finally {
			unsubscribe();
		}

		const summary = summarizeSubagentTranscript(transcript);
		const provisionalId = `subagent:${input.profile}:${Date.now().toString(36)}`;
		const transcriptPath = persistSubagentTranscript(this._cwd, provisionalId, transcript);
		const digest = persistSubagentDigest(this._cwd, {
			profile: input.profile,
			query: input.task,
			summary,
			evidencePointers: [`file:${transcriptPath}`],
			transcriptPath,
		});

		return {
			id: digest.id,
			profile: input.profile,
			task: input.task,
			summary: digest.summary,
			evidencePointers: digest.evidencePointers,
			turnCount: transcript.length,
		};
	}

	private _formatSubagentResult(result: RunSubagentResult): string {
		const lines = [
			`[Subagent ${result.profile} completed]`,
			`ID: ${result.id}`,
			`Task: ${result.task}`,
			`Turns: ${result.turnCount}`,
			`Summary: ${result.summary}`,
		];
		if (result.evidencePointers.length > 0) {
			lines.push(`Evidence: ${result.evidencePointers.join(", ")}`);
		}
		lines.push(`Retrieve: session_recall("${result.id}")`);
		return lines.join("\n");
	}

	private _recallSessionEvidence(params: SessionRecallInput): RecallResult {
		const defaultMaxTokens = params.includeRaw ? 4000 : 1200;
		const maxTokens = Math.max(1, Math.min(params.maxTokens ?? defaultMaxTokens, 4000));
		const kindFilter = params.kind ? new Set<EvidenceKind>(params.kind) : undefined;
		const scored = this._collectRecallCandidates()
			.filter((candidate) => !kindFilter || kindFilter.has(candidate.pointer.kind))
			.map((candidate) => ({
				candidate,
				relevance: scoreRecallCandidate(params.query, candidate),
			}))
			.filter((item) => item.relevance > 0)
			.sort((a, b) => b.relevance - a.relevance || a.candidate.pointer.id.localeCompare(b.candidate.pointer.id));

		const hits: RecallHit[] = [];
		let remainingTokens = maxTokens;
		for (const item of scored.slice(0, 8)) {
			const rawText = params.includeRaw ? item.candidate.rawText : undefined;
			const rawTokens = rawText !== undefined ? estimateTextTokens(rawText) : undefined;
			const excerpt =
				rawText !== undefined && remainingTokens > 0 ? capTextByTokens(rawText, remainingTokens) : undefined;
			const excerptTokens = excerpt !== undefined ? estimateTextTokens(excerpt) : undefined;
			const truncated = rawTokens !== undefined ? rawTokens > remainingTokens : undefined;
			if (rawTokens !== undefined) {
				remainingTokens -= Math.min(rawTokens, remainingTokens);
			}
			hits.push({
				pointer: item.candidate.pointer,
				relevance: item.relevance,
				summary: item.candidate.pointer.summary,
				excerpt,
				rawTokens,
				excerptTokens,
				truncated,
			});
			if (remainingTokens <= 0) break;
		}
		return { query: params.query, hits };
	}

	private _collectRecallCandidates(): RecallCandidate[] {
		const candidates: RecallCandidate[] = [];
		const seenOriginalRequestIds = new Set<string>();
		addOriginalRequestRecallCandidates(
			candidates,
			this._getCurrentStructuredSessionState(this.sessionManager.getBranch()),
			seenOriginalRequestIds,
		);
		for (const digest of readSubagentDigests(this._cwd)) {
			const transcriptPath = digest.transcriptPath ? resolvePath(this._cwd, digest.transcriptPath) : undefined;
			const transcriptText =
				transcriptPath && existsSync(transcriptPath) ? readFileSync(transcriptPath, "utf8") : undefined;
			const rawText = transcriptText ?? JSON.stringify(digest, undefined, 2);
			candidates.push({
				pointer: {
					id: digest.id,
					kind: "artifact",
					summary: `Subagent ${digest.profile}: ${digest.summary}`,
					retrieveWhen: "Need read-only subagent digest evidence.",
				},
				searchText: `${digest.profile}\n${digest.query}\n${digest.summary}\n${digest.evidencePointers.join("\n")}\n${digest.transcriptPath ?? ""}`,
				rawText,
			});
		}
		for (const entry of this.sessionManager.getBranch()) {
			if (entry.type === "message") {
				const text = getMessageTextForRecall(entry.message);
				if (entry.message.role === "toolResult") {
					candidates.push({
						pointer: {
							id: `tool-result:${entry.message.toolCallId}`,
							kind: "tool_result",
							entryId: entry.id,
							summary: `${entry.message.toolName} ${entry.message.isError ? "error" : "success"} result`,
							retrieveWhen: `Need exact raw output from ${entry.message.toolName}.`,
						},
						searchText: text,
						rawText: text,
					});
				} else if (entry.message.role === "bashExecution") {
					candidates.push({
						pointer: {
							id: `bash:${entry.id}`,
							kind: "bash",
							entryId: entry.id,
							summary: `Bash command: ${entry.message.command}`,
							retrieveWhen: "Need exact bash command output.",
						},
						searchText: text,
						rawText: text,
					});
				} else {
					candidates.push({
						pointer: {
							id: `message:${entry.id}`,
							kind: "message",
							entryId: entry.id,
							summary: `${entry.message.role} message`,
							retrieveWhen: "Need exact old conversation message.",
						},
						searchText: text,
						rawText: text,
					});
				}
			} else if (entry.type === "compaction") {
				candidates.push({
					pointer: {
						id: `compaction:${entry.id}`,
						kind: "message",
						entryId: entry.id,
						summary: "Compaction checkpoint",
						retrieveWhen: "Need the rendered compaction checkpoint.",
					},
					searchText: entry.summary,
					rawText: entry.summary,
				});
				const details = normalizeCompactionDetails(entry.details);
				if (details.structuredState) {
					addOriginalRequestRecallCandidates(candidates, details.structuredState, seenOriginalRequestIds);
				}
				for (const pointer of details.structuredState?.evidence ?? []) {
					candidates.push({
						pointer,
						searchText: pointer.summary,
					});
				}
				if (details.markdownSummary) {
					candidates.push({
						pointer: {
							id: `compaction-markdown:${entry.id}`,
							kind: "message",
							entryId: entry.id,
							summary: "Raw markdown compaction summary",
							retrieveWhen: "Need pre-render markdown summary produced by the compaction model.",
						},
						searchText: details.markdownSummary,
						rawText: details.markdownSummary,
					});
				}
			}
		}
		return candidates;
	}

	private _prepareDeterministicCompaction(
		preparation: CompactionPreparation,
		pathEntries: SessionEntry[],
		settings: CompactionSettings & { renderedStateMaxTokens: number },
	): CompactionResult<CompactionDetails> & { state: StructuredSessionState } {
		const { readFiles, modifiedFiles } = computeFileLists(preparation.fileOps);
		const historyStubContext = stubToolResultsForCompactionSummary(preparation.messagesToSummarize);
		const turnPrefixStubContext = stubToolResultsForCompactionSummary(preparation.turnPrefixMessages);
		const stubbedToolResultPointers = [
			...historyStubContext.stubs.map((stub) => stub.rawPointer),
			...turnPrefixStubContext.stubs.map((stub) => stub.rawPointer),
		];
		const stubbedToolResults = [...new Set(stubbedToolResultPointers.map((pointer) => pointer.id))];
		const toolRawTokens = historyStubContext.toolRawTokens + turnPrefixStubContext.toolRawTokens;
		const toolStubTokens = historyStubContext.toolStubTokens + turnPrefixStubContext.toolStubTokens;
		const baseState = this._getCurrentStructuredSessionState(pathEntries);
		const risks = hasMeaningfulStructuredSessionState(baseState)
			? []
			: [
					"No structured state was available before deterministic compaction; recent raw messages carry remaining context.",
				];
		const state = mergeStructuredSessionState(baseState, {
			codebase:
				readFiles.length > 0 || modifiedFiles.length > 0
					? {
							touchedFiles: [
								...readFiles.map((path) => ({
									path,
									status: "read" as const,
									summary: "Read during compacted session history.",
								})),
								...modifiedFiles.map((path) => ({
									path,
									status: "modified" as const,
									summary: "Modified during compacted session history.",
								})),
							],
							relevantSymbols: [],
						}
					: undefined,
			evidence: stubbedToolResultPointers.length > 0 ? { add: stubbedToolResultPointers } : undefined,
			audit: {
				lastCompactionAt: new Date().toISOString(),
				compactionCount: baseState.audit.compactionCount + 1,
				knownRisks: risks,
			},
		});
		const summary = renderStructuredSessionCheckpoint(state, settings.renderedStateMaxTokens);
		const summaryTokens = Math.ceil(summary.length / 4);
		const afterTokens = preparation.systemPromptTokens + summaryTokens + preparation.recentRawTokens;
		const audit = {
			beforeTokens: preparation.tokensBefore,
			afterTokens,
			savedTokens: Math.max(0, preparation.tokensBefore - afterTokens),
			summaryTokens,
			renderedStateTokens: summaryTokens,
			recentRawTokens: preparation.recentRawTokens,
			toolRawTokens,
			toolStubTokens,
			droppedEntries: preparation.droppedEntryIds,
			stubbedToolResults,
			risks,
		};
		return {
			summary,
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
			tokensAfter: afterTokens,
			details: {
				readFiles,
				modifiedFiles,
				audit,
				structuredState: state,
			},
			state,
		};
	}

	private async _prepareDefaultCompaction(
		preparation: CompactionPreparation,
		pathEntries: SessionEntry[],
		settings: CompactionSettings & { renderedStateMaxTokens: number },
		customInstructions: string | undefined,
		signal: AbortSignal | undefined,
	): Promise<CompactionResult<CompactionDetails> & { state: StructuredSessionState }> {
		const deterministic = this._prepareDeterministicCompaction(preparation, pathEntries, settings);

		try {
			const authRequest = await this._getServiceAuthWithCurrentFallback(this._getServiceModelRequest());
			const modelResult = await compactWithModel(
				preparation,
				authRequest.model,
				authRequest.apiKey,
				authRequest.headers,
				customInstructions,
				signal,
				authRequest.thinkingLevel,
				this.agent.streamFn,
				(currentChunk, totalChunks) => {
					this._emit({ type: "compaction_progress", currentChunk, totalChunks });
				},
			);
			const modelDetails = modelResult.details as CompactionDetails | undefined;
			const readFiles = modelDetails?.readFiles ?? deterministic.details?.readFiles ?? [];
			const modifiedFiles = modelDetails?.modifiedFiles ?? deterministic.details?.modifiedFiles ?? [];
			const audit = modelDetails?.audit ?? deterministic.details?.audit;
			const baseState = this._getCurrentStructuredSessionState(pathEntries);
			const state = createStructuredSessionState({
				sessionId: this.sessionManager.getSessionId(),
				previous: baseState,
				summary: modelResult.summary,
				entries: pathEntries,
				readFiles,
				modifiedFiles,
				audit,
				timestamp: new Date().toISOString(),
			});
			return {
				...modelResult,
				details: {
					readFiles,
					modifiedFiles,
					audit,
					markdownSummary: modelResult.summary,
					structuredState: state,
				},
				state,
			};
		} catch {
			return deterministic;
		}
	}

	/**
	 * Manually compact the session context.
	 * Aborts current agent operation first.
	 * @param customInstructions Optional instructions for the compaction summary
	 */
	async compact(customInstructions?: string): Promise<CompactionResult> {
		this._disconnectFromAgent();
		await this.abort();
		this._compactionAbortController = new AbortController();
		this._emit({ type: "compaction_start", reason: "manual" });

		try {
			const pathEntries = this.sessionManager.getBranch();
			const settings = this._getEffectiveCompactionSettings();

			const preparationResult = prepareCompaction(pathEntries, settings, this.systemPrompt);
			if (!preparationResult.ok) {
				throw new Error(preparationResult.message);
			}
			const { preparation } = preparationResult;

			let extensionCompaction: CompactionResult | undefined;
			let fromExtension = false;

			if (this._extensionRunner.hasHandlers("session_before_compact")) {
				const result = (await this._extensionRunner.emit({
					type: "session_before_compact",
					preparation,
					branchEntries: pathEntries,
					customInstructions,
					signal: this._compactionAbortController.signal,
				})) as SessionBeforeCompactResult | undefined;

				if (result?.cancel) {
					throw new Error("Compaction cancelled");
				}

				if (result?.compaction) {
					extensionCompaction = result.compaction;
					fromExtension = true;
				}
			}

			let summary: string;
			let firstKeptEntryId: string;
			let tokensBefore: number;
			let tokensAfter: number | undefined;
			let details: unknown;
			let structuredState: unknown;

			if (extensionCompaction) {
				// Extension provided compaction content
				summary = extensionCompaction.summary;
				firstKeptEntryId = extensionCompaction.firstKeptEntryId;
				tokensBefore = extensionCompaction.tokensBefore;
				tokensAfter = extensionCompaction.tokensAfter;
				details = extensionCompaction.details;
			} else {
				const result = await this._prepareDefaultCompaction(
					preparation,
					pathEntries,
					settings,
					customInstructions,
					this._compactionAbortController.signal,
				);
				summary = result.summary;
				firstKeptEntryId = result.firstKeptEntryId;
				tokensBefore = result.tokensBefore;
				tokensAfter = result.tokensAfter;
				details = result.details;
				structuredState = result.state;
			}

			if (this._compactionAbortController.signal.aborted) {
				throw new Error("Compaction cancelled");
			}

			this.sessionManager.appendCompaction(
				summary,
				firstKeptEntryId,
				tokensBefore,
				tokensAfter,
				details,
				fromExtension,
			);
			if (!fromExtension && structuredState && isStructuredSessionState(structuredState)) {
				this.sessionManager.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, structuredState);
				writeSessionStateFile(this._cwd, structuredState);
			}
			this._syncProjectMemory();
			const newEntries = this.sessionManager.getEntries();
			const sessionContext = this.sessionManager.buildSessionContext();

			// Post-compaction truncation: truncate oversized kept messages
			const systemPromptTokens = this.systemPrompt ? Math.ceil(this.systemPrompt.length / 4) : 0;
			const truncatedMessages = truncateKeptMessages(sessionContext.messages, {
				keepRecentTokens: preparation.keepRecentTokens,
				targetContextTokens: settings.targetContextTokens,
				systemPromptTokens,
			});
			this.agent.state.messages = truncatedMessages;
			const tokensAfterManual = estimateContextTokens(truncatedMessages, this.systemPrompt, {
				useProviderUsage: false,
			}).tokens;

			// Get the saved compaction entry for the extension event
			const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary) as
				| CompactionEntry
				| undefined;

			if (this._extensionRunner && savedCompactionEntry) {
				await this._extensionRunner.emit({
					type: "session_compact",
					compactionEntry: savedCompactionEntry,
					fromExtension,
				});
			}

			const compactionResult = {
				summary,
				firstKeptEntryId,
				tokensBefore,
				tokensAfter: tokensAfterManual,
				details,
			};
			this._emit({
				type: "compaction_end",
				reason: "manual",
				result: compactionResult,
				aborted: false,
				willRetry: false,
			});
			return compactionResult;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const aborted = message === "Compaction cancelled" || (error instanceof Error && error.name === "AbortError");
			this._emit({
				type: "compaction_end",
				reason: "manual",
				result: undefined,
				aborted,
				willRetry: false,
				errorMessage: aborted ? undefined : `Compaction failed: ${message}`,
			});
			throw error;
		} finally {
			this._compactionAbortController = undefined;
			this._reconnectToAgent();
		}
	}

	/**
	 * Cancel in-progress compaction (manual or auto).
	 */
	abortCompaction(): void {
		this._compactionAbortController?.abort();
		this._autoCompactionAbortController?.abort();
	}

	/**
	 * Cancel in-progress branch summarization.
	 */
	abortBranchSummary(): void {
		this._branchSummaryAbortController?.abort();
	}

	/**
	 * Check if compaction is needed and run it.
	 * Called between tool turns, after agent_end, and before prompt submission.
	 *
	 * Two cases:
	 * 1. Overflow: LLM returned context overflow error, remove error message from agent state, compact, auto-retry
	 * 2. Threshold: Context over threshold, compact at the current persisted boundary
	 *
	 * @param assistantMessage The assistant message to check
	 * @param skipAbortedCheck If false, include aborted messages (for pre-prompt check). Default: true
	 */
	async checkCompaction(
		assistantMessage: AssistantMessage | undefined,
		skipAbortedCheck = true,
		additionalMessages?: AgentMessage[],
	): Promise<boolean> {
		const settings = this._getEffectiveCompactionSettings();
		if (!settings.enabled) return false;

		// Skip if message was aborted (user cancelled) - unless skipAbortedCheck is false
		if (assistantMessage && skipAbortedCheck && assistantMessage.stopReason === "aborted") return false;

		const contextWindow = this.model?.contextWindow ?? 0;

		// Skip compaction checks if this assistant message is older than the latest
		// compaction boundary. This prevents a stale pre-compaction usage/error
		// from retriggering compaction on the first prompt after compaction.
		const branchEntries = this.sessionManager.getBranch();
		const compactionEntry = getLatestCompactionEntry(branchEntries);
		const assistantIsFromBeforeCompaction =
			assistantMessage &&
			compactionEntry !== null &&
			assistantMessage.timestamp <= new Date(compactionEntry.timestamp).getTime();
		if (assistantIsFromBeforeCompaction && !additionalMessages) {
			return false;
		}
		const assistantForCompactionCheck = assistantIsFromBeforeCompaction ? undefined : assistantMessage;

		// Case 1: Overflow - LLM returned context overflow error
		if (assistantForCompactionCheck && this._isContextOverflowForCurrentModel(assistantForCompactionCheck)) {
			if (this._overflowRecoveryAttempts >= MAX_OVERFLOW_RECOVERY_COMPACTIONS) {
				this._emit({
					type: "compaction_end",
					reason: "overflow",
					result: undefined,
					aborted: false,
					willRetry: false,
					errorMessage: `Context overflow recovery failed after ${MAX_OVERFLOW_RECOVERY_COMPACTIONS} compact-and-retry attempts. Try reducing context or switching to a larger-context model.`,
				});
				return false;
			}

			this._overflowRecoveryAttempts += 1;
			// Remove the error message from agent state (it IS saved to session for history,
			// but we don't want it in context for the retry)
			const stateMessages = this.agent.state.messages;
			if (stateMessages.length > 0 && stateMessages[stateMessages.length - 1].role === "assistant") {
				this.agent.state.messages = stateMessages.slice(0, -1);
			}
			return await this._runAutoCompaction("overflow", true);
		}

		// Case 2: Threshold - context is getting large. This must be based on
		// the current prompt state, not historical provider usage persisted on
		// assistant messages that may have survived a compaction boundary.
		const messages = this._getEffectiveCompactedMessages().slice();
		if (additionalMessages) {
			messages.push(...additionalMessages);
		}

		const promptContext = this._preparePromptContext(messages);
		const compactionTimestamp = compactionEntry ? new Date(compactionEntry.timestamp).getTime() : undefined;
		const providerEstimate = estimateContextTokens(messages, this.systemPrompt, {
			sinceTimestamp: compactionTimestamp,
		});
		let reliableAssistantUsagesSinceCompaction = 0;
		if (compactionTimestamp !== undefined) {
			for (const message of messages) {
				if (
					message.role === "assistant" &&
					message.stopReason !== "aborted" &&
					message.stopReason !== "error" &&
					message.usage &&
					(message.usage.input > 0 || message.usage.cacheRead > 0) &&
					message.timestamp > compactionTimestamp
				) {
					reliableAssistantUsagesSinceCompaction++;
				}
			}
		}
		const canUseProviderUsageForThreshold =
			compactionTimestamp === undefined ||
			reliableAssistantUsagesSinceCompaction > 1 ||
			assistantForCompactionCheck?.stopReason === "error";
		const contextTokens =
			canUseProviderUsageForThreshold && providerEstimate.lastUsageIndex !== null
				? Math.max(
						promptContext.budgetEstimate.tokens,
						providerEstimate.usageTokens + providerEstimate.trailingTokens,
					)
				: promptContext.budgetEstimate.tokens;
		const hasRecordedUserRequest = branchEntries.some(
			(entry) => entry.type === "message" && entry.message.role === "user",
		);
		if (shouldCompact(contextTokens, contextWindow, settings)) {
			if (!hasRecordedUserRequest) {
				return false;
			}
			return await this._runAutoCompaction("threshold", false);
		}
		return false;
	}

	/**
	 * Internal: Run auto-compaction with events.
	 */
	private async _runAutoCompaction(reason: "overflow" | "threshold", willRetry: boolean): Promise<boolean> {
		const settings = this._getEffectiveCompactionSettings();

		try {
			const hadQueuedMessages = this.agent.hasQueuedMessages();
			const pathEntries = this.sessionManager.getBranch();
			const retryContinuationMessage = willRetry
				? [...this.agent.state.messages].reverse().find((message) => message.role === "user")
				: undefined;

			const preparationResult = prepareCompaction(pathEntries, settings, this.systemPrompt);
			if (!preparationResult.ok) {
				if (reason === "threshold") {
					return false;
				}
				this._emit({ type: "compaction_start", reason });
				this._emit({
					type: "compaction_end",
					reason,
					result: undefined,
					aborted: false,
					willRetry: false,
					errorMessage:
						reason === "overflow"
							? `Context overflow recovery failed: ${preparationResult.message}`
							: `Auto-compaction skipped: ${preparationResult.message}`,
				});
				return false;
			}
			const { preparation } = preparationResult;
			this._emit({ type: "compaction_start", reason });
			this._autoCompactionAbortController = new AbortController();

			let extensionCompaction: CompactionResult | undefined;
			let fromExtension = false;

			if (this._extensionRunner.hasHandlers("session_before_compact")) {
				const extensionResult = (await this._extensionRunner.emit({
					type: "session_before_compact",
					preparation,
					branchEntries: pathEntries,
					customInstructions: undefined,
					signal: this._autoCompactionAbortController.signal,
				})) as SessionBeforeCompactResult | undefined;

				if (extensionResult?.cancel) {
					this._emit({
						type: "compaction_end",
						reason,
						result: undefined,
						aborted: true,
						willRetry: false,
					});
					return false;
				}

				if (extensionResult?.compaction) {
					extensionCompaction = extensionResult.compaction;
					fromExtension = true;
				}
			}

			let summary: string;
			let firstKeptEntryId: string;
			let tokensBefore: number;
			let tokensAfter: number | undefined;
			let details: unknown;
			let structuredState: unknown;

			if (extensionCompaction) {
				// Extension provided compaction content
				summary = extensionCompaction.summary;
				firstKeptEntryId = extensionCompaction.firstKeptEntryId;
				tokensBefore = extensionCompaction.tokensBefore;
				tokensAfter = extensionCompaction.tokensAfter;
				details = extensionCompaction.details;
			} else {
				const compactResult = await this._prepareDefaultCompaction(
					preparation,
					pathEntries,
					settings,
					undefined,
					this._autoCompactionAbortController.signal,
				);
				summary = compactResult.summary;
				firstKeptEntryId = compactResult.firstKeptEntryId;
				tokensBefore = compactResult.tokensBefore;
				tokensAfter = compactResult.tokensAfter;
				details = compactResult.details;
				structuredState = compactResult.state;
			}

			if (this._autoCompactionAbortController.signal.aborted) {
				this._emit({
					type: "compaction_end",
					reason,
					result: undefined,
					aborted: true,
					willRetry: false,
				});
				return false;
			}

			this.sessionManager.appendCompaction(
				summary,
				firstKeptEntryId,
				tokensBefore,
				tokensAfter,
				details,
				fromExtension,
			);
			if (!fromExtension && structuredState && isStructuredSessionState(structuredState)) {
				this.sessionManager.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, structuredState);
				writeSessionStateFile(this._cwd, structuredState);
			}
			this._syncProjectMemory();
			const newEntries = this.sessionManager.getEntries();
			const sessionContext = this.sessionManager.buildSessionContext();

			// Post-compaction truncation: truncate oversized kept messages to enforce
			// the keepRecentTokens budget (last 20 lines / max 4K tokens per message).
			// This is critical for preventing large tool results from surviving compaction.
			const systemPromptTokens = this.systemPrompt ? Math.ceil(this.systemPrompt.length / 4) : 0;
			const truncatedMessages = truncateKeptMessages(sessionContext.messages, {
				keepRecentTokens: preparation.keepRecentTokens,
				targetContextTokens: settings.targetContextTokens,
				systemPromptTokens,
			});
			const retryMessagesWithoutOverflow = this._removeContextOverflowMessages(truncatedMessages);
			this.agent.state.messages = retryMessagesWithoutOverflow;
			const tokensAfterAuto = estimateContextTokens(retryMessagesWithoutOverflow, this.systemPrompt, {
				useProviderUsage: false,
			}).tokens;

			// Get the saved compaction entry for the extension event
			const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary) as
				| CompactionEntry
				| undefined;

			if (this._extensionRunner && savedCompactionEntry) {
				await this._extensionRunner.emit({
					type: "session_compact",
					compactionEntry: savedCompactionEntry,
					fromExtension,
				});
			}

			const result: CompactionResult = {
				summary,
				firstKeptEntryId,
				tokensBefore,
				tokensAfter: tokensAfterAuto,
				details,
			};
			this._emit({
				type: "compaction_end",
				reason,
				result,
				aborted: false,
				willRetry,
			});

			if (willRetry) {
				const messages = this.agent.state.messages;
				const lastMsg = messages[messages.length - 1];
				if (lastMsg?.role === "assistant" && (lastMsg as AssistantMessage).stopReason === "error") {
					this.agent.state.messages = messages.slice(0, -1);
				}
				const retryMessages = this.agent.state.messages;
				const retryLastMsg = retryMessages[retryMessages.length - 1];
				if (retryContinuationMessage && retryLastMsg?.role !== "user") {
					this.agent.state.messages = [...retryMessages, retryContinuationMessage];
				}
				return true;
			}

			// Auto-compaction can complete while follow-up/steering/custom messages are waiting.
			// Continue once so queued messages are delivered.
			return hadQueuedMessages || this.agent.hasQueuedMessages();
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "compaction failed";
			this._emit({
				type: "compaction_end",
				reason,
				result: undefined,
				aborted: false,
				willRetry: false,
				errorMessage:
					reason === "overflow"
						? `Context overflow recovery failed: ${errorMessage}`
						: `Auto-compaction failed: ${errorMessage}`,
			});
			return false;
		} finally {
			this._autoCompactionAbortController = undefined;
		}
	}

	/**
	 * Toggle auto-compaction setting.
	 */
	setAutoCompactionEnabled(enabled: boolean): void {
		this.settingsManager.setCompactionEnabled(enabled);
	}

	/** Whether auto-compaction is enabled */
	get autoCompactionEnabled(): boolean {
		return this.settingsManager.getCompactionEnabled();
	}

	private _getEffectiveCompactionSettings(): {
		enabled: boolean;
		triggerReserveTokens: number;
		triggerRatio?: number;
		keepRecentMinTokens: number;
		keepRecentMaxTokens: number;
		summaryMaxTokens: number;
		renderedStateMaxTokens: number;
		targetContextTokens: number;
	} {
		return this.settingsManager.getCompactionSettings();
	}

	async bindExtensions(bindings: ExtensionBindings): Promise<void> {
		if (bindings.uiContext !== undefined) {
			this._extensionUIContext = bindings.uiContext;
		}
		if (bindings.mode !== undefined) {
			this._extensionMode = bindings.mode;
		}
		if (bindings.commandContextActions !== undefined) {
			this._extensionCommandContextActions = bindings.commandContextActions;
		}
		if (bindings.abortHandler !== undefined) {
			this._extensionAbortHandler = bindings.abortHandler;
		}
		if (bindings.shutdownHandler !== undefined) {
			this._extensionShutdownHandler = bindings.shutdownHandler;
		}
		if (bindings.onError !== undefined) {
			this._extensionErrorListener = bindings.onError;
		}

		this._applyExtensionBindings(this._extensionRunner);
		await this._extensionRunner.emit(this._sessionStartEvent);
		await this.extendResourcesFromExtensions(this._sessionStartEvent.reason === "reload" ? "reload" : "startup");
	}

	private async extendResourcesFromExtensions(reason: "startup" | "reload"): Promise<void> {
		if (!this._extensionRunner.hasHandlers("resources_discover")) {
			return;
		}

		const { skillPaths, promptPaths, themePaths } = await this._extensionRunner.emitResourcesDiscover(
			this._cwd,
			reason,
		);

		if (skillPaths.length === 0 && promptPaths.length === 0 && themePaths.length === 0) {
			return;
		}

		const extensionPaths: ResourceExtensionPaths = {
			skillPaths: this.buildExtensionResourcePaths(skillPaths),
			promptPaths: this.buildExtensionResourcePaths(promptPaths),
			themePaths: this.buildExtensionResourcePaths(themePaths),
		};

		this._resourceLoader.extendResources(extensionPaths);
		this._baseSystemPrompt = this._rebuildSystemPrompt(this.getActiveToolNames());
		this.agent.state.systemPrompt = this._baseSystemPrompt;
	}

	private buildExtensionResourcePaths(entries: Array<{ path: string; extensionPath: string }>): Array<{
		path: string;
		metadata: {
			source: string;
			scope: "temporary";
			origin: "top-level";
			baseDir?: string;
		};
	}> {
		return entries.map((entry) => {
			const source = this.getExtensionSourceLabel(entry.extensionPath);
			const baseDir = entry.extensionPath.startsWith("<") ? undefined : dirname(entry.extensionPath);
			return {
				path: entry.path,
				metadata: {
					source,
					scope: "temporary",
					origin: "top-level",
					baseDir,
				},
			};
		});
	}

	private getExtensionSourceLabel(extensionPath: string): string {
		if (extensionPath.startsWith("<")) {
			return `extension:${extensionPath.replace(/[<>]/g, "")}`;
		}
		const base = basename(extensionPath);
		const name = base.replace(/\.(ts|js)$/, "");
		return `extension:${name}`;
	}

	private _applyExtensionBindings(runner: ExtensionRunner): void {
		runner.setUIContext(this._extensionUIContext, this._extensionMode);
		runner.bindCommandContext(this._extensionCommandContextActions);

		this._extensionErrorUnsubscriber?.();
		this._extensionErrorUnsubscriber = this._extensionErrorListener
			? runner.onError(this._extensionErrorListener)
			: undefined;
	}

	private _refreshCurrentModelFromRegistry(): void {
		const currentModel = this.model;
		if (!currentModel) {
			return;
		}

		const refreshedModel = this._modelRegistry.find(currentModel.provider, currentModel.id);
		if (!refreshedModel || refreshedModel === currentModel) {
			return;
		}

		this.agent.state.model = refreshedModel;
	}

	private _bindExtensionCore(runner: ExtensionRunner): void {
		const getCommands = (): SlashCommandInfo[] => {
			const extensionCommands: SlashCommandInfo[] = runner.getRegisteredCommands().map((command) => ({
				name: command.invocationName,
				description: command.description,
				source: "extension",
				sourceInfo: command.sourceInfo,
			}));

			const templates: SlashCommandInfo[] = this.promptTemplates.map((template) => ({
				name: template.name,
				description: template.description,
				source: "prompt",
				sourceInfo: template.sourceInfo,
			}));

			const skills: SlashCommandInfo[] = this._resourceLoader.getSkills().skills.map((skill) => ({
				name: `skill:${skill.name}`,
				description: skill.description,
				source: "skill",
				sourceInfo: skill.sourceInfo,
			}));

			return [...extensionCommands, ...templates, ...skills];
		};

		runner.bindCore(
			{
				sendMessage: (message, options) => {
					this.sendCustomMessage(message, options).catch((err) => {
						runner.emitError({
							extensionPath: "<runtime>",
							event: "send_message",
							error: err instanceof Error ? err.message : String(err),
						});
					});
				},
				sendUserMessage: (content, options) => {
					this.sendUserMessage(content, options).catch((err) => {
						runner.emitError({
							extensionPath: "<runtime>",
							event: "send_user_message",
							error: err instanceof Error ? err.message : String(err),
						});
					});
				},
				appendEntry: (customType, data) => {
					this.sessionManager.appendCustomEntry(customType, data);
				},
				setSessionName: (name) => {
					this.setSessionName(name);
				},
				getSessionName: () => {
					return this.sessionManager.getSessionName();
				},
				setLabel: (entryId, label) => {
					this.sessionManager.appendLabelChange(entryId, label);
				},
				getActiveTools: () => this.getActiveToolNames(),
				getAllTools: () => this.getAllTools(),
				setActiveTools: (toolNames) => this.setActiveToolsByName(toolNames),
				refreshTools: () => this._refreshToolRegistry({ includeAllExtensionTools: this._includeAllExtensionTools }),
				getCommands,
				setModel: async (model) => {
					if (!this.modelRegistry.hasConfiguredAuth(model)) return false;
					await this.setModel(model);
					return true;
				},
				getThinkingLevel: () => this.thinkingLevel,
				setThinkingLevel: (level) => this.setThinkingLevel(level),
			},
			{
				getModel: () => this.model,
				isIdle: () => !this.isStreaming,
				isProjectTrusted: () => this.settingsManager.isProjectTrusted(),
				getSignal: () => this.agent.signal,
				abort: () => {
					if (this._extensionAbortHandler) {
						this._extensionAbortHandler();
						return;
					}
					void this.abort();
				},
				hasPendingMessages: () => this.pendingMessageCount > 0,
				shutdown: () => {
					this._extensionShutdownHandler?.();
				},
				getContextUsage: () => this.getContextUsage(),
				compact: (options) => {
					void (async () => {
						try {
							const result = await this.compact(options?.customInstructions);
							options?.onComplete?.(result);
						} catch (error) {
							const err = error instanceof Error ? error : new Error(String(error));
							options?.onError?.(err);
						}
					})();
				},
				getSystemPrompt: () => this.systemPrompt,
				getSystemPromptOptions: () => this._baseSystemPromptOptions,
			},
			{
				registerProvider: (name, config) => {
					this._modelRegistry.registerProvider(name, config);
					this._refreshCurrentModelFromRegistry();
				},
				unregisterProvider: (name) => {
					this._modelRegistry.unregisterProvider(name);
					this._refreshCurrentModelFromRegistry();
				},
			},
		);
	}

	private _refreshToolRegistry(options?: { activeToolNames?: string[]; includeAllExtensionTools?: boolean }): void {
		const previousActiveToolNames = this.getActiveToolNames();
		const allowedToolNames = this._allowedToolNames;
		const excludedToolNames = this._excludedToolNames;
		const isAllowedTool = (name: string): boolean =>
			(!allowedToolNames || allowedToolNames.has(name)) && !excludedToolNames?.has(name);

		const registeredTools = this._extensionRunner.getAllRegisteredTools();
		const allCustomTools = [
			...registeredTools,
			...this._customTools.map((definition) => ({
				definition,
				sourceInfo: createSyntheticSourceInfo(`<sdk:${definition.name}>`, {
					source: "sdk",
				}),
			})),
		].filter((tool) => isAllowedTool(tool.definition.name));
		const definitionRegistry = new Map<string, ToolDefinitionEntry>(
			Array.from(this._baseToolDefinitions.entries())
				.filter(([name]) => isAllowedTool(name))
				.map(([name, definition]) => [
					name,
					{
						definition,
						sourceInfo: createSyntheticSourceInfo(`<builtin:${name}>`, {
							source: "builtin",
						}),
					},
				]),
		);
		for (const tool of allCustomTools) {
			definitionRegistry.set(tool.definition.name, {
				definition: tool.definition,
				sourceInfo: tool.sourceInfo,
			});
		}
		this._toolDefinitions = definitionRegistry;
		this._toolPromptSnippets = new Map(
			Array.from(definitionRegistry.values())
				.map(({ definition }) => {
					const snippet = this._normalizePromptSnippet(definition.promptSnippet);
					return snippet ? ([definition.name, snippet] as const) : undefined;
				})
				.filter((entry): entry is readonly [string, string] => entry !== undefined),
		);
		this._toolPromptGuidelines = new Map(
			Array.from(definitionRegistry.values())
				.map(({ definition }) => {
					const guidelines = this._normalizePromptGuidelines(definition.promptGuidelines);
					return guidelines.length > 0 ? ([definition.name, guidelines] as const) : undefined;
				})
				.filter((entry): entry is readonly [string, string[]] => entry !== undefined),
		);
		const runner = this._extensionRunner;
		const wrappedExtensionTools = wrapRegisteredTools(allCustomTools, runner);
		const wrappedBuiltInTools = wrapRegisteredTools(
			Array.from(this._baseToolDefinitions.values())
				.filter((definition) => isAllowedTool(definition.name))
				.map((definition) => ({
					definition,
					sourceInfo: createSyntheticSourceInfo(`<builtin:${definition.name}>`, { source: "builtin" }),
				})),
			runner,
		);

		const toolRegistry = new Map(wrappedBuiltInTools.map((tool) => [tool.name, tool]));
		for (const tool of wrappedExtensionTools as AgentTool[]) {
			toolRegistry.set(tool.name, tool);
		}
		this._toolRegistry = toolRegistry;

		const nextActiveToolNames = (
			options?.activeToolNames ? [...options.activeToolNames] : [...previousActiveToolNames]
		).filter((name) => isAllowedTool(name));

		if (allowedToolNames) {
			for (const toolName of this._toolRegistry.keys()) {
				if (allowedToolNames.has(toolName)) {
					nextActiveToolNames.push(toolName);
				}
			}
		} else if (options?.includeAllExtensionTools) {
			for (const tool of wrappedExtensionTools) {
				nextActiveToolNames.push(tool.name);
			}
		}

		this.setActiveToolsByName([...new Set(nextActiveToolNames)]);
	}

	private _buildRuntime(options: {
		activeToolNames?: string[];
		flagValues?: Map<string, boolean | string>;
		includeAllExtensionTools?: boolean;
	}): void {
		const autoResizeImages = this.settingsManager.getImageAutoResize();
		const shellCommandPrefix = this.settingsManager.getShellCommandPrefix();
		const shellPath = this.settingsManager.getShellPath();
		const baseToolDefinitions = this._baseToolsOverride
			? Object.fromEntries(
					Object.entries(this._baseToolsOverride).map(([name, tool]) => [
						name,
						createToolDefinitionFromAgentTool(tool),
					]),
				)
			: createAllToolDefinitions(this._cwd, {
					read: { autoResizeImages },
					bash: {
						commandPrefix: shellCommandPrefix,
						shellPath,
						onResult: (context) =>
							this._verificationLedger.record(context.command, {
								exitCode: context.exitCode ?? undefined,
								truncated: context.truncated,
								fullLogPointer: context.fullOutputPath,
							}),
					},
				});
		const builtInToolDefinitions: Record<string, ToolDefinition> = {
			...baseToolDefinitions,
			[UPDATE_SESSION_STATE_TOOL_NAME]: this._createUpdateSessionStateToolDefinition() as unknown as ToolDefinition,
			[MARK_SESSION_PROGRESS_TOOL_NAME]:
				this._createMarkSessionProgressToolDefinition() as unknown as ToolDefinition,
			submit_plan: createSubmitPlanToolDefinition({
				onApproved: () => this.disablePlanMode(),
			}) as unknown as ToolDefinition,
			session_recall: this._createSessionRecallToolDefinition() as unknown as ToolDefinition,
			keep_context: this._createKeepContextToolDefinition() as unknown as ToolDefinition,
			run_subagent: this._createRunSubagentToolDefinition() as unknown as ToolDefinition,
			[TOOL_SEARCH_TOOL_NAME]: this._createToolSearchToolDefinition() as unknown as ToolDefinition,
			finish_work: createFinishWorkToolDefinition({
				gateCheck: {
					check: (input) => {
						if (input.status !== "success") return null;
						const gate = this._verificationLedger.gate();
						if (!gate) return null;
						const failureLines = gate.failures.map((f) => `  - ${f.command} (exit ${f.exitCode})`);
						return [
							`Required verification checks failed. Cannot finish with success.`,
							`Failures:`,
							...failureLines,
							`Run the failing commands or use status "partial" / "failed" to proceed.`,
						].join("\n");
					},
				},
			}) as unknown as ToolDefinition,
		};

		this._baseToolDefinitions = new Map(
			Object.entries(builtInToolDefinitions).map(([name, tool]) => [name, tool as ToolDefinition]),
		);

		const extensionsResult = this._resourceLoader.getExtensions();
		if (options.flagValues) {
			for (const [name, value] of options.flagValues) {
				extensionsResult.runtime.flagValues.set(name, value);
			}
		}

		this._extensionRunner = new ExtensionRunner(
			extensionsResult.extensions,
			extensionsResult.runtime,
			this._cwd,
			this.sessionManager,
			this._modelRegistry,
		);
		if (this._extensionRunnerRef) {
			this._extensionRunnerRef.current = this._extensionRunner;
		}
		this._bindExtensionCore(this._extensionRunner);
		this._applyExtensionBindings(this._extensionRunner);

		const defaultActiveToolNames = this._baseToolsOverride
			? Object.keys(this._baseToolsOverride)
			: [
					"read",
					"bash",
					"edit",
					"write",
					"sleep",
					UPDATE_SESSION_STATE_TOOL_NAME,
					MARK_SESSION_PROGRESS_TOOL_NAME,
					TOOL_SEARCH_TOOL_NAME,
				];
		const baseActiveToolNames = options.activeToolNames ?? defaultActiveToolNames;
		this._refreshToolRegistry({
			activeToolNames: baseActiveToolNames,
			includeAllExtensionTools: options.includeAllExtensionTools,
		});
	}

	async reload(): Promise<void> {
		const previousFlagValues = this._extensionRunner.getFlagValues();
		await emitSessionShutdownEvent(this._extensionRunner, {
			type: "session_shutdown",
			reason: "reload",
		});
		await this.settingsManager.reload();
		this.syncQueueModesFromSettings();
		resetApiProviders();
		await this._resourceLoader.reload();
		this._buildRuntime({
			activeToolNames: this.getActiveToolNames(),
			flagValues: previousFlagValues,
			includeAllExtensionTools: this._includeAllExtensionTools,
		});

		const hasBindings =
			this._extensionUIContext ||
			this._extensionCommandContextActions ||
			this._extensionShutdownHandler ||
			this._extensionErrorListener;
		if (hasBindings) {
			await this._extensionRunner.emit({
				type: "session_start",
				reason: "reload",
			});
			await this.extendResourcesFromExtensions("reload");
		}
	}

	// =========================================================================
	// Auto-Retry
	// =========================================================================

	private _isNonRetryableProviderLimitError(errorMessage: string): boolean {
		return /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing/i.test(
			errorMessage,
		);
	}

	/**
	 * Check if an error is retryable (overloaded, rate limit, server errors).
	 * Context overflow errors are NOT retryable (handled by compaction instead).
	 */
	private _isRetryableError(message: AssistantMessage): boolean {
		if (message.stopReason !== "error" || !message.errorMessage) return false;

		// Context overflow is handled by compaction, not retry
		const contextWindow = this.model?.contextWindow ?? 0;
		if (isContextOverflow(message, contextWindow)) return false;

		const err = message.errorMessage;
		if (this._isNonRetryableProviderLimitError(err)) return false;
		return RETRYABLE_ERROR_PATTERN.test(err);
	}

	/**
	 * Prepare a retryable error for continuation with exponential backoff.
	 * @returns true if the caller should continue the agent, false otherwise
	 */
	private async _prepareRetry(message: AssistantMessage): Promise<boolean> {
		const settings = this.settingsManager.getRetrySettings();
		if (!settings.enabled) {
			return false;
		}
		const maxRetries = this._getEffectiveRetryMaxAttempts(message, settings.maxRetries);

		this._retryAttempt++;

		if (this._retryAttempt > maxRetries) {
			// Preserve the completed attempt count so post-run handling can emit the final failure.
			this._retryAttempt--;
			return false;
		}

		const delayMs = this._getRetryDelayMs(message, this._retryAttempt, settings.baseDelayMs);

		this._emit({
			type: "auto_retry_start",
			attempt: this._retryAttempt,
			maxAttempts: maxRetries,
			delayMs,
			errorMessage: message.errorMessage || "Unknown error",
			reason: this._getRetryReason(message),
		});

		// Remove error message from agent state (keep in session for history)
		const messages = this.agent.state.messages;
		if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
			this.agent.state.messages = messages.slice(0, -1);
		}

		// Wait with exponential backoff (abortable)
		this._retryAbortController = new AbortController();
		try {
			await sleep(delayMs, this._retryAbortController.signal);
		} catch {
			// Aborted during sleep - emit end event so UI can clean up
			const attempt = this._retryAttempt;
			this._retryAttempt = 0;
			this._emit({
				type: "auto_retry_end",
				success: false,
				attempt,
				finalError: "Retry cancelled",
			});
			return false;
		} finally {
			this._retryAbortController = undefined;
		}

		return true;
	}

	private _getEffectiveRetryMaxAttempts(message: AssistantMessage, configuredMaxRetries: number): number {
		if (MODEL_RECOVERY_RETRY_PATTERN.test(message.errorMessage ?? "")) {
			return Math.max(configuredMaxRetries, MODEL_RECOVERY_MIN_RETRIES);
		}
		return configuredMaxRetries;
	}

	private _getRetryReason(message: AssistantMessage): "model_loading" | "transient" {
		return MODEL_RECOVERY_RETRY_PATTERN.test(message.errorMessage ?? "") ? "model_loading" : "transient";
	}

	private _getRetryDelayMs(message: AssistantMessage, attempt: number, baseDelayMs: number): number {
		if (!MODEL_RECOVERY_RETRY_PATTERN.test(message.errorMessage ?? "")) {
			return baseDelayMs * 2 ** (attempt - 1);
		}
		const modelRecoveryDelayMs = Math.max(baseDelayMs, MODEL_RECOVERY_BASE_DELAY_MS) * attempt;
		return Math.min(modelRecoveryDelayMs, MODEL_RECOVERY_MAX_RETRY_DELAY_MS);
	}

	/**
	 * Cancel in-progress retry.
	 */
	abortRetry(): void {
		this._retryAbortController?.abort();
	}

	/** Whether auto-retry is currently in progress */
	get isRetrying(): boolean {
		return this._retryAbortController !== undefined;
	}

	/** Whether auto-retry is enabled */
	get autoRetryEnabled(): boolean {
		return this.settingsManager.getRetryEnabled();
	}

	/**
	 * Toggle auto-retry setting.
	 */
	setAutoRetryEnabled(enabled: boolean): void {
		this.settingsManager.setRetryEnabled(enabled);
	}

	// =========================================================================
	// Bash Execution
	// =========================================================================

	/**
	 * Execute a bash command.
	 * Adds result to agent context and session.
	 * @param command The bash command to execute
	 * @param onChunk Optional streaming callback for output
	 * @param options.excludeFromContext If true, command output won't be sent to LLM (!! prefix)
	 * @param options.operations Custom BashOperations for remote execution
	 */
	async executeBash(
		command: string,
		onChunk?: (chunk: string) => void,
		options?: { excludeFromContext?: boolean; operations?: BashOperations },
	): Promise<BashResult> {
		const guardrails = evaluateGuardrails({
			cwd: this._cwd,
			command,
			phase: "bash",
			recentCommands: this._recentBashCommands,
		});
		if (!guardrails.ok) {
			const blocker = guardrails.results.find((item) => !item.ok && item.severity === "critical");
			throw new Error(blocker?.message ?? "Bash command blocked by executable guardrail.");
		}
		this._bashAbortController = new AbortController();

		// Apply command prefix if configured (e.g., "shopt -s expand_aliases" for alias support)
		const prefix = this.settingsManager.getShellCommandPrefix();
		const shellPath = this.settingsManager.getShellPath();
		const resolvedCommand = prefix ? `${prefix}\n${command}` : command;

		try {
			const result = await executeBashWithOperations(
				resolvedCommand,
				this.sessionManager.getCwd(),
				options?.operations ?? createLocalBashOperations({ shellPath }),
				{
					onChunk,
					signal: this._bashAbortController.signal,
				},
			);

			this.recordBashResult(command, result, options);
			return result;
		} finally {
			this._bashAbortController = undefined;
		}
	}

	private _rememberBashCommand(command: string): void {
		this._recentBashCommands.push(command);
		if (this._recentBashCommands.length > 50) {
			this._recentBashCommands = this._recentBashCommands.slice(-50);
		}
	}

	/**
	 * Record a bash execution result in session history.
	 * Used by executeBash and by extensions that handle bash execution themselves.
	 */
	recordBashResult(command: string, result: BashResult, options?: { excludeFromContext?: boolean }): void {
		this._rememberBashCommand(command);

		// Record in verification ledger
		this._verificationLedger.record(command, {
			exitCode: result.exitCode,
			signal: result.cancelled ? undefined : undefined,
			truncated: result.truncated,
			fullLogPointer: result.fullOutputPath,
		});

		const bashMessage: BashExecutionMessage = {
			role: "bashExecution",
			command,
			output: result.output,
			exitCode: result.exitCode,
			cancelled: result.cancelled,
			truncated: result.truncated,
			fullOutputPath: result.fullOutputPath,
			timestamp: Date.now(),
			excludeFromContext: options?.excludeFromContext,
		};

		// If agent is streaming, defer adding to avoid breaking tool_use/tool_result ordering
		if (this.isStreaming) {
			// Queue for later - will be flushed on agent_end
			this._pendingBashMessages.push(bashMessage);
		} else {
			// Add to agent state immediately
			this.agent.state.messages.push(bashMessage);

			// Save to session
			this.sessionManager.appendMessage(bashMessage);
		}
	}

	/**
	 * Cancel running bash command.
	 */
	abortBash(): void {
		this._bashAbortController?.abort();
	}

	/** Whether a bash command is currently running */
	get isBashRunning(): boolean {
		return this._bashAbortController !== undefined;
	}

	/** Whether there are pending bash messages waiting to be flushed */
	get hasPendingBashMessages(): boolean {
		return this._pendingBashMessages.length > 0;
	}

	/**
	 * Flush pending bash messages to agent state and session.
	 * Called after agent turn completes to maintain proper message ordering.
	 */
	private _flushPendingBashMessages(): void {
		if (this._pendingBashMessages.length === 0) return;

		for (const bashMessage of this._pendingBashMessages) {
			// Add to agent state
			this.agent.state.messages.push(bashMessage);

			// Save to session
			this.sessionManager.appendMessage(bashMessage);
		}

		this._pendingBashMessages = [];
	}

	// =========================================================================
	// Session Management
	// =========================================================================

	/**
	 * Set a display name for the current session.
	 */
	setSessionName(name: string): void {
		this.sessionManager.appendSessionInfo(name);
		this._emit({
			type: "session_info_changed",
			name: this.sessionManager.getSessionName(),
		});
	}

	// =========================================================================
	// Tree Navigation
	// =========================================================================

	/**
	 * Navigate to a different node in the session tree.
	 * Unlike fork() which creates a new session file, this stays in the same file.
	 *
	 * @param targetId The entry ID to navigate to
	 * @param options.summarize Whether user wants to summarize abandoned branch
	 * @param options.customInstructions Custom instructions for summarizer
	 * @param options.replaceInstructions If true, customInstructions replaces the default prompt
	 * @param options.label Label to attach to the branch summary entry
	 * @returns Result with editorText (if user message) and cancelled status
	 */
	async navigateTree(
		targetId: string,
		options: {
			summarize?: boolean;
			customInstructions?: string;
			replaceInstructions?: boolean;
			label?: string;
		} = {},
	): Promise<{
		editorText?: string;
		cancelled: boolean;
		aborted?: boolean;
		summaryEntry?: BranchSummaryEntry;
	}> {
		const oldLeafId = this.sessionManager.getLeafId();

		// No-op if already at target
		if (targetId === oldLeafId) {
			return { cancelled: false };
		}

		// Model required for summarization
		if (options.summarize && !this.model) {
			throw new Error("No model available for summarization");
		}

		const targetEntry = this.sessionManager.getEntry(targetId);
		if (!targetEntry) {
			throw new Error(`Entry ${targetId} not found`);
		}

		// Collect entries to summarize (from old leaf to common ancestor)
		const { entries: entriesToSummarize, commonAncestorId } = collectEntriesForBranchSummary(
			this.sessionManager,
			oldLeafId,
			targetId,
		);

		// Prepare event data - mutable so extensions can override
		let customInstructions = options.customInstructions;
		let replaceInstructions = options.replaceInstructions;
		let label = options.label;

		const preparation: TreePreparation = {
			targetId,
			oldLeafId,
			commonAncestorId,
			entriesToSummarize,
			userWantsSummary: options.summarize ?? false,
			customInstructions,
			replaceInstructions,
			label,
		};

		// Set up abort controller for summarization
		this._branchSummaryAbortController = new AbortController();

		try {
			let extensionSummary: { summary: string; details?: unknown } | undefined;
			let fromExtension = false;

			// Emit session_before_tree event
			if (this._extensionRunner.hasHandlers("session_before_tree")) {
				const result = (await this._extensionRunner.emit({
					type: "session_before_tree",
					preparation,
					signal: this._branchSummaryAbortController.signal,
				})) as SessionBeforeTreeResult | undefined;

				if (result?.cancel) {
					return { cancelled: true };
				}

				if (result?.summary && options.summarize) {
					extensionSummary = result.summary;
					fromExtension = true;
				}

				// Allow extensions to override instructions and label
				if (result?.customInstructions !== undefined) {
					customInstructions = result.customInstructions;
				}
				if (result?.replaceInstructions !== undefined) {
					replaceInstructions = result.replaceInstructions;
				}
				if (result?.label !== undefined) {
					label = result.label;
				}
			}

			// Run default summarizer if needed
			let summaryText: string | undefined;
			let summaryDetails: unknown;
			if (options.summarize && entriesToSummarize.length > 0 && !extensionSummary) {
				const model = this.model!;
				const { apiKey, headers } = await this._getRequiredRequestAuth(model);
				const branchSummarySettings = this.settingsManager.getBranchSummarySettings();
				const result = await generateBranchSummary(entriesToSummarize, {
					model,
					apiKey,
					headers,
					signal: this._branchSummaryAbortController.signal,
					customInstructions,
					replaceInstructions,
					reserveTokens: branchSummarySettings.reserveTokens,
					streamFn: this.agent.streamFn,
				});
				if (result.aborted) {
					return { cancelled: true, aborted: true };
				}
				if (result.error) {
					throw new Error(result.error);
				}
				summaryText = result.summary;
				summaryDetails = {
					readFiles: result.readFiles || [],
					modifiedFiles: result.modifiedFiles || [],
				};
			} else if (extensionSummary) {
				summaryText = extensionSummary.summary;
				summaryDetails = extensionSummary.details;
			}

			// Determine the new leaf position based on target type
			let newLeafId: string | null;
			let editorText: string | undefined;

			if (targetEntry.type === "message" && targetEntry.message.role === "user") {
				// User message: leaf = parent (null if root), text goes to editor
				newLeafId = targetEntry.parentId;
				editorText = this._extractUserMessageText(targetEntry.message.content);
			} else if (targetEntry.type === "custom_message") {
				// Custom message: leaf = parent (null if root), text goes to editor
				newLeafId = targetEntry.parentId;
				editorText =
					typeof targetEntry.content === "string"
						? targetEntry.content
						: targetEntry.content
								.filter((c): c is { type: "text"; text: string } => c.type === "text")
								.map((c) => c.text)
								.join("");
			} else {
				// Non-user message: leaf = selected node
				newLeafId = targetId;
			}

			// Switch leaf (with or without summary)
			// Summary is attached at the navigation target position (newLeafId), not the old branch
			let summaryEntry: BranchSummaryEntry | undefined;
			if (summaryText) {
				// Create summary at target position (can be null for root)
				const summaryId = this.sessionManager.branchWithSummary(
					newLeafId,
					summaryText,
					summaryDetails,
					fromExtension,
				);
				summaryEntry = this.sessionManager.getEntry(summaryId) as BranchSummaryEntry;

				// Attach label to the summary entry
				if (label) {
					this.sessionManager.appendLabelChange(summaryId, label);
				}
			} else if (newLeafId === null) {
				// No summary, navigating to root - reset leaf
				this.sessionManager.resetLeaf();
			} else {
				// No summary, navigating to non-root
				this.sessionManager.branch(newLeafId);
			}

			// Attach label to target entry when not summarizing (no summary entry to label)
			if (label && !summaryText) {
				this.sessionManager.appendLabelChange(targetId, label);
			}

			// Update agent state
			const sessionContext = this.sessionManager.buildSessionContext();
			const settings = this.settingsManager.getCompactionSettings();
			const systemPromptTokens = this.systemPrompt ? Math.ceil(this.systemPrompt.length / 4) : 0;
			const keepRecentTokens = selectKeepRecentTokens(
				estimateContextTokens(sessionContext.messages, this.systemPrompt).tokens,
				settings,
			);
			this.agent.state.messages = truncateKeptMessages(sessionContext.messages, {
				keepRecentTokens,
				targetContextTokens: settings.targetContextTokens,
				systemPromptTokens,
			});

			// Emit session_tree event
			await this._extensionRunner.emit({
				type: "session_tree",
				newLeafId: this.sessionManager.getLeafId(),
				oldLeafId,
				summaryEntry,
				fromExtension: summaryText ? fromExtension : undefined,
			});

			// Emit to custom tools

			return { editorText, cancelled: false, summaryEntry };
		} finally {
			this._branchSummaryAbortController = undefined;
		}
	}

	/**
	 * Get all user messages from session for fork selector.
	 */
	getUserMessagesForForking(): Array<{ entryId: string; text: string }> {
		const entries = this.sessionManager.getEntries();
		const result: Array<{ entryId: string; text: string }> = [];

		for (const entry of entries) {
			if (entry.type !== "message") continue;
			if (entry.message.role !== "user") continue;

			const text = this._extractUserMessageText(entry.message.content);
			if (text) {
				result.push({ entryId: entry.id, text });
			}
		}

		return result;
	}

	private _extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("");
		}
		return "";
	}

	/**
	 * Get session statistics.
	 */
	getSessionStats(): SessionStats {
		const messages = this.messages;
		const userMessages = messages.filter((m) => m.role === "user").length;
		const assistantMessages = messages.filter((m) => m.role === "assistant").length;
		const toolResults = messages.filter((m) => m.role === "toolResult").length;

		let toolCalls = 0;
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;

		for (const message of messages) {
			if (message.role === "assistant") {
				const assistantMsg = message as AssistantMessage;
				toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
				totalInput += assistantMsg.usage.input;
				totalOutput += assistantMsg.usage.output;
				totalCacheRead += assistantMsg.usage.cacheRead;
				totalCacheWrite += assistantMsg.usage.cacheWrite;
				totalCost += assistantMsg.usage.cost.total;
			}
		}

		return {
			sessionFile: this.sessionFile,
			sessionId: this.sessionId,
			userMessages,
			assistantMessages,
			toolCalls,
			toolResults,
			totalMessages: messages.length,
			tokens: {
				input: totalInput,
				output: totalOutput,
				cacheRead: totalCacheRead,
				cacheWrite: totalCacheWrite,
				total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
			},
			cost: totalCost,
			contextUsage: this.getContextUsage(),
		};
	}

	/**
	 * Get the effective compacted message history, including any uncommitted pending messages
	 * from the current turn (which haven't been appended to the session manager yet).
	 */
	private _getEffectiveCompactedMessages(): AgentMessage[] {
		return this.agent.state.messages;
	}

	private _getLatestCompactionTimestamp(): number | undefined {
		const compactionEntry = getLatestCompactionEntry(this.sessionManager.getBranch());
		return compactionEntry ? new Date(compactionEntry.timestamp).getTime() : undefined;
	}

	getContextUsage(): ContextUsage | undefined {
		const model = this.model;
		if (!model) return undefined;

		const contextWindow = model.contextWindow ?? 0;
		if (contextWindow <= 0) return undefined;

		const settings = this.settingsManager.getCompactionSettings();
		const effectiveMessages = this._getEffectiveCompactedMessages();
		const promptContext = this._preparePromptContext(effectiveMessages);
		const providerEstimate = estimateContextTokens(promptContext.messages, this.systemPrompt, {
			sinceTimestamp: this._getLatestCompactionTimestamp(),
		});
		const estimate = providerEstimate.lastUsageIndex === null ? promptContext.budgetEstimate : providerEstimate;
		const source = providerEstimate.lastUsageIndex === null ? promptContext.source : "provider_usage";
		const budget = createContextBudgetReport(promptContext.budgetEstimate.tokens, contextWindow, settings);
		const contextTokens =
			estimate.lastUsageIndex === null
				? Math.max(0, estimate.tokens - estimate.staticTokens)
				: estimate.usageTokens + estimate.trailingTokens;
		const percent = (contextTokens / contextWindow) * 100;
		const tokenBreakdown = this._createTokenBreakdownForPrompt(promptContext.messages, {
			source,
			totalOverride: estimate.tokens,
			toolRawTokens: promptContext.toolRawTokens,
		});
		this._lastTokenBreakdown = tokenBreakdown;

		return {
			tokens: contextTokens,
			contextWindow,
			percent,
			staticTokens: estimate.staticTokens,
			triggerThreshold: budget.triggerThreshold,
			triggerReserveTokens: budget.triggerReserveTokens,
			triggerRatio: budget.triggerRatio,
			targetContextTokens: budget.targetContextTokens,
			remainingTokens: budget.remainingTokens,
			shouldCompact: budget.shouldCompact,
			toolRawTokens: promptContext.toolRawTokens,
			tokenBreakdown,
		};
	}

	/**
	 * Export session to HTML.
	 * @param outputPath Optional output path (defaults to session directory)
	 * @returns Path to exported file
	 */
	async exportToHtml(outputPath?: string): Promise<string> {
		const configuredThemeName = this.settingsManager.getTheme();
		const themeName = configuredThemeName && getThemeByName(configuredThemeName) ? configuredThemeName : undefined;

		// Create tool renderer if we have an extension runner (for custom tool HTML rendering)
		const toolRenderer: ToolHtmlRenderer = createToolHtmlRenderer({
			getToolDefinition: (name) => this.getToolDefinition(name),
			theme,
			cwd: this.sessionManager.getCwd(),
		});

		return await exportSessionToHtml(this.sessionManager, this.state, {
			outputPath,
			themeName,
			toolRenderer,
		});
	}

	/**
	 * Export the current session branch to a JSONL file.
	 * Writes the session header followed by all entries on the current branch path.
	 * @param outputPath Target file path. If omitted, generates a timestamped file in cwd.
	 * @returns The resolved output file path.
	 */
	exportToJsonl(outputPath?: string): string {
		const filePath = resolvePath(
			outputPath ?? `session-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
			process.cwd(),
		);
		const dir = dirname(filePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		const header: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: this.sessionManager.getSessionId(),
			timestamp: new Date().toISOString(),
			cwd: this.sessionManager.getCwd(),
		};

		const branchEntries = this.sessionManager.getBranch();
		const lines = [JSON.stringify(header)];

		// Re-chain parentIds to form a linear sequence
		let prevId: string | null = null;
		for (const entry of branchEntries) {
			const linear = { ...entry, parentId: prevId };
			lines.push(JSON.stringify(linear));
			prevId = entry.id;
		}

		writeFileSync(filePath, `${lines.join("\n")}\n`);
		return filePath;
	}

	// =========================================================================
	// Utilities
	// =========================================================================

	/**
	 * Get text content of last assistant message.
	 * Useful for /copy command.
	 * @returns Text content, or undefined if no assistant message exists
	 */
	getLastAssistantText(): string | undefined {
		const lastAssistant = this.agent.state.messages
			.slice()
			.reverse()
			.find((m) => {
				if (m.role !== "assistant") return false;
				const msg = m as AssistantMessage;
				// Skip aborted messages with no content
				if (msg.stopReason === "aborted" && msg.content.length === 0) return false;
				return true;
			});

		if (!lastAssistant) return undefined;

		let text = "";
		for (const content of (lastAssistant as AssistantMessage).content) {
			if (content.type === "text") {
				text += content.text;
			}
		}

		return text.trim() || undefined;
	}

	// =========================================================================
	// Extension System
	// =========================================================================

	createReplacedSessionContext(): ReplacedSessionContext {
		const context = Object.defineProperties(
			{},
			Object.getOwnPropertyDescriptors(this._extensionRunner.createCommandContext()),
		) as ReplacedSessionContext;
		context.sendMessage = (message, options) => this.sendCustomMessage(message, options);
		context.sendUserMessage = (content, options) => this.sendUserMessage(content, options);
		return context;
	}

	/**
	 * Check if extensions have handlers for a specific event type.
	 */
	hasExtensionHandlers(eventType: string): boolean {
		return this._extensionRunner.hasHandlers(eventType);
	}

	/**
	 * Get the extension runner (for setting UI context and error handlers).
	 */
	get extensionRunner(): ExtensionRunner {
		return this._extensionRunner;
	}
}
