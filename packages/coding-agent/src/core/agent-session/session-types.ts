import type { Agent, AgentEvent, AgentMessage, AgentTool, CompletionMode, ThinkingLevel } from "@dst0/p-agent-core";
import type { ImageContent, Model } from "@dst0/p-ai";
import type {
  CompactionDetails,
  CompactionResult,
  EvidenceKind,
  FileTouchStatus,
  PlanStatus,
  StructuredSessionState,
} from "../compaction/index.ts";
import type {
  ContextUsage,
  ExtensionCommandContextActions,
  ExtensionErrorListener,
  ExtensionMode,
  ExtensionRunner,
  ExtensionUIContext,
  InputSource,
  SessionStartEvent,
  ShutdownHandler,
  ToolDefinition,
} from "../extensions/index.ts";
import type { ModelRegistry } from "../model-registry.ts";
import type { ProjectInstructionController } from "../project-instructions/index.ts";
import type { ResourceLoader } from "../resource-loader.ts";
import type { SessionManager } from "../session-manager.ts";
import type { SettingsManager } from "../settings-manager.ts";
import type { SourceInfo } from "../source-info.ts";
import type { TokenBreakdown } from "../token-accounting.ts";

export interface ToolSearchMatch {
  name: string;
  description: string;
  source: string;
}

export interface ToolSearchResult {
  query?: string;
  activated: string[];
  alreadyActive: string[];
  matches: ToolSearchMatch[];
  unknownNames: string[];
}

export interface ParsedSkillBlock {
  name: string;
  location: string;
  content: string;
  userMessage: string | undefined;
}

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

export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

export type InteractionMode = "normal" | "plan";

export interface AgentSessionConfig {
  agent: Agent;
  sessionManager: SessionManager;
  settingsManager: SettingsManager;
  cwd: string;
  /** Models to cycle through with Ctrl+P (from --models flag) */
  scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
  /** Resource loader for skills, prompts, themes, context files, system prompt */
  resourceLoader: ResourceLoader;
  /** Prepared instruction cache and refresh lifecycle. */
  projectInstructions?: ProjectInstructionController;
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

export interface ModelCycleResult {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  /** Whether cycling through scoped models (--models flag) or all available */
  isScoped: boolean;
}

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

export interface ToolDefinitionEntry {
  definition: ToolDefinition;
  sourceInfo: SourceInfo;
}

export interface SessionRecallInput {
  query: string;
  kind?: EvidenceKind[];
  maxTokens?: number;
  includeRaw?: boolean;
}

export interface UpdateSessionStateInput {
  action: "initial_plan" | "replan" | "progress_update" | "none";
  goal?: string;
  plan?: Array<{
    id?: string;
    parentId?: string;
    text: string;
    op?: "add" | "update" | "remove";
    status?: PlanStatus;
  }>;
  decisions?: Array<{ decision: string; rationale?: string }>;
  risks?: string[];
  touchedFiles?: Array<{ path: string; status?: FileTouchStatus; summary?: string }>;
  evidence?: Array<{ kind?: EvidenceKind; summary: string; path?: string; retrieveWhen?: string }>;
}
