import type { AgentMessage } from "@dst0/p-agent-core";
import type { AssistantMessage } from "@dst0/p-ai";
import type { BashResult } from "../bash-executor.ts";
import type {
  CompactionDetails,
  CompactionPreparation,
  CompactionResult,
  CompactionSettings,
  StatePatch,
  StructuredSessionState,
} from "../compaction/index.ts";
import type { ContextUsage, ExtensionRunner, ReplacedSessionContext, ToolDefinition } from "../extensions/index.ts";
import type { ConstraintPhase, GuardrailReport } from "../guardrails.ts";
import type { CustomMessage } from "../messages.ts";
import type {
  ProjectMemoryForgetResult,
  ProjectMemoryInitResult,
  ProjectMemoryPinResult,
  ProjectMemorySearchResult,
} from "../project-memory.ts";
import type { RuleExplainResult, RuleLintResult } from "../project-rules.ts";
import type { RepoMap } from "../repo-map.ts";
import type { BranchSummaryEntry, SessionEntry } from "../session-manager.ts";
import type { RunSubagentInput, RunSubagentResult, SubagentDigest, SubagentName } from "../subagents.ts";
import type { TokenBreakdown } from "../token-accounting.ts";
import type { BashOperations } from "../tools/bash.ts";
import type {
  KEEP_CONTEXT_SCHEMA,
  MARK_SESSION_PROGRESS_SCHEMA,
  RUN_SUBAGENT_SCHEMA,
  SESSION_RECALL_SCHEMA,
  TOOL_SEARCH_SCHEMA,
  UPDATE_SESSION_STATE_SCHEMA,
} from "./constants.ts";
import type {
  CompactionDryRunResult,
  ExtensionBindings,
  SessionRecallInput,
  SessionStats,
  ToolSearchResult,
  UpdateSessionStateInput,
} from "./session-types.ts";
import type {
  MarkSessionProgressInput,
  MarkSessionProgressResult,
  ProjectRuleGate,
  PromptContextPreparation,
  RecallCandidate,
  RecallResult,
  UpdateSessionStateResult,
  WorkingStatePromptInsertionOptions,
} from "./state-types.ts";

export interface AgentSessionRuntimeMethods {
  _createToolPromptAccountingText(): string;
  _installPromptContextTransform(): void;
  _createWorkingStatePromptMessage(content: string, timestamp: number): CustomMessage;
  _createRuntimeContextPromptMessage(
    content: string,
    timestamp: number,
    projectRuleGate?: ProjectRuleGate,
  ): CustomMessage;
  _withWorkingStatePromptInsertions(
    messages: AgentMessage[],
    workingStatePrompt: string | undefined,
    options?: WorkingStatePromptInsertionOptions,
  ): AgentMessage[];
  _preparePromptContext(
    messages: AgentMessage[],
    systemPrompt?: string,
    options?: {
      recordWorkingState?: boolean;
    },
  ): PromptContextPreparation;
  _createTokenBreakdownForPrompt(
    messages: AgentMessage[],
    options?: {
      totalOverride?: number;
      source?: "provider_usage" | "estimated";
      toolRawTokens?: number;
    },
  ): TokenBreakdown;
  initProjectMemory(): ProjectMemoryInitResult;
  searchProjectMemory(query: string): ProjectMemorySearchResult;
  pinProjectMemory(text: string): ProjectMemoryPinResult;
  forgetProjectMemory(id: string): ProjectMemoryForgetResult;
  lintProjectRules(): RuleLintResult;
  explainProjectRules(query: string): RuleExplainResult;
  updateRepoMap(): RepoMap;
  recordSubagentDigest(
    profile: SubagentName,
    query: string,
    summary: string,
    evidencePointers?: string[],
  ): SubagentDigest;
  evaluateGuardrails(phase?: ConstraintPhase): GuardrailReport;
  getCompactionDryRun(): CompactionDryRunResult;
  _createUpdateSessionStateToolDefinition(): ToolDefinition<
    typeof UPDATE_SESSION_STATE_SCHEMA,
    UpdateSessionStateResult
  >;
  _applyUpdateSessionState(input: UpdateSessionStateInput): UpdateSessionStateResult;
  _autoExecuteUpdateSessionState(): void;
  _reconcileSuccessfulFinishWorkState(): void;
  _createStatePatchFromUpdateSessionStateInput(
    input: UpdateSessionStateInput,
    previous: StructuredSessionState,
    sourceEntryIds: string[],
    liveState: StructuredSessionState,
  ): StatePatch | undefined;
  _createMarkSessionProgressToolDefinition(): ToolDefinition<
    typeof MARK_SESSION_PROGRESS_SCHEMA,
    MarkSessionProgressResult
  >;
  _applyMarkSessionProgress(input: MarkSessionProgressInput): MarkSessionProgressResult;
  _createSessionRecallToolDefinition(): ToolDefinition<typeof SESSION_RECALL_SCHEMA, RecallResult>;
  _createToolSearchToolDefinition(): ToolDefinition<typeof TOOL_SEARCH_SCHEMA, ToolSearchResult>;
  _createKeepContextToolDefinition(): ToolDefinition<typeof KEEP_CONTEXT_SCHEMA, any>;
  _createRunSubagentToolDefinition(): ToolDefinition<typeof RUN_SUBAGENT_SCHEMA, RunSubagentResult>;
  _runSubagent(input: RunSubagentInput): Promise<RunSubagentResult>;
  _formatSubagentResult(result: RunSubagentResult): string;
  _recallSessionEvidence(params: SessionRecallInput): RecallResult;
  _collectRecallCandidates(): RecallCandidate[];
  _prepareDeterministicCompaction(
    preparation: CompactionPreparation,
    pathEntries: SessionEntry[],
    settings: CompactionSettings & {
      renderedStateMaxTokens: number;
    },
  ): CompactionResult<CompactionDetails> & {
    state: StructuredSessionState;
  };
  _prepareDefaultCompaction(
    preparation: CompactionPreparation,
    pathEntries: SessionEntry[],
    settings: CompactionSettings & {
      renderedStateMaxTokens: number;
    },
    customInstructions: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<
    CompactionResult<CompactionDetails> & {
      state: StructuredSessionState;
    }
  >;
  compact(customInstructions?: string): Promise<CompactionResult>;
  abortCompaction(): void;
  abortBranchSummary(): void;
  checkCompaction(
    assistantMessage: AssistantMessage | undefined,
    skipAbortedCheck?: boolean,
    additionalMessages?: AgentMessage[],
  ): Promise<boolean>;
  _runAutoCompaction(reason: "overflow" | "threshold", willRetry: boolean): Promise<boolean>;
  setAutoCompactionEnabled(enabled: boolean): void;
  _getEffectiveCompactionSettings(): {
    enabled: boolean;
    triggerReserveTokens: number;
    triggerRatio?: number;
    keepRecentMinTokens: number;
    keepRecentMaxTokens: number;
    summaryMaxTokens: number;
    renderedStateMaxTokens: number;
    targetContextTokens: number;
  };
  bindExtensions(bindings: ExtensionBindings): Promise<void>;
  extendResourcesFromExtensions(reason: "startup" | "reload"): Promise<void>;
  buildExtensionResourcePaths(
    entries: Array<{
      path: string;
      extensionPath: string;
    }>,
  ): Array<{
    path: string;
    metadata: {
      source: string;
      scope: "temporary";
      origin: "top-level";
      baseDir?: string;
    };
  }>;
  getExtensionSourceLabel(extensionPath: string): string;
  _applyExtensionBindings(runner: ExtensionRunner): void;
  _refreshCurrentModelFromRegistry(): void;
  _bindExtensionCore(runner: ExtensionRunner): void;
  _refreshToolRegistry(options?: { activeToolNames?: string[]; includeAllExtensionTools?: boolean }): void;
  _buildRuntime(options: {
    activeToolNames?: string[];
    flagValues?: Map<string, boolean | string>;
    includeAllExtensionTools?: boolean;
  }): void;
  reload(): Promise<void>;
  _isNonRetryableProviderLimitError(errorMessage: string): boolean;
  _isRetryableError(message: AssistantMessage): boolean;
  _prepareRetry(message: AssistantMessage): Promise<boolean>;
  _getEffectiveRetryMaxAttempts(message: AssistantMessage, configuredMaxRetries: number): number;
  _getRetryReason(message: AssistantMessage): "model_loading" | "transient";
  _getRetryDelayMs(message: AssistantMessage, attempt: number, baseDelayMs: number): number;
  abortRetry(): void;
  setAutoRetryEnabled(enabled: boolean): void;
  executeBash(
    command: string,
    onChunk?: (chunk: string) => void,
    options?: {
      excludeFromContext?: boolean;
      operations?: BashOperations;
    },
  ): Promise<BashResult>;
  _rememberBashCommand(command: string): void;
  recordBashResult(
    command: string,
    result: BashResult,
    options?: {
      excludeFromContext?: boolean;
    },
  ): void;
  abortBash(): void;
  _flushPendingBashMessages(): void;
  setSessionName(name: string): void;
  navigateTree(
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ): Promise<{
    editorText?: string;
    cancelled: boolean;
    aborted?: boolean;
    summaryEntry?: BranchSummaryEntry;
  }>;
  getUserMessagesForForking(): Array<{
    entryId: string;
    text: string;
  }>;
  _extractUserMessageText(
    content:
      | string
      | Array<{
          type: string;
          text?: string;
        }>,
  ): string;
  getSessionStats(): SessionStats;
  _getEffectiveCompactedMessages(): AgentMessage[];
  _getLatestCompactionTimestamp(): number | undefined;
  getContextUsage(): ContextUsage | undefined;
  exportToHtml(outputPath?: string): Promise<string>;
  exportToJsonl(outputPath?: string): string;
  getLastAssistantText(): string | undefined;
  createReplacedSessionContext(): ReplacedSessionContext;
  hasExtensionHandlers(eventType: string): boolean;
}
