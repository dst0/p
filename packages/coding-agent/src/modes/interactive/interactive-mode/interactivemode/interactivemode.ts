import type { AgentMessage } from "@dst0/p-agent-core";
import type { AssistantMessage, Message, Model, OAuthSelectPrompt } from "@dst0/p-ai";
import type {
  AutocompleteProvider,
  EditorComponent,
  Keybinding,
  MarkdownTheme,
  OverlayHandle,
  OverlayOptions,
} from "@dst0/p-tui";
import {
  type Component,
  Container,
  type Loader,
  type LoaderIndicatorOptions,
  ProcessTerminal,
  type Spacer,
  setKeybindings,
  type Text,
  TUI,
} from "@dst0/p-tui";
import { VERSION } from "../../../../config.ts";
import type { AgentSession, AgentSessionEvent, CompactionDryRunResult } from "../../../../core/agent-session.ts";
import type { AgentSessionRuntime } from "../../../../core/agent-session-runtime.ts";
import type {
  AutocompleteProviderFactory,
  EditorFactory,
  ExtensionCommandContext,
  ExtensionRunner,
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
  ProjectTrustContext,
} from "../../../../core/extensions/index.ts";
import { FooterDataProvider, type ReadonlyFooterDataProvider } from "../../../../core/footer-data-provider.ts";
import { getIndexingService, type IndexingService } from "../../../../core/indexing-service.ts";
import { type AppKeybinding, KeybindingsManager } from "../../../../core/keybindings.ts";
import type { ResourceDiagnostic } from "../../../../core/resource-loader.ts";
import type { MissingSessionCwdError } from "../../../../core/session-cwd.ts";
import type { SessionContext } from "../../../../core/session-manager.ts";
import type { SourceInfo } from "../../../../core/source-info.ts";
import type { LatestPiRelease } from "../../../../utils/version-check.ts";
import type { AssistantMessageComponent } from "../../components/assistant-message.ts";
import type { BashExecutionComponent } from "../../components/bash-execution.ts";
import type { CountdownTimer } from "../../components/countdown-timer.ts";
import { CustomEditor } from "../../components/custom-editor.ts";
import type { ExtensionEditorComponent } from "../../components/extension-editor.ts";
import type { ExtensionInputComponent } from "../../components/extension-input.ts";
import type { ExtensionSelectorComponent } from "../../components/extension-selector.ts";
import { FooterComponent } from "../../components/footer.ts";
import type { LoginDialogComponent } from "../../components/login-dialog.ts";
import type { AuthSelectorProvider } from "../../components/oauth-selector.ts";
import { PlanPanel, type PlanPanelMode, PlanStatusTracker, type SgrMouseEvent } from "../../components/plan-panel.ts";
import type { ToolExecutionComponent } from "../../components/tool-execution.ts";
import { getEditorTheme, initTheme, setRegisteredThemes, type Theme } from "../../theme/theme.ts";
import { DEFAULT_PLAN_PANEL_WIDTH } from "../constants.ts";
import type { CompactionQueuedMessage, InteractiveModeOptions, PlanPanelBounds, PlanPanelDragMode } from "../types.ts";
import {
  do_applyRuntimeSettings,
  do_bindCurrentSessionExtensions,
  do_buildScopeGroups,
  do_checkForPackageUpdates,
  do_checkTmuxKeyboardSetup,
  do_createBaseAutocompleteProvider,
  do_detectThemeIfUnset,
  do_findSourceInfoForPath,
  do_formatContextPath,
  do_formatDiagnostics,
  do_formatDisplayPath,
  do_formatExtensionDisplayPath,
  do_formatPathWithSource,
  do_formatScopeGroups,
  do_getAutocompleteSourceTag,
  do_getBuiltInCommandConflictDiagnostics,
  do_getChangelogForDisplay,
  do_getCompactDisplayPathSegments,
  do_getCompactExtensionLabel,
  do_getCompactExtensionLabels,
  do_getCompactNonPackageExtensionLabel,
  do_getCompactPackageSourceLabel,
  do_getCompactPathLabel,
  do_getDisplaySourceInfo,
  do_getMarkdownThemeWithSettings,
  do_getRegisteredToolDefinition,
  do_getScopeGroup,
  do_getShortPath,
  do_getStartupExpansionState,
  do_handleFatalRuntimeError,
  do_init,
  do_isPackageSource,
  do_prefixAutocompleteDescription,
  do_rebindCurrentSession,
  do_renderCurrentSessionState,
  do_reportInstallTelemetry,
  do_run,
  do_setupAutocompleteProvider,
  do_setupExtensionShortcuts,
  do_showLoadedResources,
  do_showStartupNoticesIfNeeded,
  do_updateTerminalBackground,
  do_updateTerminalTitle,
} from "./interactivemode-methods/methods-part1.ts";
import {
  do_addExtensionTerminalInputListener,
  do_clearExtensionTerminalInputListeners,
  do_clearExtensionWidgets,
  do_createExtensionUIContext,
  do_createProjectTrustContext,
  do_createWorkingLoader,
  do_getPlanPanelBounds,
  do_getPlanPanelCompactWidth,
  do_getPlanPanelMaxHeight,
  do_getUserMessageText,
  do_getWorkingLoaderMessage,
  do_handleClipboardImagePaste,
  do_handleEvent,
  do_handlePlanPanelInput,
  do_hideExtensionEditor,
  do_hideExtensionInput,
  do_hideExtensionSelector,
  do_hidePlanPanel,
  do_promptForCodeIndexingIfNeeded,
  do_promptForMissingSessionCwd,
  do_renderWidgetContainer,
  do_renderWidgets,
  do_resetExtensionUI,
  do_scrollPlanPanel,
  do_setCustomEditorComponent,
  do_setExtensionFooter,
  do_setExtensionHeader,
  do_setExtensionStatus,
  do_setExtensionWidget,
  do_setHiddenThinkingLabel,
  do_setPlanPanelMouseMode,
  do_setupEditorSubmitHandler,
  do_setupKeyHandlers,
  do_setWorkingIndicator,
  do_setWorkingVisible,
  do_showExtensionConfirm,
  do_showExtensionCustom,
  do_showExtensionEditor,
  do_showExtensionError,
  do_showExtensionInput,
  do_showExtensionNotify,
  do_showExtensionSelector,
  do_showPlanPanelOverlay,
  do_stopWorkingLoader,
  do_subscribeToAgent,
  do_togglePlanPanel,
} from "./interactivemode-methods/methods-part2.ts";
import {
  do_addMessageToChat,
  do_checkShutdownRequested,
  do_clearAllQueues,
  do_clearEditor,
  do_clearLlmOrchestratorQueueProgress,
  do_cycleModel,
  do_cycleThinkingLevel,
  do_emergencyTerminalExit,
  do_flushCompactionQueue,
  do_flushPendingBashComponents,
  do_getAllQueuedMessages,
  do_getModelStatusLabel,
  do_getRecentModelSwitch,
  do_getUserInput,
  do_handleCtrlC,
  do_handleCtrlD,
  do_handleCtrlZ,
  do_handleDequeue,
  do_handleFollowUp,
  do_handlePlanPanelMouse,
  do_isExtensionCommand,
  do_noteModelSwitch,
  do_openExternalEditor,
  do_queueCompactionMessage,
  do_rebuildChatFromMessages,
  do_registerSignalHandlers,
  do_removeTransientStreamingUi,
  do_renderInitialMessages,
  do_renderProjectTrustWarningIfNeeded,
  do_renderSessionContext,
  do_resizePlanPanel,
  do_restoreQueuedMessagesToEditor,
  do_setPlanPanelSize,
  do_setToolsExpanded,
  do_showError,
  do_showNewVersionNotification,
  do_showPackageUpdateNotification,
  do_showRetryProgressInFooter,
  do_showSelector,
  do_showStatus,
  do_showWarning,
  do_shutdown,
  do_syncPlanTracker,
  do_toggleThinkingBlockVisibility,
  do_toggleToolOutputExpansion,
  do_uncaughtCrash,
  do_unregisterSignalHandlers,
  do_updateEditorBorderColor,
  do_updatePendingMessagesDisplay,
  do_updateQueuedFooterSpinnerTimer,
} from "./interactivemode-methods/methods-part3.ts";
import {
  do_buildIndexStatusText,
  do_checkDaxnutsEasterEgg,
  do_completeProviderAuthentication,
  do_findExactModelMatch,
  do_getAppKeyDisplay,
  do_getEditorKeyDisplay,
  do_getLoginProviderOptions,
  do_getLogoutProviderOptions,
  do_getModelCandidates,
  do_getPathCommandArgument,
  do_handleArminSaysHi,
  do_handleChangelogCommand,
  do_handleClearCommand,
  do_handleCloneCommand,
  do_handleCopyCommand,
  do_handleDaxnuts,
  do_handleDebugCommand,
  do_handleDementedDelves,
  do_handleExportCommand,
  do_handleHotkeysCommand,
  do_handleImportCommand,
  do_handleIndexCommand,
  do_handleMemoryCommand,
  do_handleModelCommand,
  do_handleNameCommand,
  do_handlePlanCommand,
  do_handleReloadCommand,
  do_handleResumeSession,
  do_handleRulesCommand,
  do_handleSessionCommand,
  do_handleShareCommand,
  do_handleStateCommand,
  do_maybeSaveImplicitProjectTrustAfterReload,
  do_maybeWarnAboutAnthropicSubscriptionAuth,
  do_setShowHarnessMessages,
  do_showApiKeyLoginDialog,
  do_showBedrockSetupDialog,
  do_showLoginAuthTypeSelector,
  do_showLoginDialog,
  do_showLoginProviderSelector,
  do_showModelSelector,
  do_showModelsSelector,
  do_showOAuthLoginSelect,
  do_showOAuthSelector,
  do_showSessionSelector,
  do_showSettingsSelector,
  do_showTreeSelector,
  do_showTrustSelector,
  do_showUserMessageSelector,
  do_updateAvailableProviderCount,
} from "./interactivemode-methods/methods-part4.ts";
import {
  do_formatCompactionDryRun,
  do_handleBashCommand,
  do_handleCompactCommand,
  do_stop,
} from "./interactivemode-methods/methods-part5.ts";

export class InteractiveMode {
  public runtimeHost: AgentSessionRuntime;

  public ui: TUI;

  public chatContainer: Container;

  public pendingMessagesContainer: Container;

  public statusContainer: Container;

  public defaultEditor: CustomEditor;

  public editor: EditorComponent;

  public editorComponentFactory: EditorFactory | undefined;

  public autocompleteProvider: AutocompleteProvider | undefined;

  public autocompleteProviderWrappers: AutocompleteProviderFactory[] = [];

  public fdPath: string | undefined;

  public editorContainer: Container;

  public footer: FooterComponent;

  public footerDataProvider: FooterDataProvider;

  public queuedFooterSpinnerTimer: ReturnType<typeof setInterval> | undefined = undefined;

  public keybindings: KeybindingsManager;

  public version: string;

  public isInitialized = false;

  public onInputCallback?: (text: string) => void;

  public pendingUserInputs: string[] = [];

  public loadingAnimation: Loader | undefined = undefined;

  public workingMessage: string | undefined = undefined;

  public workingVisible = true;

  public planStatusTracker = new PlanStatusTracker();

  public planPanel = new PlanPanel(this.planStatusTracker);

  public planPanelHandle?: OverlayHandle;

  public planPanelMode: PlanPanelMode = "hidden";

  public planPanelCompactWidth = DEFAULT_PLAN_PANEL_WIDTH;

  public planPanelHeight: number | undefined;

  public planPanelDragMode: PlanPanelDragMode | undefined;

  public planPanelMouseMode = false;

  public planPanelInputUnsubscribe: (() => void) | undefined;

  public workingIndicatorOptions: LoaderIndicatorOptions | undefined = undefined;

  public readonly defaultWorkingMessage = "Working...";

  public readonly defaultHiddenThinkingLabel = "Thinking...";

  public hiddenThinkingLabel = this.defaultHiddenThinkingLabel;

  public lastModelSwitch:
    | {
        fromModel: string;
        toModel: string;
        timestamp: number;
      }
    | undefined;

  public lastSigintTime = 0;

  public lastEscapeTime = 0;

  public changelogMarkdown: string | undefined = undefined;

  public startupNoticesShown = false;

  public anthropicSubscriptionWarningShown = false;

  public readonly indexingService: IndexingService = getIndexingService();

  public codeIndexingPrompt: Promise<void> | undefined;

  public lastStatusSpacer: Spacer | undefined = undefined;

  public lastStatusText: Text | undefined = undefined;

  public streamingComponent: AssistantMessageComponent | undefined = undefined;

  public streamingMessage: AssistantMessage | undefined = undefined;

  public pendingTools = new Map<string, ToolExecutionComponent>();

  public toolOutputExpanded = false;

  public hideThinkingBlock = false;

  public skillCommands = new Map<string, string>();

  public unsubscribe?: () => void;

  public signalCleanupHandlers: Array<() => void> = [];

  public isBashMode = false;

  public bashComponent: BashExecutionComponent | undefined = undefined;

  public pendingBashComponents: BashExecutionComponent[] = [];

  public autoCompactionLoader: Loader | undefined = undefined;

  public autoCompactionEscapeHandler?: () => void;

  public retryLoader: Loader | undefined = undefined;

  public retryCountdown: CountdownTimer | undefined = undefined;

  public retryEscapeHandler?: () => void;

  public compactionQueuedMessages: CompactionQueuedMessage[] = [];

  public shutdownRequested = false;

  public extensionSelector: ExtensionSelectorComponent | undefined = undefined;

  public extensionInput: ExtensionInputComponent | undefined = undefined;

  public extensionEditor: ExtensionEditorComponent | undefined = undefined;

  public extensionTerminalInputUnsubscribers = new Set<() => void>();

  public extensionWidgetsAbove = new Map<string, Component & { dispose?(): void }>();

  public extensionWidgetsBelow = new Map<string, Component & { dispose?(): void }>();

  public widgetContainerAbove!: Container;

  public widgetContainerBelow!: Container;

  public customFooter: (Component & { dispose?(): void }) | undefined = undefined;

  public headerContainer: Container;

  public builtInHeader: Component | undefined = undefined;

  public customHeader: (Component & { dispose?(): void }) | undefined = undefined;

  public options: InteractiveModeOptions;

  public autoTrustOnReloadCwd: string | undefined;

  public get session(): AgentSession {
    return this.runtimeHost.session;
  }

  public get agent() {
    return this.session.agent;
  }

  public get sessionManager() {
    return this.session.sessionManager;
  }

  public get settingsManager() {
    return this.session.settingsManager;
  }

  constructor(runtimeHost: AgentSessionRuntime, options: InteractiveModeOptions = {}) {
    this.runtimeHost = runtimeHost;
    this.options = options;
    this.autoTrustOnReloadCwd = options.autoTrustOnReloadCwd;
    this.runtimeHost.setBeforeSessionInvalidate(() => {
      this.resetExtensionUI();
    });
    this.runtimeHost.setRebindSession(async () => {
      await this.rebindCurrentSession();
    });
    this.version = VERSION;
    this.ui = new TUI(new ProcessTerminal(), this.settingsManager.getShowHardwareCursor());
    this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink());
    this.headerContainer = new Container();
    this.chatContainer = new Container();
    this.pendingMessagesContainer = new Container();
    this.statusContainer = new Container();
    this.widgetContainerAbove = new Container();
    this.widgetContainerBelow = new Container();
    this.keybindings = KeybindingsManager.create();
    setKeybindings(this.keybindings);
    this.planPanelInputUnsubscribe = this.ui.addInputListener((data) => this.handlePlanPanelInput(data));
    const editorPaddingX = this.settingsManager.getEditorPaddingX();
    const autocompleteMaxVisible = this.settingsManager.getAutocompleteMaxVisible();
    this.defaultEditor = new CustomEditor(this.ui, getEditorTheme(), this.keybindings, {
      paddingX: editorPaddingX,
      autocompleteMaxVisible,
    });
    this.editor = this.defaultEditor;
    this.editorContainer = new Container();
    this.editorContainer.addChild(this.editor as Component);
    this.footerDataProvider = new FooterDataProvider(this.sessionManager.getCwd());
    this.footer = new FooterComponent(this.session, this.footerDataProvider);
    this.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);
    this.footer.setShowTokenProgress(this.settingsManager.getShowTokenProgress());
    this.footer.setShowTokenStats(this.settingsManager.getShowTokenStats());
    this.footer.setShowIndexingInfo(this.settingsManager.getShowIndexingInfo());

    // Load hide thinking block setting
    this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();

    // Register themes from resource loader and initialize
    setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
    initTheme(this.settingsManager.getTheme(), true);
    this.updateTerminalBackground();

    // Load plan panel settings from persistent storage
    this.planPanelMode = this.settingsManager.getPlanPanelMode();
    this.planPanelCompactWidth = this.settingsManager.getPlanPanelCompactWidth();
    this.planPanelHeight = this.settingsManager.getPlanPanelHeight();
  }

  public static readonly MAX_WIDGET_LINES = 10;

  public isShuttingDown = false;

  updateTerminalBackground(): void {
    do_updateTerminalBackground(this);
  }

  async detectThemeIfUnset(): Promise<void> {
    return do_detectThemeIfUnset(this);
  }

  getAutocompleteSourceTag(sourceInfo?: SourceInfo): string | undefined {
    return do_getAutocompleteSourceTag(this, sourceInfo);
  }

  prefixAutocompleteDescription(description: string | undefined, sourceInfo?: SourceInfo): string | undefined {
    return do_prefixAutocompleteDescription(this, description, sourceInfo);
  }

  getBuiltInCommandConflictDiagnostics(extensionRunner: ExtensionRunner): ResourceDiagnostic[] {
    return do_getBuiltInCommandConflictDiagnostics(this, extensionRunner);
  }

  createBaseAutocompleteProvider(): AutocompleteProvider {
    return do_createBaseAutocompleteProvider(this);
  }

  setupAutocompleteProvider(): void {
    do_setupAutocompleteProvider(this);
  }

  showStartupNoticesIfNeeded(): void {
    do_showStartupNoticesIfNeeded(this);
  }

  async init(): Promise<void> {
    return do_init(this);
  }

  updateTerminalTitle(): void {
    do_updateTerminalTitle(this);
  }

  async run(): Promise<void> {
    return do_run(this);
  }

  async checkForPackageUpdates(): Promise<string[]> {
    return do_checkForPackageUpdates(this);
  }

  async checkTmuxKeyboardSetup(): Promise<string | undefined> {
    return do_checkTmuxKeyboardSetup(this);
  }

  getChangelogForDisplay(): string | undefined {
    return do_getChangelogForDisplay(this);
  }

  reportInstallTelemetry(version: string): void {
    do_reportInstallTelemetry(this, version);
  }

  getMarkdownThemeWithSettings(): MarkdownTheme {
    return do_getMarkdownThemeWithSettings(this);
  }

  formatDisplayPath(p: string): string {
    return do_formatDisplayPath(this, p);
  }

  formatExtensionDisplayPath(path: string): string {
    return do_formatExtensionDisplayPath(this, path);
  }

  formatContextPath(p: string): string {
    return do_formatContextPath(this, p);
  }

  getStartupExpansionState(): boolean {
    return do_getStartupExpansionState(this);
  }

  getShortPath(fullPath: string, sourceInfo?: SourceInfo): string {
    return do_getShortPath(this, fullPath, sourceInfo);
  }

  getCompactPathLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
    return do_getCompactPathLabel(this, resourcePath, sourceInfo);
  }

  getCompactPackageSourceLabel(sourceInfo?: SourceInfo): string {
    return do_getCompactPackageSourceLabel(this, sourceInfo);
  }

  getCompactExtensionLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
    return do_getCompactExtensionLabel(this, resourcePath, sourceInfo);
  }

  getCompactDisplayPathSegments(resourcePath: string): string[] {
    return do_getCompactDisplayPathSegments(this, resourcePath);
  }

  getCompactNonPackageExtensionLabel(
    resourcePath: string,
    index: number,
    allPaths: Array<{ path: string; segments: string[] }>,
  ): string {
    return do_getCompactNonPackageExtensionLabel(this, resourcePath, index, allPaths);
  }

  getCompactExtensionLabels(extensions: Array<{ path: string; sourceInfo?: SourceInfo }>): string[] {
    return do_getCompactExtensionLabels(this, extensions);
  }

  getDisplaySourceInfo(sourceInfo?: SourceInfo): {
    label: string;
    scopeLabel?: string;
    color: "accent" | "muted";
  } {
    return do_getDisplaySourceInfo(this, sourceInfo);
  }

  getScopeGroup(sourceInfo?: SourceInfo): "user" | "project" | "path" {
    return do_getScopeGroup(this, sourceInfo);
  }

  isPackageSource(sourceInfo?: SourceInfo): boolean {
    return do_isPackageSource(this, sourceInfo);
  }

  buildScopeGroups(items: Array<{ path: string; sourceInfo?: SourceInfo }>): Array<{
    scope: "user" | "project" | "path";
    paths: Array<{ path: string; sourceInfo?: SourceInfo }>;
    packages: Map<string, Array<{ path: string; sourceInfo?: SourceInfo }>>;
  }> {
    return do_buildScopeGroups(this, items);
  }

  formatScopeGroups(
    groups: Array<{
      scope: "user" | "project" | "path";
      paths: Array<{ path: string; sourceInfo?: SourceInfo }>;
      packages: Map<string, Array<{ path: string; sourceInfo?: SourceInfo }>>;
    }>,
    options: {
      formatPath: (item: { path: string; sourceInfo?: SourceInfo }) => string;
      formatPackagePath: (item: { path: string; sourceInfo?: SourceInfo }, source: string) => string;
    },
  ): string {
    return do_formatScopeGroups(this, groups, options);
  }

  findSourceInfoForPath(p: string, sourceInfos: Map<string, SourceInfo>): SourceInfo | undefined {
    return do_findSourceInfoForPath(this, p, sourceInfos);
  }

  formatPathWithSource(p: string, sourceInfo?: SourceInfo): string {
    return do_formatPathWithSource(this, p, sourceInfo);
  }

  formatDiagnostics(diagnostics: readonly ResourceDiagnostic[], sourceInfos: Map<string, SourceInfo>): string {
    return do_formatDiagnostics(this, diagnostics, sourceInfos);
  }

  showLoadedResources(options?: {
    extensions?: Array<{ path: string; sourceInfo?: SourceInfo }>;
    force?: boolean;
    showDiagnosticsWhenQuiet?: boolean;
  }): void {
    do_showLoadedResources(this, options);
  }

  async bindCurrentSessionExtensions(): Promise<void> {
    return do_bindCurrentSessionExtensions(this);
  }

  applyRuntimeSettings(): void {
    do_applyRuntimeSettings(this);
  }

  async rebindCurrentSession(): Promise<void> {
    return do_rebindCurrentSession(this);
  }

  async handleFatalRuntimeError(prefix: string, error: unknown): Promise<never> {
    return do_handleFatalRuntimeError(this, prefix, error);
  }

  renderCurrentSessionState(): void {
    do_renderCurrentSessionState(this);
  }

  getRegisteredToolDefinition(toolName: string) {
    return do_getRegisteredToolDefinition(this, toolName);
  }

  setupExtensionShortcuts(extensionRunner: ExtensionRunner): void {
    do_setupExtensionShortcuts(this, extensionRunner);
  }

  setExtensionStatus(key: string, text: string | undefined): void {
    do_setExtensionStatus(this, key, text);
  }

  getWorkingLoaderMessage(): string {
    return do_getWorkingLoaderMessage(this);
  }

  createWorkingLoader(): Loader {
    return do_createWorkingLoader(this);
  }

  stopWorkingLoader(): void {
    do_stopWorkingLoader(this);
  }

  setWorkingVisible(visible: boolean): void {
    do_setWorkingVisible(this, visible);
  }

  setWorkingIndicator(options?: LoaderIndicatorOptions): void {
    do_setWorkingIndicator(this, options);
  }

  setHiddenThinkingLabel(label?: string): void {
    do_setHiddenThinkingLabel(this, label);
  }

  setExtensionWidget(
    key: string,
    content: string[] | ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined,
    options?: ExtensionWidgetOptions,
  ): void {
    do_setExtensionWidget(this, key, content, options);
  }

  clearExtensionWidgets(): void {
    do_clearExtensionWidgets(this);
  }

  resetExtensionUI(): void {
    do_resetExtensionUI(this);
  }

  renderWidgets(): void {
    do_renderWidgets(this);
  }

  renderWidgetContainer(
    container: Container,
    widgets: Map<string, Component & { dispose?(): void }>,
    spacerWhenEmpty: boolean,
    leadingSpacer: boolean,
  ): void {
    do_renderWidgetContainer(this, container, widgets, spacerWhenEmpty, leadingSpacer);
  }

  setExtensionFooter(
    factory:
      | ((tui: TUI, thm: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose?(): void })
      | undefined,
  ): void {
    do_setExtensionFooter(this, factory);
  }

  setExtensionHeader(factory: ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined): void {
    do_setExtensionHeader(this, factory);
  }

  addExtensionTerminalInputListener(
    handler: (data: string) => { consume?: boolean; data?: string } | undefined,
  ): () => void {
    return do_addExtensionTerminalInputListener(this, handler);
  }

  clearExtensionTerminalInputListeners(): void {
    do_clearExtensionTerminalInputListeners(this);
  }

  createProjectTrustContext(cwd: string): ProjectTrustContext {
    return do_createProjectTrustContext(this, cwd);
  }

  createExtensionUIContext(): ExtensionUIContext {
    return do_createExtensionUIContext(this);
  }

  showExtensionSelector(
    title: string,
    options: string[],
    opts?: ExtensionUIDialogOptions,
  ): Promise<string | undefined> {
    return do_showExtensionSelector(this, title, options, opts);
  }

  hideExtensionSelector(): void {
    do_hideExtensionSelector(this);
  }

  async showExtensionConfirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean> {
    return do_showExtensionConfirm(this, title, message, opts);
  }

  async promptForMissingSessionCwd(error: MissingSessionCwdError): Promise<string | undefined> {
    return do_promptForMissingSessionCwd(this, error);
  }

  async promptForCodeIndexingIfNeeded(): Promise<void> {
    return do_promptForCodeIndexingIfNeeded(this);
  }

  showExtensionInput(
    title: string,
    placeholder?: string,
    opts?: ExtensionUIDialogOptions,
  ): Promise<string | undefined> {
    return do_showExtensionInput(this, title, placeholder, opts);
  }

  hideExtensionInput(): void {
    do_hideExtensionInput(this);
  }

  showExtensionEditor(title: string, prefill?: string): Promise<string | undefined> {
    return do_showExtensionEditor(this, title, prefill);
  }

  hideExtensionEditor(): void {
    do_hideExtensionEditor(this);
  }

  setCustomEditorComponent(factory: EditorFactory | undefined): void {
    do_setCustomEditorComponent(this, factory);
  }

  showExtensionNotify(message: string, type?: "info" | "warning" | "error"): void {
    do_showExtensionNotify(this, message, type);
  }

  async showExtensionCustom<T>(
    factory: (
      tui: TUI,
      theme: Theme,
      keybindings: KeybindingsManager,
      done: (result: T) => void,
    ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
    options?: {
      overlay?: boolean;
      overlayOptions?: OverlayOptions | (() => OverlayOptions);
      onHandle?: (handle: OverlayHandle) => void;
    },
  ): Promise<T> {
    return do_showExtensionCustom(this, factory, options);
  }

  showExtensionError(extensionPath: string, error: string, stack?: string): void {
    do_showExtensionError(this, extensionPath, error, stack);
  }

  setupKeyHandlers(): void {
    do_setupKeyHandlers(this);
  }

  async handleClipboardImagePaste(): Promise<void> {
    return do_handleClipboardImagePaste(this);
  }

  setupEditorSubmitHandler(): void {
    do_setupEditorSubmitHandler(this);
  }

  subscribeToAgent(): void {
    do_subscribeToAgent(this);
  }

  async handleEvent(event: AgentSessionEvent): Promise<void> {
    return do_handleEvent(this, event);
  }

  getUserMessageText(message: Message): string {
    return do_getUserMessageText(this, message);
  }

  togglePlanPanel(): void {
    do_togglePlanPanel(this);
  }

  hidePlanPanel(): void {
    do_hidePlanPanel(this);
  }

  showPlanPanelOverlay(): void {
    do_showPlanPanelOverlay(this);
  }

  getPlanPanelMaxHeight(): number {
    return do_getPlanPanelMaxHeight(this);
  }

  getPlanPanelCompactWidth(): number {
    return do_getPlanPanelCompactWidth(this);
  }

  getPlanPanelBounds(): PlanPanelBounds {
    return do_getPlanPanelBounds(this);
  }

  handlePlanPanelInput(data: string): { consume: boolean } | undefined {
    return do_handlePlanPanelInput(this, data);
  }

  setPlanPanelMouseMode(active: boolean): void {
    do_setPlanPanelMouseMode(this, active);
  }

  scrollPlanPanel(direction: -1 | 1): void {
    do_scrollPlanPanel(this, direction);
  }

  resizePlanPanel(widthDelta: number, heightDelta: number): void {
    do_resizePlanPanel(this, widthDelta, heightDelta);
  }

  setPlanPanelSize(width: number | undefined, height: number | undefined): void {
    do_setPlanPanelSize(this, width, height);
  }

  handlePlanPanelMouse(event: SgrMouseEvent): boolean {
    return do_handlePlanPanelMouse(this, event);
  }

  syncPlanTracker(): void {
    do_syncPlanTracker(this);
  }

  showStatus(message: string): void {
    do_showStatus(this, message);
  }

  addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void {
    do_addMessageToChat(this, message, options);
  }

  renderSessionContext(
    sessionContext: SessionContext,
    options: { updateFooter?: boolean; populateHistory?: boolean } = {},
  ): void {
    do_renderSessionContext(this, sessionContext, options);
  }

  renderInitialMessages(): void {
    do_renderInitialMessages(this);
  }

  renderProjectTrustWarningIfNeeded(): void {
    do_renderProjectTrustWarningIfNeeded(this);
  }

  async getUserInput(): Promise<string> {
    return do_getUserInput(this);
  }

  rebuildChatFromMessages(): void {
    do_rebuildChatFromMessages(this);
  }

  handleCtrlC(): void {
    do_handleCtrlC(this);
  }

  handleCtrlD(): void {
    do_handleCtrlD(this);
  }

  async shutdown(options?: { fromSignal?: boolean }): Promise<void> {
    return do_shutdown(this, options);
  }

  emergencyTerminalExit(): never {
    return do_emergencyTerminalExit(this);
  }

  uncaughtCrash(error: Error): never {
    return do_uncaughtCrash(this, error);
  }

  async checkShutdownRequested(): Promise<void> {
    return do_checkShutdownRequested(this);
  }

  registerSignalHandlers(): void {
    do_registerSignalHandlers(this);
  }

  unregisterSignalHandlers(): void {
    do_unregisterSignalHandlers(this);
  }

  handleCtrlZ(): void {
    do_handleCtrlZ(this);
  }

  async handleFollowUp(): Promise<void> {
    return do_handleFollowUp(this);
  }

  handleDequeue(): void {
    do_handleDequeue(this);
  }

  updateEditorBorderColor(): void {
    do_updateEditorBorderColor(this);
  }

  cycleThinkingLevel(): void {
    do_cycleThinkingLevel(this);
  }

  async cycleModel(direction: "forward" | "backward"): Promise<void> {
    return do_cycleModel(this, direction);
  }

  toggleToolOutputExpansion(): void {
    do_toggleToolOutputExpansion(this);
  }

  setToolsExpanded(expanded: boolean): void {
    do_setToolsExpanded(this, expanded);
  }

  getModelStatusLabel(model: Model<any>): string {
    return do_getModelStatusLabel(this, model);
  }

  noteModelSwitch(previousModel: Model<any> | undefined, nextModel: Model<any>): void {
    do_noteModelSwitch(this, previousModel, nextModel);
  }

  getRecentModelSwitch(): { fromModel: string; toModel: string } | undefined {
    return do_getRecentModelSwitch(this);
  }

  clearLlmOrchestratorQueueProgress(): void {
    do_clearLlmOrchestratorQueueProgress(this);
  }

  updateQueuedFooterSpinnerTimer(): void {
    do_updateQueuedFooterSpinnerTimer(this);
  }

  removeTransientStreamingUi(): void {
    do_removeTransientStreamingUi(this);
  }

  showRetryProgressInFooter(event: Extract<AgentSessionEvent, { type: "auto_retry_start" }>): void {
    do_showRetryProgressInFooter(this, event);
  }

  toggleThinkingBlockVisibility(): void {
    do_toggleThinkingBlockVisibility(this);
  }

  async openExternalEditor(): Promise<void> {
    return do_openExternalEditor(this);
  }

  clearEditor(): void {
    do_clearEditor(this);
  }

  showError(errorMessage: string): void {
    do_showError(this, errorMessage);
  }

  showWarning(warningMessage: string): void {
    do_showWarning(this, warningMessage);
  }

  showNewVersionNotification(release: LatestPiRelease): void {
    do_showNewVersionNotification(this, release);
  }

  showPackageUpdateNotification(packages: string[]): void {
    do_showPackageUpdateNotification(this, packages);
  }

  getAllQueuedMessages(): { steering: string[]; followUp: string[] } {
    return do_getAllQueuedMessages(this);
  }

  clearAllQueues(): { steering: string[]; followUp: string[] } {
    return do_clearAllQueues(this);
  }

  updatePendingMessagesDisplay(): void {
    do_updatePendingMessagesDisplay(this);
  }

  restoreQueuedMessagesToEditor(options?: { abort?: boolean; currentText?: string }): number {
    return do_restoreQueuedMessagesToEditor(this, options);
  }

  queueCompactionMessage(text: string, mode: "steer" | "followUp"): void {
    do_queueCompactionMessage(this, text, mode);
  }

  isExtensionCommand(text: string): boolean {
    return do_isExtensionCommand(this, text);
  }

  async flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void> {
    return do_flushCompactionQueue(this, options);
  }

  flushPendingBashComponents(): void {
    do_flushPendingBashComponents(this);
  }

  showSelector(create: (done: () => void) => { component: Component; focus: Component }): void {
    do_showSelector(this, create);
  }

  showSettingsSelector(): void {
    do_showSettingsSelector(this);
  }

  setShowHarnessMessages(enabled: boolean): void {
    do_setShowHarnessMessages(this, enabled);
  }

  async handleModelCommand(searchTerm?: string): Promise<void> {
    return do_handleModelCommand(this, searchTerm);
  }

  async findExactModelMatch(searchTerm: string): Promise<Model<any> | undefined> {
    return do_findExactModelMatch(this, searchTerm);
  }

  async getModelCandidates(): Promise<Model<any>[]> {
    return do_getModelCandidates(this);
  }

  async updateAvailableProviderCount(): Promise<void> {
    return do_updateAvailableProviderCount(this);
  }

  async maybeWarnAboutAnthropicSubscriptionAuth(model: Model<any> | undefined = this.session.model): Promise<void> {
    return do_maybeWarnAboutAnthropicSubscriptionAuth(this, model);
  }

  maybeSaveImplicitProjectTrustAfterReload(): boolean {
    return do_maybeSaveImplicitProjectTrustAfterReload(this);
  }

  showTrustSelector(): void {
    do_showTrustSelector(this);
  }

  showModelSelector(initialSearchInput?: string): void {
    do_showModelSelector(this, initialSearchInput);
  }

  async showModelsSelector(): Promise<void> {
    return do_showModelsSelector(this);
  }

  showUserMessageSelector(): void {
    do_showUserMessageSelector(this);
  }

  async handleCloneCommand(): Promise<void> {
    return do_handleCloneCommand(this);
  }

  showTreeSelector(initialSelectedId?: string): void {
    do_showTreeSelector(this, initialSelectedId);
  }

  showSessionSelector(): void {
    do_showSessionSelector(this);
  }

  async handleResumeSession(
    sessionPath: string,
    options?: Parameters<ExtensionCommandContext["switchSession"]>[1],
  ): Promise<{ cancelled: boolean }> {
    return do_handleResumeSession(this, sessionPath, options);
  }

  getLoginProviderOptions(authType?: "oauth" | "api_key"): AuthSelectorProvider[] {
    return do_getLoginProviderOptions(this, authType);
  }

  getLogoutProviderOptions(): AuthSelectorProvider[] {
    return do_getLogoutProviderOptions(this);
  }

  showLoginAuthTypeSelector(): void {
    do_showLoginAuthTypeSelector(this);
  }

  showLoginProviderSelector(authType: "oauth" | "api_key"): void {
    do_showLoginProviderSelector(this, authType);
  }

  async showOAuthSelector(mode: "login" | "logout"): Promise<void> {
    return do_showOAuthSelector(this, mode);
  }

  async completeProviderAuthentication(
    providerId: string,
    providerName: string,
    authType: "oauth" | "api_key",
    previousModel: Model<any> | undefined,
  ): Promise<void> {
    return do_completeProviderAuthentication(this, providerId, providerName, authType, previousModel);
  }

  showBedrockSetupDialog(providerId: string, providerName: string): void {
    do_showBedrockSetupDialog(this, providerId, providerName);
  }

  async showApiKeyLoginDialog(providerId: string, providerName: string): Promise<void> {
    return do_showApiKeyLoginDialog(this, providerId, providerName);
  }

  showOAuthLoginSelect(dialog: LoginDialogComponent, prompt: OAuthSelectPrompt): Promise<string | undefined> {
    return do_showOAuthLoginSelect(this, dialog, prompt);
  }

  async showLoginDialog(providerId: string, providerName: string): Promise<void> {
    return do_showLoginDialog(this, providerId, providerName);
  }

  async handlePlanCommand(text: string): Promise<void> {
    return do_handlePlanCommand(this, text);
  }

  async handleReloadCommand(): Promise<void> {
    return do_handleReloadCommand(this);
  }

  async handleExportCommand(text: string): Promise<void> {
    return do_handleExportCommand(this, text);
  }

  getPathCommandArgument(text: string, command: "/export" | "/import"): string | undefined {
    return do_getPathCommandArgument(this, text, command);
  }

  async handleImportCommand(text: string): Promise<void> {
    return do_handleImportCommand(this, text);
  }

  async handleShareCommand(): Promise<void> {
    return do_handleShareCommand(this);
  }

  async handleCopyCommand(): Promise<void> {
    return do_handleCopyCommand(this);
  }

  handleNameCommand(text: string): void {
    do_handleNameCommand(this, text);
  }

  handleSessionCommand(): void {
    do_handleSessionCommand(this);
  }

  handleStateCommand(): void {
    do_handleStateCommand(this);
  }

  handleMemoryCommand(text: string): void {
    do_handleMemoryCommand(this, text);
  }

  handleRulesCommand(text: string): void {
    do_handleRulesCommand(this, text);
  }

  async handleIndexCommand(text?: string): Promise<void> {
    return do_handleIndexCommand(this, text);
  }

  async buildIndexStatusText(resolvedPath: string, args: string): Promise<string> {
    return do_buildIndexStatusText(this, resolvedPath, args);
  }

  handleChangelogCommand(): void {
    do_handleChangelogCommand(this);
  }

  getAppKeyDisplay(action: AppKeybinding): string {
    return do_getAppKeyDisplay(this, action);
  }

  getEditorKeyDisplay(action: Keybinding): string {
    return do_getEditorKeyDisplay(this, action);
  }

  handleHotkeysCommand(): void {
    do_handleHotkeysCommand(this);
  }

  async handleClearCommand(): Promise<void> {
    return do_handleClearCommand(this);
  }

  handleDebugCommand(): void {
    do_handleDebugCommand(this);
  }

  handleArminSaysHi(): void {
    do_handleArminSaysHi(this);
  }

  handleDementedDelves(): void {
    do_handleDementedDelves(this);
  }

  handleDaxnuts(): void {
    do_handleDaxnuts(this);
  }

  checkDaxnutsEasterEgg(model: { provider: string; id: string }): void {
    do_checkDaxnutsEasterEgg(this, model);
  }

  async handleBashCommand(command: string, excludeFromContext = false): Promise<void> {
    return do_handleBashCommand(this, command, excludeFromContext);
  }

  formatCompactionDryRun(result: CompactionDryRunResult): string {
    return do_formatCompactionDryRun(this, result);
  }

  async handleCompactCommand(
    customInstructions?: string,
    options?: { dryRun?: boolean; audit?: boolean },
  ): Promise<void> {
    return do_handleCompactCommand(this, customInstructions, options);
  }

  stop(): void {
    do_stop(this);
  }
}
