import type { CompletionMode, CompletionProtocolLimits } from "@dst0/p-agent-core";
import type { Transport } from "@dst0/p-ai";

export interface CompactionSettings {
  enabled?: boolean; // default: true
  /** @deprecated Use triggerReserveTokens. */
  reserveTokens?: number;
  /** @deprecated Use keepRecentMinTokens/keepRecentMaxTokens. */
  keepRecentTokens?: number;
  triggerReserveTokens?: number; // default: DEFAULT_COMPACTION_SETTINGS.triggerReserveTokens
  triggerRatio?: number; // default: DEFAULT_COMPACTION_SETTINGS.triggerRatio
  keepRecentMinTokens?: number; // default: DEFAULT_COMPACTION_SETTINGS.keepRecentMinTokens
  keepRecentMaxTokens?: number; // default: DEFAULT_COMPACTION_SETTINGS.keepRecentMaxTokens
  summaryMaxTokens?: number; // default: DEFAULT_COMPACTION_SETTINGS.summaryMaxTokens
  renderedStateMaxTokens?: number; // default: DEFAULT_COMPACTION_SETTINGS.renderedStateMaxTokens
  targetContextTokens?: number; // default: DEFAULT_COMPACTION_SETTINGS.targetContextTokens
}

export interface BranchSummarySettings {
  reserveTokens?: number; // default: 16384 (tokens reserved for prompt + LLM response)
  skipPrompt?: boolean; // default: false - when true, skips "Summarize branch?" prompt and defaults to no summary
}

export interface ProviderRetrySettings {
  timeoutMs?: number; // SDK/provider request timeout in milliseconds
  maxRetries?: number; // SDK/provider retry attempts
  maxRetryDelayMs?: number; // default: 60000 (max server-requested delay before failing)
}

export interface RetrySettings {
  enabled?: boolean; // default: true
  maxRetries?: number; // default: 3
  baseDelayMs?: number; // default: 500 (exponential backoff: 0.5s, 1s, 2s)
  provider?: ProviderRetrySettings;
}

export interface TerminalSettings {
  showImages?: boolean; // default: true (only relevant if terminal supports images)
  imageWidthCells?: number; // default: 60 (preferred inline image width in terminal cells)
  clearOnShrink?: boolean; // default: false (clear empty rows when content shrinks)
  showTerminalProgress?: boolean; // default: false (OSC 9;4 terminal progress indicators)
  showTokenProgress?: boolean; // default: true (compact queued/prefill/generation footer progress)
  showTokenStats?: boolean; // default: true (cumulative ↑↓R W CH token counts in footer)
  showIndexingInfo?: boolean; // default: true (repository indexing marker and progress in footer)
  showVersion?: boolean; // default: false (p agent version in footer)
  showHarnessMessages?: boolean; // default: false (internal harness messages)
}

export interface ImageSettings {
  autoResize?: boolean; // default: true (resize images to 2000x2000 max for better model compatibility)
  blockImages?: boolean; // default: false - when true, prevents all images from being sent to LLM providers
}

export interface ThinkingBudgetsSettings {
  minimal?: number;
  low?: number;
  medium?: number;
  high?: number;
}

export interface FastResponderSettings {
  enabled?: boolean; // default: true when a responder or service model is configured
  provider?: string;
  model?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  minContextTokens?: number; // default: 1000
  timeoutMs?: number; // default: 2000
  maxTokens?: number; // default: 120
}

export interface MarkdownSettings {
  codeBlockIndent?: string; // default: "  "
}

export interface WarningSettings {
  anthropicExtraUsage?: boolean; // default: true
}

export type DefaultProjectTrust = "ask" | "always" | "never";

export type TransportSetting = Transport;

export type PackageSource =
  | string
  | {
      source: string;
      extensions?: string[];
      skills?: string[];
      prompts?: string[];
      themes?: string[];
    };

export interface Settings {
  lastChangelogVersion?: string;
  defaultProvider?: string;
  defaultModel?: string;
  serviceProvider?: string; // Optional fast model provider for compaction/memory/tool-output extraction tasks
  serviceModel?: string; // Optional fast model id; falls back to current model when unavailable
  serviceThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  fastResponder?: FastResponderSettings; // Optional fast model response emitted before cold prefill
  defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  transport?: TransportSetting; // default: "auto"
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";
  completionMode?: CompletionMode | "explicit"; // default: "explicit"
  completionLimits?: CompletionProtocolLimits;
  enableToolResultContextExtraction?: boolean; // default: false - extract summaries from large tool results via service model
  theme?: string;
  compaction?: CompactionSettings;
  branchSummary?: BranchSummarySettings;
  retry?: RetrySettings;
  hideThinkingBlock?: boolean;
  shellPath?: string; // Custom shell path (e.g., for Cygwin users on Windows)
  quietStartup?: boolean;
  defaultProjectTrust?: DefaultProjectTrust; // default: "ask"; global setting only
  shellCommandPrefix?: string; // Prefix prepended to every bash command (e.g., "shopt -s expand_aliases" for alias support)
  npmCommand?: string[]; // Command used for npm package lookup/install operations, argv-style (e.g., ["mise", "exec", "node@20", "--", "npm"])
  collapseChangelog?: boolean; // Show condensed changelog after update (use /changelog for full)
  startupNotices?: boolean; // Show startup notices (changelog, version check, package updates) — disabled by default after rebrand
  enableInstallTelemetry?: boolean; // default: true - anonymous version/update ping after changelog-detected updates
  enableAnalytics?: boolean; // default: false - opt-in analytics data sharing
  trackingId?: string; // analytics tracking identifier, generated when analytics is enabled
  packages?: PackageSource[]; // Array of npm/git package sources (string or object with filtering)
  extensions?: string[]; // Array of local extension file paths or directories
  skills?: string[]; // Array of local skill file paths or directories
  prompts?: string[]; // Array of local prompt template paths or directories
  themes?: string[]; // Array of local theme file paths or directories
  enableSkillCommands?: boolean; // default: true - register skills as /skill:name commands
  terminal?: TerminalSettings;
  images?: ImageSettings;
  enabledModels?: string[]; // Model patterns for cycling (same format as --models CLI flag)
  doubleEscapeAction?: "fork" | "tree" | "none"; // Action for double-escape with empty editor (default: "tree")
  treeFilterMode?: "default" | "no-tools" | "user-only" | "labeled-only" | "all"; // Default filter when opening /tree
  thinkingBudgets?: ThinkingBudgetsSettings; // Custom token budgets for thinking levels
  editorPaddingX?: number; // Horizontal padding for input editor (default: 0)
  autocompleteMaxVisible?: number; // Max visible items in autocomplete dropdown (default: 5)
  showHardwareCursor?: boolean; // Show terminal cursor while still positioning it for IME
  markdown?: MarkdownSettings;
  warnings?: WarningSettings;
  sessionDir?: string; // Custom session storage directory (same format as --session-dir CLI flag)
  httpIdleTimeoutMs?: number; // HTTP header/body idle timeout in milliseconds; 0 disables it
  websocketConnectTimeoutMs?: number; // WebSocket connect/open handshake timeout in milliseconds; 0 disables it
  planPanelMode?: "hidden" | "compact" | "expanded"; // Plan panel visibility state (persisted across sessions)
  planPanelCompactWidth?: number; // Compact plan panel width in columns (default: 50)
  planPanelHeight?: number; // Plan panel custom height in rows (undefined = auto)
}

export type SettingsScope = "global" | "project";

export interface SettingsManagerCreateOptions {
  projectTrusted?: boolean;
}

export interface SettingsStorage {
  withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void;
}

export interface SettingsError {
  scope: SettingsScope;
  error: Error;
}
