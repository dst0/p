import type { Agent, AgentMessage, AgentState, AgentTool, CompletionMode, ThinkingLevel } from "@dst0/p-agent-core";
import type { AssistantMessage, ImagesApi, ImagesModel, Model } from "@dst0/p-ai";
import type {
  ExtensionCommandContextActions,
  ExtensionErrorListener,
  ExtensionMode,
  ExtensionRunner,
  ExtensionUIContext,
  SessionStartEvent,
  ShutdownHandler,
  ToolDefinition,
} from "../extensions/index.ts";
import { type BashExecutionMessage, type CustomMessage, filterSleepToolUseForHistory } from "../messages.ts";
import type { ModelRegistry } from "../model-registry.ts";
import {
  createProjectInstructionController,
  type ProjectInstructionController,
  type ProjectInstructionDeliveryMode,
} from "../project-instructions/index.ts";
import type { PromptTemplate } from "../prompt-templates.ts";
import type { ResourceLoader } from "../resource-loader.ts";
import type { SessionManager } from "../session-manager.ts";
import type { SettingsManager } from "../settings-manager.ts";
import type { BuildSystemPromptOptions } from "../system-prompt.ts";
import type { TokenBreakdown } from "../token-accounting.ts";
import { createVerificationLedger, type VerificationLedger } from "../verification-ledger.ts";
import { isInternalCompletionProtocolRepairMessage } from "./message-utils.ts";
import type {
  AgentSessionConfig,
  AgentSessionEventListener,
  InteractionMode,
  ToolDefinitionEntry,
} from "./session-types.ts";
import type {
  ProjectRuleGate,
  ProjectRuleReadStage,
  RuntimeContextPrompts,
  WorkingStatePromptInsertion,
} from "./state-types.ts";

export class AgentSessionState {
  readonly agent: Agent;
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;
  public _scopedModels: Array<{
    model: Model<any>;
    thinkingLevel?: ThinkingLevel;
  }>;
  public _imageModel?: ImagesModel<ImagesApi>;
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
  public _projectInstructions: ProjectInstructionController;
  public _projectInstructionMode: ProjectInstructionDeliveryMode;
  public _projectRuleGate: ProjectRuleGate | undefined;
  public _projectRuleGateGeneration = 0;
  public _projectRuleReadStages = new Map<string, ProjectRuleReadStage>();
  public _queuedProjectRuleGates = new WeakMap<AgentMessage, ProjectRuleGate | undefined>();
  public _processingQueuedProjectRuleTurn = false;
  public _customTools: ToolDefinition[];
  public _baseToolDefinitions: Map<string, ToolDefinition> = new Map();
  public _cwd: string;
  public _extensionRunnerRef?: {
    current?: ExtensionRunner;
  };
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
    this._projectInstructions =
      config.projectInstructions ??
      createProjectInstructionController({
        cwd: config.cwd,
        getContextFiles: () => config.resourceLoader.getAgentsFiles().agentsFiles,
        getSkills: () => config.resourceLoader.getSkills().skills,
      });
    this._projectInstructionMode = config.projectInstructionMode ?? "compiled";
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
  }
  get modelRegistry(): ModelRegistry {
    return this._modelRegistry;
  }
  public _lastAssistantMessage: AssistantMessage | undefined = undefined;
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
}
