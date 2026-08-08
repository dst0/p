import type { CompletionMode, CompletionProtocolLimits } from "@dst0/p-agent-core";
import { getAgentDir } from "../../config.ts";
import { deepMergeSettings } from "./helpers.ts";
import {
  do_create,
  do_fromStorage,
  do_getGlobalSettings,
  do_getProjectSettings,
  do_inMemory,
  do_isProjectTrusted,
  do_loadFromStorage,
  do_migrateSettings,
  do_setProjectTrusted,
  do_tryLoadFromStorage,
} from "./settingsmanager-methods/factory.ts";
import {
  do_getBlockImages,
  do_getClearOnShrink,
  do_getEnabledModels,
  do_getEnableSkillCommands,
  do_getImageAutoResize,
  do_getImageWidthCells,
  do_getShowHarnessMessages,
  do_getShowImages,
  do_getShowIndexingInfo,
  do_getShowTerminalProgress,
  do_getShowTokenProgress,
  do_getShowTokenStats,
  do_getShowVersion,
  do_getThinkingBudgets,
  do_setBlockImages,
  do_setClearOnShrink,
  do_setEnabledModels,
  do_setEnableSkillCommands,
  do_setImageAutoResize,
  do_setImageWidthCells,
  do_setShowHarnessMessages,
  do_setShowImages,
  do_setShowIndexingInfo,
  do_setShowTerminalProgress,
  do_setShowTokenProgress,
  do_setShowTokenStats,
  do_setShowVersion,
} from "./settingsmanager-methods/feature-flags.ts";
import {
  do_getAutocompleteMaxVisible,
  do_getCodeBlockIndent,
  do_getDoubleEscapeAction,
  do_getEditorPaddingX,
  do_getPlanPanelCompactWidth,
  do_getPlanPanelHeight,
  do_getPlanPanelMode,
  do_getShowHardwareCursor,
  do_getTreeFilterMode,
  do_getWarnings,
  do_setAutocompleteMaxVisible,
  do_setDoubleEscapeAction,
  do_setEditorPaddingX,
  do_setPlanPanelCompactWidth,
  do_setPlanPanelHeight,
  do_setPlanPanelMode,
  do_setShowHardwareCursor,
  do_setTreeFilterMode,
  do_setWarnings,
} from "./settingsmanager-methods/input-settings.ts";
import {
  do_drainErrors,
  do_flush,
  do_getCompletionLimits,
  do_getCompletionMode,
  do_getDefaultModel,
  do_getDefaultProvider,
  do_getDefaultThinkingLevel,
  do_getFastResponderSettings,
  do_getFollowUpMode,
  do_getLastChangelogVersion,
  do_getServiceModelSelection,
  do_getSessionDir,
  do_getSteeringMode,
  do_getTheme,
  do_setDefaultModel,
  do_setDefaultModelAndProvider,
  do_setDefaultProvider,
  do_setDefaultThinkingLevel,
  do_setFollowUpMode,
  do_setLastChangelogVersion,
  do_setSteeringMode,
  do_setTheme,
} from "./settingsmanager-methods/persistence.ts";
import {
  do_applyOverrides,
  do_assertProjectTrustedForWrite,
  do_clearModifiedScope,
  do_cloneModifiedNestedFields,
  do_enqueueWrite,
  do_markModified,
  do_markProjectModified,
  do_persistScopedSettings,
  do_recordError,
  do_reload,
  do_save,
  do_saveProjectSettings,
  do_updateProjectSettings,
} from "./settingsmanager-methods/reload-overrides.ts";
import {
  do_getBranchSummarySettings,
  do_getBranchSummarySkipPrompt,
  do_getCompactionEnabled,
  do_getCompactionKeepRecentMaxTokens,
  do_getCompactionKeepRecentMinTokens,
  do_getCompactionKeepRecentTokens,
  do_getCompactionRenderedStateMaxTokens,
  do_getCompactionReserveTokens,
  do_getCompactionSettings,
  do_getCompactionSummaryMaxTokens,
  do_getCompactionTargetContextTokens,
  do_getCompactionTriggerRatio,
  do_getCompactionTriggerReserveTokens,
  do_getHideThinkingBlock,
  do_getHttpIdleTimeoutMs,
  do_getProviderRetrySettings,
  do_getRetryEnabled,
  do_getRetrySettings,
  do_getTransport,
  do_getWebSocketConnectTimeoutMs,
  do_isToolResultContextExtractionEnabled,
  do_setCompactionEnabled,
  do_setHttpIdleTimeoutMs,
  do_setRetryEnabled,
  do_setToolResultContextExtractionEnabled,
  do_setTransport,
} from "./settingsmanager-methods/transport-settings.ts";
import {
  do_getCollapseChangelog,
  do_getDefaultProjectTrust,
  do_getEnableAnalytics,
  do_getEnableInstallTelemetry,
  do_getExtensionPaths,
  do_getNpmCommand,
  do_getPackages,
  do_getPromptTemplatePaths,
  do_getQuietStartup,
  do_getShellCommandPrefix,
  do_getShellPath,
  do_getSkillPaths,
  do_getStartupNotices,
  do_getThemePaths,
  do_getTrackingId,
  do_setCollapseChangelog,
  do_setDefaultProjectTrust,
  do_setEnableAnalytics,
  do_setEnableInstallTelemetry,
  do_setExtensionPaths,
  do_setHideThinkingBlock,
  do_setNpmCommand,
  do_setPackages,
  do_setProjectExtensionPaths,
  do_setProjectPackages,
  do_setProjectPromptTemplatePaths,
  do_setProjectSkillPaths,
  do_setProjectThemePaths,
  do_setPromptTemplatePaths,
  do_setQuietStartup,
  do_setShellCommandPrefix,
  do_setShellPath,
  do_setSkillPaths,
  do_setStartupNotices,
  do_setThemePaths,
} from "./settingsmanager-methods/ui-settings.ts";
import type {
  DefaultProjectTrust,
  PackageSource,
  Settings,
  SettingsError,
  SettingsManagerCreateOptions,
  SettingsScope,
  SettingsStorage,
  ThinkingBudgetsSettings,
  TransportSetting,
  WarningSettings,
} from "./types.ts";

export class SettingsManager {
  public storage: SettingsStorage;

  public globalSettings: Settings;

  public projectSettings: Settings;

  public settings: Settings;

  public projectTrusted: boolean;

  public modifiedFields = new Set<keyof Settings>();

  public modifiedNestedFields = new Map<keyof Settings, Set<string>>();

  public modifiedProjectFields = new Set<keyof Settings>();

  public modifiedProjectNestedFields = new Map<keyof Settings, Set<string>>();

  public globalSettingsLoadError: Error | null = null;

  public projectSettingsLoadError: Error | null = null;

  public writeQueue: Promise<void> = Promise.resolve();

  public errors: SettingsError[];

  public constructor(
    storage: SettingsStorage,
    initialGlobal: Settings,
    initialProject: Settings,
    globalLoadError: Error | null = null,
    projectLoadError: Error | null = null,
    initialErrors: SettingsError[] = [],
    projectTrusted = true,
  ) {
    this.storage = storage;
    this.globalSettings = initialGlobal;
    this.projectSettings = initialProject;
    this.projectTrusted = projectTrusted;
    this.globalSettingsLoadError = globalLoadError;
    this.projectSettingsLoadError = projectLoadError;
    this.errors = [...initialErrors];
    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
  }

  static create(
    cwd: string,
    agentDir: string = getAgentDir(),
    options: SettingsManagerCreateOptions = {},
  ): SettingsManager {
    return do_create(cwd, agentDir, options);
  }

  static fromStorage(storage: SettingsStorage, options: SettingsManagerCreateOptions = {}): SettingsManager {
    return do_fromStorage(storage, options);
  }

  static inMemory(settings: Partial<Settings> = {}): SettingsManager {
    return do_inMemory(settings);
  }

  static loadFromStorage(storage: SettingsStorage, scope: SettingsScope, projectTrusted = true): Settings {
    return do_loadFromStorage(storage, scope, projectTrusted);
  }

  static tryLoadFromStorage(
    storage: SettingsStorage,
    scope: SettingsScope,
    projectTrusted = true,
  ): { settings: Settings; error: Error | null } {
    return do_tryLoadFromStorage(storage, scope, projectTrusted);
  }

  static migrateSettings(settings: Record<string, unknown>): Settings {
    return do_migrateSettings(settings);
  }

  getGlobalSettings(): Settings {
    return do_getGlobalSettings(this);
  }

  getProjectSettings(): Settings {
    return do_getProjectSettings(this);
  }

  isProjectTrusted(): boolean {
    return do_isProjectTrusted(this);
  }

  setProjectTrusted(trusted: boolean): void {
    do_setProjectTrusted(this, trusted);
  }

  async reload(): Promise<void> {
    return do_reload(this);
  }

  applyOverrides(overrides: Partial<Settings>): void {
    do_applyOverrides(this, overrides);
  }

  markModified(field: keyof Settings, nestedKey?: string): void {
    do_markModified(this, field, nestedKey);
  }

  markProjectModified(field: keyof Settings, nestedKey?: string): void {
    do_markProjectModified(this, field, nestedKey);
  }

  assertProjectTrustedForWrite(): void {
    do_assertProjectTrustedForWrite(this);
  }

  recordError(scope: SettingsScope, error: unknown): void {
    do_recordError(this, scope, error);
  }

  clearModifiedScope(scope: SettingsScope): void {
    do_clearModifiedScope(this, scope);
  }

  enqueueWrite(scope: SettingsScope, task: () => void): void {
    do_enqueueWrite(this, scope, task);
  }

  cloneModifiedNestedFields(source: Map<keyof Settings, Set<string>>): Map<keyof Settings, Set<string>> {
    return do_cloneModifiedNestedFields(this, source);
  }

  persistScopedSettings(
    scope: SettingsScope,
    snapshotSettings: Settings,
    modifiedFields: Set<keyof Settings>,
    modifiedNestedFields: Map<keyof Settings, Set<string>>,
  ): void {
    do_persistScopedSettings(this, scope, snapshotSettings, modifiedFields, modifiedNestedFields);
  }

  save(): void {
    do_save(this);
  }

  saveProjectSettings(settings: Settings): void {
    do_saveProjectSettings(this, settings);
  }

  updateProjectSettings(field: keyof Settings, update: (settings: Settings) => void): void {
    do_updateProjectSettings(this, field, update);
  }

  async flush(): Promise<void> {
    return do_flush(this);
  }

  drainErrors(): SettingsError[] {
    return do_drainErrors(this);
  }

  getLastChangelogVersion(): string | undefined {
    return do_getLastChangelogVersion(this);
  }

  setLastChangelogVersion(version: string): void {
    do_setLastChangelogVersion(this, version);
  }

  getSessionDir(): string | undefined {
    return do_getSessionDir(this);
  }

  getDefaultProvider(): string | undefined {
    return do_getDefaultProvider(this);
  }

  getDefaultModel(): string | undefined {
    return do_getDefaultModel(this);
  }

  getServiceModelSelection(): {
    provider?: string;
    modelId?: string;
    thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  } {
    return do_getServiceModelSelection(this);
  }

  getFastResponderSettings(): {
    enabled: boolean;
    provider?: string;
    modelId?: string;
    thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
    minContextTokens: number;
    timeoutMs: number;
    maxTokens: number;
  } {
    return do_getFastResponderSettings(this);
  }

  setDefaultProvider(provider: string): void {
    do_setDefaultProvider(this, provider);
  }

  setDefaultModel(modelId: string): void {
    do_setDefaultModel(this, modelId);
  }

  setDefaultModelAndProvider(provider: string, modelId: string): void {
    do_setDefaultModelAndProvider(this, provider, modelId);
  }

  getSteeringMode(): "all" | "one-at-a-time" {
    return do_getSteeringMode(this);
  }

  setSteeringMode(mode: "all" | "one-at-a-time"): void {
    do_setSteeringMode(this, mode);
  }

  getFollowUpMode(): "all" | "one-at-a-time" {
    return do_getFollowUpMode(this);
  }

  setFollowUpMode(mode: "all" | "one-at-a-time"): void {
    do_setFollowUpMode(this, mode);
  }

  getCompletionMode(): CompletionMode {
    return do_getCompletionMode(this);
  }

  getCompletionLimits(): CompletionProtocolLimits | undefined {
    return do_getCompletionLimits(this);
  }

  getTheme(): string | undefined {
    return do_getTheme(this);
  }

  setTheme(theme: string): void {
    do_setTheme(this, theme);
  }

  getDefaultThinkingLevel(): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined {
    return do_getDefaultThinkingLevel(this);
  }

  setDefaultThinkingLevel(level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"): void {
    do_setDefaultThinkingLevel(this, level);
  }

  getTransport(): TransportSetting {
    return do_getTransport(this);
  }

  setTransport(transport: TransportSetting): void {
    do_setTransport(this, transport);
  }

  getCompactionEnabled(): boolean {
    return do_getCompactionEnabled(this);
  }

  isToolResultContextExtractionEnabled(): boolean {
    return do_isToolResultContextExtractionEnabled(this);
  }

  setToolResultContextExtractionEnabled(enabled: boolean): void {
    do_setToolResultContextExtractionEnabled(this, enabled);
  }

  setCompactionEnabled(enabled: boolean): void {
    do_setCompactionEnabled(this, enabled);
  }

  getCompactionReserveTokens(): number {
    return do_getCompactionReserveTokens(this);
  }

  getCompactionKeepRecentTokens(): number {
    return do_getCompactionKeepRecentTokens(this);
  }

  getCompactionTargetContextTokens(): number {
    return do_getCompactionTargetContextTokens(this);
  }

  getCompactionTriggerReserveTokens(): number {
    return do_getCompactionTriggerReserveTokens(this);
  }

  getCompactionTriggerRatio(): number | undefined {
    return do_getCompactionTriggerRatio(this);
  }

  getCompactionKeepRecentMinTokens(): number {
    return do_getCompactionKeepRecentMinTokens(this);
  }

  getCompactionKeepRecentMaxTokens(): number {
    return do_getCompactionKeepRecentMaxTokens(this);
  }

  getCompactionSummaryMaxTokens(): number {
    return do_getCompactionSummaryMaxTokens(this);
  }

  getCompactionRenderedStateMaxTokens(): number {
    return do_getCompactionRenderedStateMaxTokens(this);
  }

  getCompactionSettings(): {
    enabled: boolean;
    triggerReserveTokens: number;
    triggerRatio?: number;
    keepRecentMinTokens: number;
    keepRecentMaxTokens: number;
    summaryMaxTokens: number;
    renderedStateMaxTokens: number;
    targetContextTokens: number;
  } {
    return do_getCompactionSettings(this);
  }

  getBranchSummarySettings(): { reserveTokens: number; skipPrompt: boolean } {
    return do_getBranchSummarySettings(this);
  }

  getBranchSummarySkipPrompt(): boolean {
    return do_getBranchSummarySkipPrompt(this);
  }

  getRetryEnabled(): boolean {
    return do_getRetryEnabled(this);
  }

  setRetryEnabled(enabled: boolean): void {
    do_setRetryEnabled(this, enabled);
  }

  getRetrySettings(): { enabled: boolean; maxRetries: number; baseDelayMs: number } {
    return do_getRetrySettings(this);
  }

  getHttpIdleTimeoutMs(): number {
    return do_getHttpIdleTimeoutMs(this);
  }

  setHttpIdleTimeoutMs(timeoutMs: number): void {
    do_setHttpIdleTimeoutMs(this, timeoutMs);
  }

  getProviderRetrySettings(): { timeoutMs?: number; maxRetries?: number; maxRetryDelayMs: number } {
    return do_getProviderRetrySettings(this);
  }

  getWebSocketConnectTimeoutMs(): number | undefined {
    return do_getWebSocketConnectTimeoutMs(this);
  }

  getHideThinkingBlock(): boolean {
    return do_getHideThinkingBlock(this);
  }

  setHideThinkingBlock(hide: boolean): void {
    do_setHideThinkingBlock(this, hide);
  }

  getShellPath(): string | undefined {
    return do_getShellPath(this);
  }

  setShellPath(path: string | undefined): void {
    do_setShellPath(this, path);
  }

  getQuietStartup(): boolean {
    return do_getQuietStartup(this);
  }

  setQuietStartup(quiet: boolean): void {
    do_setQuietStartup(this, quiet);
  }

  getDefaultProjectTrust(): DefaultProjectTrust {
    return do_getDefaultProjectTrust(this);
  }

  setDefaultProjectTrust(defaultProjectTrust: DefaultProjectTrust): void {
    do_setDefaultProjectTrust(this, defaultProjectTrust);
  }

  getShellCommandPrefix(): string | undefined {
    return do_getShellCommandPrefix(this);
  }

  setShellCommandPrefix(prefix: string | undefined): void {
    do_setShellCommandPrefix(this, prefix);
  }

  getNpmCommand(): string[] | undefined {
    return do_getNpmCommand(this);
  }

  setNpmCommand(command: string[] | undefined): void {
    do_setNpmCommand(this, command);
  }

  getCollapseChangelog(): boolean {
    return do_getCollapseChangelog(this);
  }

  setCollapseChangelog(collapse: boolean): void {
    do_setCollapseChangelog(this, collapse);
  }

  getStartupNotices(): boolean {
    return do_getStartupNotices(this);
  }

  setStartupNotices(enabled: boolean): void {
    do_setStartupNotices(this, enabled);
  }

  getEnableInstallTelemetry(): boolean {
    return do_getEnableInstallTelemetry(this);
  }

  setEnableInstallTelemetry(enabled: boolean): void {
    do_setEnableInstallTelemetry(this, enabled);
  }

  getEnableAnalytics(): boolean {
    return do_getEnableAnalytics(this);
  }

  getTrackingId(): string | undefined {
    return do_getTrackingId(this);
  }

  setEnableAnalytics(enabled: boolean): void {
    do_setEnableAnalytics(this, enabled);
  }

  getPackages(): PackageSource[] {
    return do_getPackages(this);
  }

  setPackages(packages: PackageSource[]): void {
    do_setPackages(this, packages);
  }

  setProjectPackages(packages: PackageSource[]): void {
    do_setProjectPackages(this, packages);
  }

  getExtensionPaths(): string[] {
    return do_getExtensionPaths(this);
  }

  setExtensionPaths(paths: string[]): void {
    do_setExtensionPaths(this, paths);
  }

  setProjectExtensionPaths(paths: string[]): void {
    do_setProjectExtensionPaths(this, paths);
  }

  getSkillPaths(): string[] {
    return do_getSkillPaths(this);
  }

  setSkillPaths(paths: string[]): void {
    do_setSkillPaths(this, paths);
  }

  setProjectSkillPaths(paths: string[]): void {
    do_setProjectSkillPaths(this, paths);
  }

  getPromptTemplatePaths(): string[] {
    return do_getPromptTemplatePaths(this);
  }

  setPromptTemplatePaths(paths: string[]): void {
    do_setPromptTemplatePaths(this, paths);
  }

  setProjectPromptTemplatePaths(paths: string[]): void {
    do_setProjectPromptTemplatePaths(this, paths);
  }

  getThemePaths(): string[] {
    return do_getThemePaths(this);
  }

  setThemePaths(paths: string[]): void {
    do_setThemePaths(this, paths);
  }

  setProjectThemePaths(paths: string[]): void {
    do_setProjectThemePaths(this, paths);
  }

  getEnableSkillCommands(): boolean {
    return do_getEnableSkillCommands(this);
  }

  setEnableSkillCommands(enabled: boolean): void {
    do_setEnableSkillCommands(this, enabled);
  }

  getThinkingBudgets(): ThinkingBudgetsSettings | undefined {
    return do_getThinkingBudgets(this);
  }

  getShowImages(): boolean {
    return do_getShowImages(this);
  }

  setShowImages(show: boolean): void {
    do_setShowImages(this, show);
  }

  getImageWidthCells(): number {
    return do_getImageWidthCells(this);
  }

  setImageWidthCells(width: number): void {
    do_setImageWidthCells(this, width);
  }

  getClearOnShrink(): boolean {
    return do_getClearOnShrink(this);
  }

  setClearOnShrink(enabled: boolean): void {
    do_setClearOnShrink(this, enabled);
  }

  getShowTerminalProgress(): boolean {
    return do_getShowTerminalProgress(this);
  }

  setShowTerminalProgress(enabled: boolean): void {
    do_setShowTerminalProgress(this, enabled);
  }

  getShowTokenProgress(): boolean {
    return do_getShowTokenProgress(this);
  }

  setShowTokenProgress(enabled: boolean): void {
    do_setShowTokenProgress(this, enabled);
  }

  getShowTokenStats(): boolean {
    return do_getShowTokenStats(this);
  }

  setShowTokenStats(enabled: boolean): void {
    do_setShowTokenStats(this, enabled);
  }

  getShowIndexingInfo(): boolean {
    return do_getShowIndexingInfo(this);
  }

  setShowIndexingInfo(enabled: boolean): void {
    do_setShowIndexingInfo(this, enabled);
  }

  getShowVersion(): boolean {
    return do_getShowVersion(this);
  }

  setShowVersion(enabled: boolean): void {
    do_setShowVersion(this, enabled);
  }

  getShowHarnessMessages(): boolean {
    return do_getShowHarnessMessages(this);
  }

  setShowHarnessMessages(enabled: boolean): void {
    do_setShowHarnessMessages(this, enabled);
  }

  getImageAutoResize(): boolean {
    return do_getImageAutoResize(this);
  }

  setImageAutoResize(enabled: boolean): void {
    do_setImageAutoResize(this, enabled);
  }

  getBlockImages(): boolean {
    return do_getBlockImages(this);
  }

  setBlockImages(blocked: boolean): void {
    do_setBlockImages(this, blocked);
  }

  getEnabledModels(): string[] | undefined {
    return do_getEnabledModels(this);
  }

  setEnabledModels(patterns: string[] | undefined): void {
    do_setEnabledModels(this, patterns);
  }

  getDoubleEscapeAction(): "fork" | "tree" | "none" {
    return do_getDoubleEscapeAction(this);
  }

  setDoubleEscapeAction(action: "fork" | "tree" | "none"): void {
    do_setDoubleEscapeAction(this, action);
  }

  getTreeFilterMode(): "default" | "no-tools" | "user-only" | "labeled-only" | "all" {
    return do_getTreeFilterMode(this);
  }

  setTreeFilterMode(mode: "default" | "no-tools" | "user-only" | "labeled-only" | "all"): void {
    do_setTreeFilterMode(this, mode);
  }

  getShowHardwareCursor(): boolean {
    return do_getShowHardwareCursor(this);
  }

  setShowHardwareCursor(enabled: boolean): void {
    do_setShowHardwareCursor(this, enabled);
  }

  getEditorPaddingX(): number {
    return do_getEditorPaddingX(this);
  }

  setEditorPaddingX(padding: number): void {
    do_setEditorPaddingX(this, padding);
  }

  getAutocompleteMaxVisible(): number {
    return do_getAutocompleteMaxVisible(this);
  }

  setAutocompleteMaxVisible(maxVisible: number): void {
    do_setAutocompleteMaxVisible(this, maxVisible);
  }

  getCodeBlockIndent(): string {
    return do_getCodeBlockIndent(this);
  }

  getWarnings(): WarningSettings {
    return do_getWarnings(this);
  }

  setWarnings(warnings: WarningSettings): void {
    do_setWarnings(this, warnings);
  }

  getPlanPanelMode(): "hidden" | "compact" | "expanded" {
    return do_getPlanPanelMode(this);
  }

  setPlanPanelMode(mode: "hidden" | "compact" | "expanded"): void {
    do_setPlanPanelMode(this, mode);
  }

  getPlanPanelCompactWidth(): number {
    return do_getPlanPanelCompactWidth(this);
  }

  setPlanPanelCompactWidth(width: number): void {
    do_setPlanPanelCompactWidth(this, width);
  }

  getPlanPanelHeight(): number | undefined {
    return do_getPlanPanelHeight(this);
  }

  setPlanPanelHeight(height: number | undefined): void {
    do_setPlanPanelHeight(this, height);
  }
}
