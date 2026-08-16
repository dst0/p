import type { Model, OAuthSelectPrompt } from "@dst0/p-ai";
import type { Component, Keybinding } from "@dst0/p-tui";
import type { AgentSessionEvent, CompactionDryRunResult } from "../../../core/agent-session.ts";
import type { ExtensionCommandContext } from "../../../core/extensions/index.ts";
import type { AppKeybinding } from "../../../core/keybindings.ts";
import type { LatestPiRelease } from "../../../utils/version-check.ts";
import type { LoginDialogComponent } from "../components/login-dialog.ts";
import type { AuthSelectorProvider } from "../components/oauth-selector.ts";

export interface InteractiveModeRuntimeMethods {
  renderProjectTrustWarningIfNeeded(): void;
  getUserInput(): Promise<string>;
  rebuildChatFromMessages(): void;
  handleCtrlC(): void;
  handleCtrlD(): void;
  shutdown(options?: { fromSignal?: boolean }): Promise<void>;
  emergencyTerminalExit(): never;
  uncaughtCrash(error: Error): never;
  checkShutdownRequested(): Promise<void>;
  registerSignalHandlers(): void;
  unregisterSignalHandlers(): void;
  handleCtrlZ(): void;
  handleFollowUp(): Promise<void>;
  handleDequeue(): void;
  updateEditorBorderColor(): void;
  cycleThinkingLevel(): void;
  cycleModel(direction: "forward" | "backward"): Promise<void>;
  toggleToolOutputExpansion(): void;
  setToolsExpanded(expanded: boolean): void;
  getModelStatusLabel(model: Model<any>): string;
  noteModelSwitch(previousModel: Model<any> | undefined, nextModel: Model<any>): void;
  getRecentModelSwitch():
    | {
        fromModel: string;
        toModel: string;
      }
    | undefined;
  clearLlmOrchestratorQueueProgress(): void;
  updateQueuedFooterSpinnerTimer(): void;
  removeTransientStreamingUi(): void;
  showRetryProgressInFooter(
    event: Extract<
      AgentSessionEvent,
      {
        type: "auto_retry_start";
      }
    >,
  ): void;
  toggleThinkingBlockVisibility(): void;
  openExternalEditor(): Promise<void>;
  clearEditor(): void;
  showError(errorMessage: string): void;
  showWarning(warningMessage: string): void;
  showNewVersionNotification(release: LatestPiRelease): void;
  showPackageUpdateNotification(packages: string[]): void;
  getAllQueuedMessages(): {
    steering: string[];
    followUp: string[];
  };
  clearAllQueues(): {
    steering: string[];
    followUp: string[];
  };
  updatePendingMessagesDisplay(): void;
  restoreQueuedMessagesToEditor(options?: { abort?: boolean; currentText?: string }): number;
  queueCompactionMessage(text: string, mode: "steer" | "followUp"): void;
  isExtensionCommand(text: string): boolean;
  flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void>;
  flushPendingBashComponents(): void;
  showSelector(
    create: (done: () => void) => {
      component: Component;
      focus: Component;
    },
  ): void;
  showSettingsSelector(): void;
  setShowHarnessMessages(enabled: boolean): void;
  handleModelCommand(searchTerm?: string): Promise<void>;
  findExactModelMatch(searchTerm: string): Promise<Model<any> | undefined>;
  getModelCandidates(): Promise<Model<any>[]>;
  updateAvailableProviderCount(): Promise<void>;
  maybeWarnAboutAnthropicSubscriptionAuth(model?: Model<any> | undefined): Promise<void>;
  maybeSaveImplicitProjectTrustAfterReload(): boolean;
  showTrustSelector(): void;
  showModelSelector(initialSearchInput?: string): void;
  showModelsSelector(): Promise<void>;
  showUserMessageSelector(): void;
  handleCloneCommand(): Promise<void>;
  showTreeSelector(initialSelectedId?: string): void;
  showSessionSelector(): void;
  handleResumeSession(
    sessionPath: string,
    options?: Parameters<ExtensionCommandContext["switchSession"]>[1],
  ): Promise<{
    cancelled: boolean;
  }>;
  getLoginProviderOptions(authType?: "oauth" | "api_key"): AuthSelectorProvider[];
  getLogoutProviderOptions(): AuthSelectorProvider[];
  showLoginAuthTypeSelector(): void;
  showLoginProviderSelector(authType: "oauth" | "api_key"): void;
  showOAuthSelector(mode: "login" | "logout"): Promise<void>;
  completeProviderAuthentication(
    providerId: string,
    providerName: string,
    authType: "oauth" | "api_key",
    previousModel: Model<any> | undefined,
  ): Promise<void>;
  showBedrockSetupDialog(providerId: string, providerName: string): void;
  showApiKeyLoginDialog(providerId: string, providerName: string): Promise<void>;
  showOAuthLoginSelect(dialog: LoginDialogComponent, prompt: OAuthSelectPrompt): Promise<string | undefined>;
  showLoginDialog(providerId: string, providerName: string): Promise<void>;
  handlePlanCommand(text: string): Promise<void>;
  handleReloadCommand(): Promise<void>;
  handleExportCommand(text: string): Promise<void>;
  getPathCommandArgument(text: string, command: "/export" | "/import"): string | undefined;
  handleImportCommand(text: string): Promise<void>;
  handleShareCommand(): Promise<void>;
  handleCopyCommand(): Promise<void>;
  handleNameCommand(text: string): void;
  handleSessionCommand(): void;
  handleStateCommand(): void;
  handleMemoryCommand(text: string): void;
  handleRulesCommand(text: string): void;
  handleLearnCommand(text: string): void;
  handleIndexCommand(text?: string): Promise<void>;
  buildIndexStatusText(resolvedPath: string, args: string): Promise<string>;
  handleChangelogCommand(): void;
  getAppKeyDisplay(action: AppKeybinding): string;
  getEditorKeyDisplay(action: Keybinding): string;
  handleHotkeysCommand(): void;
  handleClearCommand(): Promise<void>;
  handleDebugCommand(): void;
  handleArminSaysHi(): void;
  handleDementedDelves(): void;
  handleDaxnuts(): void;
  checkDaxnutsEasterEgg(model: { provider: string; id: string }): void;
  handleBashCommand(command: string, excludeFromContext?: boolean): Promise<void>;
  formatCompactionDryRun(result: CompactionDryRunResult): string;
  handleCompactCommand(
    customInstructions?: string,
    options?: {
      dryRun?: boolean;
      audit?: boolean;
    },
  ): Promise<void>;
  stop(): void;
}
