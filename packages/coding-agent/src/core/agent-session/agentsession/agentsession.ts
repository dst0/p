import type {
  Agent,
  AgentEvent,
  AgentMessage,
  AgentState,
  AgentTool,
  CompletionMode,
  ThinkingLevel,
} from "@dst0/p-agent-core";
import type { AssistantMessage, ImageContent, Message, Model, TextContent } from "@dst0/p-ai";
import type { BashResult } from "../../bash-executor.ts";
import {
  type CompactionDetails,
  type CompactionPreparation,
  type CompactionResult,
  type CompactionSettings,
  type StatePatch,
  type StructuredSessionState,
  stripSessionStateUpdateBlocks,
} from "../../compaction/index.ts";
import type {
  ContextUsage,
  ExtensionCommandContextActions,
  ExtensionErrorListener,
  ExtensionMode,
  ExtensionRunner,
  ExtensionUIContext,
  ReplacedSessionContext,
  SessionStartEvent,
  ShutdownHandler,
  ToolDefinition,
  ToolInfo,
} from "../../extensions/index.ts";
import type { ConstraintPhase, GuardrailReport } from "../../guardrails.ts";
import { type BashExecutionMessage, type CustomMessage, filterSleepToolUseForHistory } from "../../messages.ts";
import type { ModelRegistry } from "../../model-registry.ts";
import { installAgentSessionPrepareNextTurn } from "../../prepare-next-turn.ts";
import type {
  ProjectMemoryDiffResult,
  ProjectMemoryForgetResult,
  ProjectMemoryInitResult,
  ProjectMemoryPinResult,
  ProjectMemorySearchResult,
  ProjectMemoryUpdateResult,
} from "../../project-memory.ts";
import type { RuleExplainResult, RuleLintResult } from "../../project-rules.ts";
import type { PromptTemplate } from "../../prompt-templates.ts";
import type { RepoMap } from "../../repo-map.ts";
import type { ResourceLoader } from "../../resource-loader.ts";
import type { BranchSummaryEntry, SessionEntry, SessionManager } from "../../session-manager.ts";
import type { SettingsManager } from "../../settings-manager.ts";
import type { RunSubagentInput, RunSubagentResult, SubagentDigest, SubagentName } from "../../subagents.ts";
import type { BuildSystemPromptOptions } from "../../system-prompt.ts";
import type { TokenBreakdown } from "../../token-accounting.ts";
import type { BashOperations } from "../../tools/bash.ts";
import { createVerificationLedger, type VerificationLedger } from "../../verification-ledger.ts";
import {
  type KEEP_CONTEXT_SCHEMA,
  type MARK_SESSION_PROGRESS_SCHEMA,
  type RUN_SUBAGENT_SCHEMA,
  type SESSION_RECALL_SCHEMA,
  type TOOL_SEARCH_SCHEMA,
  type UPDATE_SESSION_STATE_SCHEMA,
  UPDATE_SESSION_STATE_TOOL_NAME,
} from "../constants.ts";
import { isInternalCompletionProtocolRepairMessage } from "../helpers-part1.ts";
import type {
  AgentSessionConfig,
  AgentSessionEvent,
  AgentSessionEventListener,
  CompactionDryRunResult,
  ExtensionBindings,
  InteractionMode,
  ModelCycleResult,
  PromptOptions,
  SessionRecallInput,
  SessionStateSnapshot,
  SessionStats,
  ToolDefinitionEntry,
  ToolSearchResult,
  UpdateSessionStateInput,
} from "../types-part1.ts";
import type {
  MarkSessionProgressInput,
  MarkSessionProgressResult,
  PromptContextPreparation,
  RecallCandidate,
  RecallResult,
  RuntimeContextPrompts,
  ToolResultContextExtract,
  UpdateSessionStateResult,
  WorkingStatePromptInsertion,
  WorkingStatePromptInsertionOptions,
} from "../types-part2.ts";
import {
  do__applyAssistantSessionStateUpdate,
  do__createFastResponderMessage,
  do__disconnectFromAgent,
  do__emit,
  do__emitExtensionEvent,
  do__emitQueueUpdate,
  do__findLastAssistantMessage,
  do__getAssistantMessageText,
  do__getCompactionRequestAuth,
  do__getEffectiveCompletionModeForActiveTools,
  do__getFastResponderModelRequest,
  do__getFinishWorkSessionStateBlockReason,
  do__getInteractionModeSystemPrompt,
  do__getRequiredRequestAuth,
  do__getServiceAuthWithCurrentFallback,
  do__getServiceModelRequest,
  do__getUserMessageText,
  do__handlePostAgentRun,
  do__installAgentToolHooks,
  do__isContextOverflowForCurrentModel,
  do__maybeCreateToolResultContextExtract,
  do__normalizePromptGuidelines,
  do__normalizePromptSnippet,
  do__rebuildSystemPrompt,
  do__reconnectToAgent,
  do__removeContextOverflowMessages,
  do__replaceAssistantMessageText,
  do__replaceMessageInPlace,
  do__runAgentPrompt,
  do__shouldHideContextOverflowMessage,
  do__shouldRunFastResponder,
  do__willRetryAfterAgentEnd,
  do_disablePlanMode,
  do_dispose,
  do_enablePlanMode,
  do_getActiveToolNames,
  do_getAllTools,
  do_getLastTokenBreakdown,
  do_getToolDefinition,
  do_prompt,
  do_setActiveToolsByName,
  do_setScopedModels,
  do_subscribe,
  do_willRetryMessage,
} from "./agentsession-methods/methods-part1.ts";
import {
  do__clampThinkingLevel,
  do__createLiveStructuredSessionState,
  do__createProjectMemoryPrompt,
  do__createRuntimeContextPromptMessage,
  do__createRuntimeContextPrompts,
  do__createTokenBreakdownForPrompt,
  do__createToolPromptAccountingText,
  do__createWorkingStatePromptMessage,
  do__cycleAvailableModel,
  do__cycleScopedModel,
  do__emitModelSelect,
  do__expandSkillCommand,
  do__getCurrentStructuredSessionState,
  do__getLiveStateFallbackEntries,
  do__getThinkingLevelForModelSwitch,
  do__installPromptContextTransform,
  do__preparePromptContext,
  do__queueFollowUp,
  do__queueSteer,
  do__syncProjectMemory,
  do__throwIfExtensionCommand,
  do__tryExecuteExtensionCommand,
  do__withPendingMessageEntries,
  do__withWorkingStatePromptInsertions,
  do_abort,
  do_clearQueue,
  do_cycleModel,
  do_cycleThinkingLevel,
  do_diffProjectMemory,
  do_followUp,
  do_getAvailableThinkingLevels,
  do_getFollowUpMessages,
  do_getSessionStateSnapshot,
  do_getSteeringMessages,
  do_initProjectMemory,
  do_pinProjectMemory,
  do_searchProjectMemory,
  do_sendCustomMessage,
  do_sendUserMessage,
  do_setFollowUpMode,
  do_setModel,
  do_setSteeringMode,
  do_setThinkingLevel,
  do_steer,
  do_supportsThinking,
  do_syncProjectMemory,
  do_syncQueueModesFromSettings,
} from "./agentsession-methods/methods-part2.ts";
import {
  do__applyExtensionBindings,
  do__applyMarkSessionProgress,
  do__applyUpdateSessionState,
  do__autoExecuteUpdateSessionState,
  do__bindExtensionCore,
  do__buildRuntime,
  do__collectRecallCandidates,
  do__createKeepContextToolDefinition,
  do__createMarkSessionProgressToolDefinition,
  do__createRunSubagentToolDefinition,
  do__createSessionRecallToolDefinition,
  do__createStatePatchFromUpdateSessionStateInput,
  do__createToolSearchToolDefinition,
  do__createUpdateSessionStateToolDefinition,
  do__formatSubagentResult,
  do__getEffectiveCompactionSettings,
  do__prepareDefaultCompaction,
  do__prepareDeterministicCompaction,
  do__recallSessionEvidence,
  do__reconcileSuccessfulFinishWorkState,
  do__refreshCurrentModelFromRegistry,
  do__refreshToolRegistry,
  do__runAutoCompaction,
  do__runSubagent,
  do_abortBranchSummary,
  do_abortCompaction,
  do_bindExtensions,
  do_buildExtensionResourcePaths,
  do_checkCompaction,
  do_compact,
  do_evaluateGuardrails,
  do_explainProjectRules,
  do_extendResourcesFromExtensions,
  do_forgetProjectMemory,
  do_getCompactionDryRun,
  do_getExtensionSourceLabel,
  do_lintProjectRules,
  do_recordSubagentDigest,
  do_reload,
  do_setAutoCompactionEnabled,
  do_updateRepoMap,
} from "./agentsession-methods/methods-part3.ts";
import {
  do__extractUserMessageText,
  do__flushPendingBashMessages,
  do__getEffectiveCompactedMessages,
  do__getEffectiveRetryMaxAttempts,
  do__getLatestCompactionTimestamp,
  do__getRetryDelayMs,
  do__getRetryReason,
  do__isNonRetryableProviderLimitError,
  do__isRetryableError,
  do__prepareRetry,
  do__rememberBashCommand,
  do_abortBash,
  do_abortRetry,
  do_createReplacedSessionContext,
  do_executeBash,
  do_exportToHtml,
  do_exportToJsonl,
  do_getContextUsage,
  do_getLastAssistantText,
  do_getSessionStats,
  do_getUserMessagesForForking,
  do_hasExtensionHandlers,
  do_navigateTree,
  do_recordBashResult,
  do_setAutoRetryEnabled,
  do_setSessionName,
} from "./agentsession-methods/methods-part4.ts";

export class AgentSession {
  readonly agent: Agent;

  readonly sessionManager: SessionManager;

  readonly settingsManager: SettingsManager;

  public _scopedModels: Array<{
    model: Model<any>;
    thinkingLevel?: ThinkingLevel;
  }>;

  public _unsubscribeAgent?: () => void;

  public _eventListeners: AgentSessionEventListener[] = [];

  public _steeringMessages: string[] = [];

  public _followUpMessages: string[] = [];

  public _pendingNextTurnMessages: CustomMessage[] = [];

  public _compactionAbortController: AbortController | undefined = undefined;

  public _autoCompactionAbortController: AbortController | undefined = undefined;

  public _overflowRecoveryAttempts = 0;

  public _branchSummaryAbortController: AbortController | undefined = undefined;

  public _retryAbortController: AbortController | undefined = undefined;

  public _retryAttempt = 0;

  public _bashAbortController: AbortController | undefined = undefined;

  public _pendingBashMessages: BashExecutionMessage[] = [];

  public _recentBashCommands: string[] = [];

  public _extensionRunner!: ExtensionRunner;

  public _turnIndex = 0;

  public _resourceLoader: ResourceLoader;

  public _customTools: ToolDefinition[];

  public _baseToolDefinitions: Map<string, ToolDefinition> = new Map();

  public _cwd: string;

  public _extensionRunnerRef?: { current?: ExtensionRunner };

  public _initialActiveToolNames?: string[];

  public _allowedToolNames?: Set<string>;

  public _excludedToolNames?: Set<string>;

  public _baseToolsOverride?: Record<string, AgentTool>;

  public _includeAllExtensionTools = false;

  public _sessionStartEvent: SessionStartEvent;

  public _extensionUIContext?: ExtensionUIContext;

  public _extensionMode: ExtensionMode = "print";

  public _extensionCommandContextActions?: ExtensionCommandContextActions;

  public _extensionAbortHandler?: () => void;

  public _extensionShutdownHandler?: ShutdownHandler;

  public _extensionErrorListener?: ExtensionErrorListener;

  public _extensionErrorUnsubscriber?: () => void;

  public _completionMode: CompletionMode;

  public _interactionMode: InteractionMode = "normal";

  public _planModePreviousActiveToolNames: string[] | undefined;

  public _stateUpdateRequiredForCurrentUserTurn = false;

  public _progressUpdateRequiredBeforeFinish = false;

  public _modelRegistry: ModelRegistry;

  public _toolRegistry: Map<string, AgentTool> = new Map();

  public _toolDefinitions: Map<string, ToolDefinitionEntry> = new Map();

  public _toolPromptSnippets: Map<string, string> = new Map();

  public _toolPromptGuidelines: Map<string, string[]> = new Map();

  public _baseSystemPrompt = "";

  public _baseSystemPromptOptions!: BuildSystemPromptOptions;

  public _lastRuntimePromptComponents: RuntimeContextPrompts = {};

  public _workingStatePromptInsertions: WorkingStatePromptInsertion[] = [];

  public _lastTokenBreakdown: TokenBreakdown | undefined = undefined;

  public _verificationLedger: VerificationLedger;

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

  get modelRegistry(): ModelRegistry {
    return this._modelRegistry;
  }

  public _lastAssistantMessage: AssistantMessage | undefined = undefined;

  public _handleAgentEvent = async (event: AgentEvent): Promise<void> => {
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

  get state(): AgentState {
    return this.agent.state;
  }

  get model(): Model<any> | undefined {
    return this.agent.state.model;
  }

  get thinkingLevel(): ThinkingLevel {
    return this.agent.state.thinkingLevel;
  }

  get isStreaming(): boolean {
    return this.agent.state.isStreaming;
  }

  get systemPrompt(): string {
    return this.agent.state.systemPrompt;
  }

  get interactionMode(): InteractionMode {
    return this._interactionMode;
  }

  get isPlanMode(): boolean {
    return this._interactionMode === "plan";
  }

  get retryAttempt(): number {
    return this._retryAttempt;
  }

  get isCompacting(): boolean {
    return (
      this._autoCompactionAbortController !== undefined ||
      this._compactionAbortController !== undefined ||
      this._branchSummaryAbortController !== undefined
    );
  }

  get messages(): AgentMessage[] {
    return this.agent.state.messages
      .filter((message) => !isInternalCompletionProtocolRepairMessage(message))
      .map(filterSleepToolUseForHistory)
      .filter((message): message is AgentMessage => message !== undefined);
  }

  get steeringMode(): "all" | "one-at-a-time" {
    return this.agent.steeringMode;
  }

  get followUpMode(): "all" | "one-at-a-time" {
    return this.agent.followUpMode;
  }

  get sessionFile(): string | undefined {
    return this.sessionManager.getSessionFile();
  }

  get sessionId(): string {
    return this.sessionManager.getSessionId();
  }

  get sessionName(): string | undefined {
    return this.sessionManager.getSessionName();
  }

  get scopedModels(): ReadonlyArray<{
    model: Model<any>;
    thinkingLevel?: ThinkingLevel;
  }> {
    return this._scopedModels;
  }

  get promptTemplates(): ReadonlyArray<PromptTemplate> {
    return this._resourceLoader.getPrompts().prompts;
  }

  get pendingMessageCount(): number {
    return this._steeringMessages.length + this._followUpMessages.length;
  }

  get resourceLoader(): ResourceLoader {
    return this._resourceLoader;
  }

  get autoCompactionEnabled(): boolean {
    return this.settingsManager.getCompactionEnabled();
  }

  get isRetrying(): boolean {
    return this._retryAbortController !== undefined;
  }

  get autoRetryEnabled(): boolean {
    return this.settingsManager.getRetryEnabled();
  }

  get isBashRunning(): boolean {
    return this._bashAbortController !== undefined;
  }

  get hasPendingBashMessages(): boolean {
    return this._pendingBashMessages.length > 0;
  }

  get extensionRunner(): ExtensionRunner {
    return this._extensionRunner;
  }

  async _getRequiredRequestAuth(model: Model<any>): Promise<{
    apiKey: string;
    headers?: Record<string, string>;
  }> {
    return do__getRequiredRequestAuth(this, model);
  }

  async _getCompactionRequestAuth(model: Model<any>): Promise<{
    apiKey?: string;
    headers?: Record<string, string>;
  }> {
    return do__getCompactionRequestAuth(this, model);
  }

  _getServiceModelRequest(minContextTokens = 0): {
    model: Model<any>;
    thinkingLevel: ThinkingLevel;
  } {
    return do__getServiceModelRequest(this, minContextTokens);
  }

  async _getServiceAuthWithCurrentFallback(request: { model: Model<any>; thinkingLevel: ThinkingLevel }): Promise<{
    model: Model<any>;
    thinkingLevel: ThinkingLevel;
    apiKey?: string;
    headers?: Record<string, string>;
  }> {
    return do__getServiceAuthWithCurrentFallback(this, request);
  }

  _getFastResponderModelRequest():
    | {
        model: Model<string>;
        thinkingLevel: ThinkingLevel;
      }
    | undefined {
    return do__getFastResponderModelRequest(this);
  }

  _shouldRunFastResponder(messages: AgentMessage[]): boolean {
    return do__shouldRunFastResponder(this, messages);
  }

  async _createFastResponderMessage(
    userText: string,
    messages: AgentMessage[],
  ): Promise<CustomMessage<{ model: string; contextTokens: number }> | undefined> {
    return do__createFastResponderMessage(this, userText, messages);
  }

  async _maybeCreateToolResultContextExtract(
    toolName: string,
    content: (TextContent | ImageContent)[],
    details: unknown,
    isError: boolean,
    contextMessages: AgentMessage[],
    signal?: AbortSignal,
  ): Promise<ToolResultContextExtract | undefined> {
    return do__maybeCreateToolResultContextExtract(this, toolName, content, details, isError, contextMessages, signal);
  }

  _installAgentToolHooks(): void {
    do__installAgentToolHooks(this);
  }

  _getFinishWorkSessionStateBlockReason(args: unknown): string | undefined {
    return do__getFinishWorkSessionStateBlockReason(this, args);
  }

  _emit(event: AgentSessionEvent): void {
    do__emit(this, event);
  }

  _emitQueueUpdate(): void {
    do__emitQueueUpdate(this);
  }

  _willRetryAfterAgentEnd(event: Extract<AgentEvent, { type: "agent_end" }>): boolean {
    return do__willRetryAfterAgentEnd(this, event);
  }

  _isContextOverflowForCurrentModel(message: AssistantMessage): boolean {
    return do__isContextOverflowForCurrentModel(this, message);
  }

  _removeContextOverflowMessages(messages: AgentMessage[]): AgentMessage[] {
    return do__removeContextOverflowMessages(this, messages);
  }

  _shouldHideContextOverflowMessage(message: AssistantMessage): boolean {
    return do__shouldHideContextOverflowMessage(this, message);
  }

  _getUserMessageText(message: Message): string {
    return do__getUserMessageText(this, message);
  }

  _findLastAssistantMessage(): AssistantMessage | undefined {
    return do__findLastAssistantMessage(this);
  }

  _replaceMessageInPlace(target: AgentMessage, replacement: AgentMessage): void {
    do__replaceMessageInPlace(this, target, replacement);
  }

  _getAssistantMessageText(message: AssistantMessage): string {
    return do__getAssistantMessageText(this, message);
  }

  _replaceAssistantMessageText(message: AssistantMessage, text: string): AssistantMessage {
    return do__replaceAssistantMessageText(this, message, text);
  }

  _applyAssistantSessionStateUpdate(rawAssistantText: string, sourceEntryId: string): void {
    do__applyAssistantSessionStateUpdate(this, rawAssistantText, sourceEntryId);
  }

  async _emitExtensionEvent(event: AgentEvent): Promise<void> {
    return do__emitExtensionEvent(this, event);
  }

  subscribe(listener: AgentSessionEventListener): () => void {
    return do_subscribe(this, listener);
  }

  _disconnectFromAgent(): void {
    do__disconnectFromAgent(this);
  }

  _reconnectToAgent(): void {
    do__reconnectToAgent(this);
  }

  dispose(): void {
    do_dispose(this);
  }

  getLastTokenBreakdown(): TokenBreakdown | undefined {
    return do_getLastTokenBreakdown(this);
  }

  willRetryMessage(message: AssistantMessage): boolean {
    return do_willRetryMessage(this, message);
  }

  getActiveToolNames(): string[] {
    return do_getActiveToolNames(this);
  }

  getAllTools(): ToolInfo[] {
    return do_getAllTools(this);
  }

  getToolDefinition(name: string): ToolDefinition | undefined {
    return do_getToolDefinition(this, name);
  }

  setActiveToolsByName(toolNames: string[]): void {
    do_setActiveToolsByName(this, toolNames);
  }

  enablePlanMode(): { enabled: boolean; missingTools: string[] } {
    return do_enablePlanMode(this);
  }

  disablePlanMode(): void {
    do_disablePlanMode(this);
  }

  setScopedModels(scopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>): void {
    do_setScopedModels(this, scopedModels);
  }

  _normalizePromptSnippet(text: string | undefined): string | undefined {
    return do__normalizePromptSnippet(this, text);
  }

  _normalizePromptGuidelines(guidelines: string[] | undefined): string[] {
    return do__normalizePromptGuidelines(this, guidelines);
  }

  _getEffectiveCompletionModeForActiveTools(activeToolCount: number): CompletionMode {
    return do__getEffectiveCompletionModeForActiveTools(this, activeToolCount);
  }

  _getInteractionModeSystemPrompt(): string | undefined {
    return do__getInteractionModeSystemPrompt(this);
  }

  _rebuildSystemPrompt(
    toolNames: string[],
    completionMode = this._getEffectiveCompletionModeForActiveTools(toolNames.length),
  ): string {
    return do__rebuildSystemPrompt(this, toolNames, completionMode);
  }

  async _runAgentPrompt(messages: AgentMessage | AgentMessage[]): Promise<void> {
    return do__runAgentPrompt(this, messages);
  }

  async _handlePostAgentRun(): Promise<boolean> {
    return do__handlePostAgentRun(this);
  }

  async prompt(text: string, options?: PromptOptions): Promise<void> {
    return do_prompt(this, text, options);
  }

  async _tryExecuteExtensionCommand(text: string): Promise<boolean> {
    return do__tryExecuteExtensionCommand(this, text);
  }

  _expandSkillCommand(text: string): string {
    return do__expandSkillCommand(this, text);
  }

  async steer(text: string, images?: ImageContent[]): Promise<void> {
    return do_steer(this, text, images);
  }

  async followUp(text: string, images?: ImageContent[]): Promise<void> {
    return do_followUp(this, text, images);
  }

  async _queueSteer(text: string, images?: ImageContent[]): Promise<void> {
    return do__queueSteer(this, text, images);
  }

  async _queueFollowUp(text: string, images?: ImageContent[]): Promise<void> {
    return do__queueFollowUp(this, text, images);
  }

  _throwIfExtensionCommand(text: string): void {
    do__throwIfExtensionCommand(this, text);
  }

  async sendCustomMessage<T = unknown>(
    message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
    options?: {
      triggerTurn?: boolean;
      deliverAs?: "steer" | "followUp" | "nextTurn";
    },
  ): Promise<void> {
    return do_sendCustomMessage(this, message, options);
  }

  async sendUserMessage(
    content: string | (TextContent | ImageContent)[],
    options?: { deliverAs?: "steer" | "followUp" },
  ): Promise<void> {
    return do_sendUserMessage(this, content, options);
  }

  clearQueue(): { steering: string[]; followUp: string[] } {
    return do_clearQueue(this);
  }

  getSteeringMessages(): readonly string[] {
    return do_getSteeringMessages(this);
  }

  getFollowUpMessages(): readonly string[] {
    return do_getFollowUpMessages(this);
  }

  async abort(): Promise<void> {
    return do_abort(this);
  }

  async _emitModelSelect(
    nextModel: Model<any>,
    previousModel: Model<any> | undefined,
    source: "set" | "cycle" | "restore",
  ): Promise<void> {
    return do__emitModelSelect(this, nextModel, previousModel, source);
  }

  async setModel(model: Model<any>): Promise<void> {
    return do_setModel(this, model);
  }

  async cycleModel(direction: "forward" | "backward" = "forward"): Promise<ModelCycleResult | undefined> {
    return do_cycleModel(this, direction);
  }

  async _cycleScopedModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
    return do__cycleScopedModel(this, direction);
  }

  async _cycleAvailableModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
    return do__cycleAvailableModel(this, direction);
  }

  setThinkingLevel(level: ThinkingLevel): void {
    do_setThinkingLevel(this, level);
  }

  cycleThinkingLevel(): ThinkingLevel | undefined {
    return do_cycleThinkingLevel(this);
  }

  getAvailableThinkingLevels(): ThinkingLevel[] {
    return do_getAvailableThinkingLevels(this);
  }

  supportsThinking(): boolean {
    return do_supportsThinking(this);
  }

  _getThinkingLevelForModelSwitch(explicitLevel?: ThinkingLevel): ThinkingLevel {
    return do__getThinkingLevelForModelSwitch(this, explicitLevel);
  }

  _clampThinkingLevel(level: ThinkingLevel, _availableLevels: ThinkingLevel[]): ThinkingLevel {
    return do__clampThinkingLevel(this, level, _availableLevels);
  }

  syncQueueModesFromSettings(): void {
    do_syncQueueModesFromSettings(this);
  }

  setSteeringMode(mode: "all" | "one-at-a-time"): void {
    do_setSteeringMode(this, mode);
  }

  setFollowUpMode(mode: "all" | "one-at-a-time"): void {
    do_setFollowUpMode(this, mode);
  }

  getSessionStateSnapshot(): SessionStateSnapshot {
    return do_getSessionStateSnapshot(this);
  }

  _getCurrentStructuredSessionState(branchEntries = this.sessionManager.getBranch()): StructuredSessionState {
    return do__getCurrentStructuredSessionState(this, branchEntries);
  }

  _getLiveStateFallbackEntries(branchEntries: SessionEntry[]): SessionEntry[] {
    return do__getLiveStateFallbackEntries(this, branchEntries);
  }

  _createLiveStructuredSessionState(
    branchEntries: SessionEntry[],
    previous?: StructuredSessionState,
  ): StructuredSessionState {
    return do__createLiveStructuredSessionState(this, branchEntries, previous);
  }

  _syncProjectMemory(): void {
    do__syncProjectMemory(this);
  }

  _createProjectMemoryPrompt(query: string): string | undefined {
    return do__createProjectMemoryPrompt(this, query);
  }

  _createRuntimeContextPrompts(
    query: string,
    baseSystemPrompt: string,
    pendingMessages: AgentMessage[] = [],
  ): RuntimeContextPrompts {
    return do__createRuntimeContextPrompts(this, query, baseSystemPrompt, pendingMessages);
  }

  _withPendingMessageEntries(branchEntries: SessionEntry[], pendingMessages: AgentMessage[]): SessionEntry[] {
    return do__withPendingMessageEntries(this, branchEntries, pendingMessages);
  }

  _createToolPromptAccountingText(): string {
    return do__createToolPromptAccountingText(this);
  }

  _installPromptContextTransform(): void {
    do__installPromptContextTransform(this);
  }

  _createWorkingStatePromptMessage(content: string, timestamp: number): CustomMessage {
    return do__createWorkingStatePromptMessage(this, content, timestamp);
  }

  _createRuntimeContextPromptMessage(content: string, timestamp: number): CustomMessage {
    return do__createRuntimeContextPromptMessage(this, content, timestamp);
  }

  _withWorkingStatePromptInsertions(
    messages: AgentMessage[],
    workingStatePrompt: string | undefined,
    options: WorkingStatePromptInsertionOptions = {},
  ): AgentMessage[] {
    return do__withWorkingStatePromptInsertions(this, messages, workingStatePrompt, options);
  }

  _preparePromptContext(
    messages: AgentMessage[],
    systemPrompt = this.systemPrompt,
    options: { recordWorkingState?: boolean } = {},
  ): PromptContextPreparation {
    return do__preparePromptContext(this, messages, systemPrompt, options);
  }

  _createTokenBreakdownForPrompt(
    messages: AgentMessage[],
    options: {
      totalOverride?: number;
      source?: "provider_usage" | "estimated";
      toolRawTokens?: number;
    } = {},
  ): TokenBreakdown {
    return do__createTokenBreakdownForPrompt(this, messages, options);
  }

  initProjectMemory(): ProjectMemoryInitResult {
    return do_initProjectMemory(this);
  }

  syncProjectMemory(): ProjectMemoryUpdateResult {
    return do_syncProjectMemory(this);
  }

  diffProjectMemory(): ProjectMemoryDiffResult {
    return do_diffProjectMemory(this);
  }

  searchProjectMemory(query: string): ProjectMemorySearchResult {
    return do_searchProjectMemory(this, query);
  }

  pinProjectMemory(text: string): ProjectMemoryPinResult {
    return do_pinProjectMemory(this, text);
  }

  forgetProjectMemory(id: string): ProjectMemoryForgetResult {
    return do_forgetProjectMemory(this, id);
  }

  lintProjectRules(): RuleLintResult {
    return do_lintProjectRules(this);
  }

  explainProjectRules(query: string): RuleExplainResult {
    return do_explainProjectRules(this, query);
  }

  updateRepoMap(): RepoMap {
    return do_updateRepoMap(this);
  }

  recordSubagentDigest(
    profile: SubagentName,
    query: string,
    summary: string,
    evidencePointers: string[] = [],
  ): SubagentDigest {
    return do_recordSubagentDigest(this, profile, query, summary, evidencePointers);
  }

  evaluateGuardrails(phase: ConstraintPhase = "final"): GuardrailReport {
    return do_evaluateGuardrails(this, phase);
  }

  getCompactionDryRun(): CompactionDryRunResult {
    return do_getCompactionDryRun(this);
  }

  _createUpdateSessionStateToolDefinition(): ToolDefinition<
    typeof UPDATE_SESSION_STATE_SCHEMA,
    UpdateSessionStateResult
  > {
    return do__createUpdateSessionStateToolDefinition(this);
  }

  _applyUpdateSessionState(input: UpdateSessionStateInput): UpdateSessionStateResult {
    return do__applyUpdateSessionState(this, input);
  }

  _autoExecuteUpdateSessionState(): void {
    do__autoExecuteUpdateSessionState(this);
  }

  _reconcileSuccessfulFinishWorkState(): void {
    do__reconcileSuccessfulFinishWorkState(this);
  }

  _createStatePatchFromUpdateSessionStateInput(
    input: UpdateSessionStateInput,
    previous: StructuredSessionState,
    sourceEntryIds: string[],
    liveState: StructuredSessionState,
  ): StatePatch | undefined {
    return do__createStatePatchFromUpdateSessionStateInput(this, input, previous, sourceEntryIds, liveState);
  }

  _createMarkSessionProgressToolDefinition(): ToolDefinition<
    typeof MARK_SESSION_PROGRESS_SCHEMA,
    MarkSessionProgressResult
  > {
    return do__createMarkSessionProgressToolDefinition(this);
  }

  _applyMarkSessionProgress(input: MarkSessionProgressInput): MarkSessionProgressResult {
    return do__applyMarkSessionProgress(this, input);
  }

  _createSessionRecallToolDefinition(): ToolDefinition<typeof SESSION_RECALL_SCHEMA, RecallResult> {
    return do__createSessionRecallToolDefinition(this);
  }

  _createToolSearchToolDefinition(): ToolDefinition<typeof TOOL_SEARCH_SCHEMA, ToolSearchResult> {
    return do__createToolSearchToolDefinition(this);
  }

  _createKeepContextToolDefinition(): ToolDefinition<typeof KEEP_CONTEXT_SCHEMA, any> {
    return do__createKeepContextToolDefinition(this);
  }

  _createRunSubagentToolDefinition(): ToolDefinition<typeof RUN_SUBAGENT_SCHEMA, RunSubagentResult> {
    return do__createRunSubagentToolDefinition(this);
  }

  async _runSubagent(input: RunSubagentInput): Promise<RunSubagentResult> {
    return do__runSubagent(this, input);
  }

  _formatSubagentResult(result: RunSubagentResult): string {
    return do__formatSubagentResult(this, result);
  }

  _recallSessionEvidence(params: SessionRecallInput): RecallResult {
    return do__recallSessionEvidence(this, params);
  }

  _collectRecallCandidates(): RecallCandidate[] {
    return do__collectRecallCandidates(this);
  }

  _prepareDeterministicCompaction(
    preparation: CompactionPreparation,
    pathEntries: SessionEntry[],
    settings: CompactionSettings & { renderedStateMaxTokens: number },
  ): CompactionResult<CompactionDetails> & { state: StructuredSessionState } {
    return do__prepareDeterministicCompaction(this, preparation, pathEntries, settings);
  }

  async _prepareDefaultCompaction(
    preparation: CompactionPreparation,
    pathEntries: SessionEntry[],
    settings: CompactionSettings & { renderedStateMaxTokens: number },
    customInstructions: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<CompactionResult<CompactionDetails> & { state: StructuredSessionState }> {
    return do__prepareDefaultCompaction(this, preparation, pathEntries, settings, customInstructions, signal);
  }

  async compact(customInstructions?: string): Promise<CompactionResult> {
    return do_compact(this, customInstructions);
  }

  abortCompaction(): void {
    do_abortCompaction(this);
  }

  abortBranchSummary(): void {
    do_abortBranchSummary(this);
  }

  async checkCompaction(
    assistantMessage: AssistantMessage | undefined,
    skipAbortedCheck = true,
    additionalMessages?: AgentMessage[],
  ): Promise<boolean> {
    return do_checkCompaction(this, assistantMessage, skipAbortedCheck, additionalMessages);
  }

  async _runAutoCompaction(reason: "overflow" | "threshold", willRetry: boolean): Promise<boolean> {
    return do__runAutoCompaction(this, reason, willRetry);
  }

  setAutoCompactionEnabled(enabled: boolean): void {
    do_setAutoCompactionEnabled(this, enabled);
  }

  _getEffectiveCompactionSettings(): {
    enabled: boolean;
    triggerReserveTokens: number;
    triggerRatio?: number;
    keepRecentMinTokens: number;
    keepRecentMaxTokens: number;
    summaryMaxTokens: number;
    renderedStateMaxTokens: number;
    targetContextTokens: number;
  } {
    return do__getEffectiveCompactionSettings(this);
  }

  async bindExtensions(bindings: ExtensionBindings): Promise<void> {
    return do_bindExtensions(this, bindings);
  }

  async extendResourcesFromExtensions(reason: "startup" | "reload"): Promise<void> {
    return do_extendResourcesFromExtensions(this, reason);
  }

  buildExtensionResourcePaths(entries: Array<{ path: string; extensionPath: string }>): Array<{
    path: string;
    metadata: {
      source: string;
      scope: "temporary";
      origin: "top-level";
      baseDir?: string;
    };
  }> {
    return do_buildExtensionResourcePaths(this, entries);
  }

  getExtensionSourceLabel(extensionPath: string): string {
    return do_getExtensionSourceLabel(this, extensionPath);
  }

  _applyExtensionBindings(runner: ExtensionRunner): void {
    do__applyExtensionBindings(this, runner);
  }

  _refreshCurrentModelFromRegistry(): void {
    do__refreshCurrentModelFromRegistry(this);
  }

  _bindExtensionCore(runner: ExtensionRunner): void {
    do__bindExtensionCore(this, runner);
  }

  _refreshToolRegistry(options?: { activeToolNames?: string[]; includeAllExtensionTools?: boolean }): void {
    do__refreshToolRegistry(this, options);
  }

  _buildRuntime(options: {
    activeToolNames?: string[];
    flagValues?: Map<string, boolean | string>;
    includeAllExtensionTools?: boolean;
  }): void {
    do__buildRuntime(this, options);
  }

  async reload(): Promise<void> {
    return do_reload(this);
  }

  _isNonRetryableProviderLimitError(errorMessage: string): boolean {
    return do__isNonRetryableProviderLimitError(this, errorMessage);
  }

  _isRetryableError(message: AssistantMessage): boolean {
    return do__isRetryableError(this, message);
  }

  async _prepareRetry(message: AssistantMessage): Promise<boolean> {
    return do__prepareRetry(this, message);
  }

  _getEffectiveRetryMaxAttempts(message: AssistantMessage, configuredMaxRetries: number): number {
    return do__getEffectiveRetryMaxAttempts(this, message, configuredMaxRetries);
  }

  _getRetryReason(message: AssistantMessage): "model_loading" | "transient" {
    return do__getRetryReason(this, message);
  }

  _getRetryDelayMs(message: AssistantMessage, attempt: number, baseDelayMs: number): number {
    return do__getRetryDelayMs(this, message, attempt, baseDelayMs);
  }

  abortRetry(): void {
    do_abortRetry(this);
  }

  setAutoRetryEnabled(enabled: boolean): void {
    do_setAutoRetryEnabled(this, enabled);
  }

  async executeBash(
    command: string,
    onChunk?: (chunk: string) => void,
    options?: { excludeFromContext?: boolean; operations?: BashOperations },
  ): Promise<BashResult> {
    return do_executeBash(this, command, onChunk, options);
  }

  _rememberBashCommand(command: string): void {
    do__rememberBashCommand(this, command);
  }

  recordBashResult(command: string, result: BashResult, options?: { excludeFromContext?: boolean }): void {
    do_recordBashResult(this, command, result, options);
  }

  abortBash(): void {
    do_abortBash(this);
  }

  _flushPendingBashMessages(): void {
    do__flushPendingBashMessages(this);
  }

  setSessionName(name: string): void {
    do_setSessionName(this, name);
  }

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
    return do_navigateTree(this, targetId, options);
  }

  getUserMessagesForForking(): Array<{ entryId: string; text: string }> {
    return do_getUserMessagesForForking(this);
  }

  _extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
    return do__extractUserMessageText(this, content);
  }

  getSessionStats(): SessionStats {
    return do_getSessionStats(this);
  }

  _getEffectiveCompactedMessages(): AgentMessage[] {
    return do__getEffectiveCompactedMessages(this);
  }

  _getLatestCompactionTimestamp(): number | undefined {
    return do__getLatestCompactionTimestamp(this);
  }

  getContextUsage(): ContextUsage | undefined {
    return do_getContextUsage(this);
  }

  async exportToHtml(outputPath?: string): Promise<string> {
    return do_exportToHtml(this, outputPath);
  }

  exportToJsonl(outputPath?: string): string {
    return do_exportToJsonl(this, outputPath);
  }

  getLastAssistantText(): string | undefined {
    return do_getLastAssistantText(this);
  }

  createReplacedSessionContext(): ReplacedSessionContext {
    return do_createReplacedSessionContext(this);
  }

  hasExtensionHandlers(eventType: string): boolean {
    return do_hasExtensionHandlers(this, eventType);
  }
}
