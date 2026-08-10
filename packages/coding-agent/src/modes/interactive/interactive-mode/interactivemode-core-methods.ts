import type { AgentMessage } from "@dst0/p-agent-core";
import type { Message } from "@dst0/p-ai";
import type {
  AutocompleteProvider,
  Component,
  Container,
  Loader,
  LoaderIndicatorOptions,
  MarkdownTheme,
  OverlayHandle,
  OverlayOptions,
  TUI,
} from "@dst0/p-tui";
import type { AgentSessionEvent } from "../../../core/agent-session.ts";
import type {
  EditorFactory,
  ExtensionRunner,
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
  ProjectTrustContext,
} from "../../../core/extensions/index.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import type { KeybindingsManager } from "../../../core/keybindings.ts";
import type { ResourceDiagnostic } from "../../../core/resource-loader.ts";
import type { MissingSessionCwdError } from "../../../core/session-cwd.ts";
import type { SessionContext } from "../../../core/session-manager.ts";
import type { SourceInfo } from "../../../core/source-info.ts";
import type { SgrMouseEvent } from "../components/plan-panel.ts";
import type { Theme } from "../theme/theme.ts";
import type { PlanPanelBounds } from "./types.ts";

export interface InteractiveModeCoreMethods {
  updateTerminalBackground(): void;
  detectThemeIfUnset(): Promise<void>;
  getAutocompleteSourceTag(sourceInfo?: SourceInfo): string | undefined;
  prefixAutocompleteDescription(description: string | undefined, sourceInfo?: SourceInfo): string | undefined;
  getBuiltInCommandConflictDiagnostics(extensionRunner: ExtensionRunner): ResourceDiagnostic[];
  createBaseAutocompleteProvider(): AutocompleteProvider;
  setupAutocompleteProvider(): void;
  showStartupNoticesIfNeeded(): void;
  init(): Promise<void>;
  updateTerminalTitle(): void;
  run(): Promise<void>;
  checkForPackageUpdates(): Promise<string[]>;
  checkTmuxKeyboardSetup(): Promise<string | undefined>;
  getChangelogForDisplay(): string | undefined;
  reportInstallTelemetry(version: string): void;
  getMarkdownThemeWithSettings(): MarkdownTheme;
  formatDisplayPath(p: string): string;
  formatExtensionDisplayPath(path: string): string;
  formatContextPath(p: string): string;
  getStartupExpansionState(): boolean;
  getShortPath(fullPath: string, sourceInfo?: SourceInfo): string;
  getCompactPathLabel(resourcePath: string, sourceInfo?: SourceInfo): string;
  getCompactPackageSourceLabel(sourceInfo?: SourceInfo): string;
  getCompactExtensionLabel(resourcePath: string, sourceInfo?: SourceInfo): string;
  getCompactDisplayPathSegments(resourcePath: string): string[];
  getCompactNonPackageExtensionLabel(
    resourcePath: string,
    index: number,
    allPaths: Array<{
      path: string;
      segments: string[];
    }>,
  ): string;
  getCompactExtensionLabels(
    extensions: Array<{
      path: string;
      sourceInfo?: SourceInfo;
    }>,
  ): string[];
  getDisplaySourceInfo(sourceInfo?: SourceInfo): {
    label: string;
    scopeLabel?: string;
    color: "accent" | "muted";
  };
  getScopeGroup(sourceInfo?: SourceInfo): "user" | "project" | "path";
  isPackageSource(sourceInfo?: SourceInfo): boolean;
  buildScopeGroups(
    items: Array<{
      path: string;
      sourceInfo?: SourceInfo;
    }>,
  ): Array<{
    scope: "user" | "project" | "path";
    paths: Array<{
      path: string;
      sourceInfo?: SourceInfo;
    }>;
    packages: Map<
      string,
      Array<{
        path: string;
        sourceInfo?: SourceInfo;
      }>
    >;
  }>;
  formatScopeGroups(
    groups: Array<{
      scope: "user" | "project" | "path";
      paths: Array<{
        path: string;
        sourceInfo?: SourceInfo;
      }>;
      packages: Map<
        string,
        Array<{
          path: string;
          sourceInfo?: SourceInfo;
        }>
      >;
    }>,
    options: {
      formatPath: (item: { path: string; sourceInfo?: SourceInfo }) => string;
      formatPackagePath: (
        item: {
          path: string;
          sourceInfo?: SourceInfo;
        },
        source: string,
      ) => string;
    },
  ): string;
  findSourceInfoForPath(p: string, sourceInfos: Map<string, SourceInfo>): SourceInfo | undefined;
  formatPathWithSource(p: string, sourceInfo?: SourceInfo): string;
  formatDiagnostics(diagnostics: readonly ResourceDiagnostic[], sourceInfos: Map<string, SourceInfo>): string;
  showLoadedResources(options?: {
    extensions?: Array<{
      path: string;
      sourceInfo?: SourceInfo;
    }>;
    force?: boolean;
    showDiagnosticsWhenQuiet?: boolean;
  }): void;
  bindCurrentSessionExtensions(): Promise<void>;
  applyRuntimeSettings(): void;
  rebindCurrentSession(): Promise<void>;
  handleFatalRuntimeError(prefix: string, error: unknown): Promise<never>;
  renderCurrentSessionState(): void;
  getRegisteredToolDefinition(
    toolName: string,
  ): import("../../../core/extensions/types.ts").ToolDefinition<import("@dst0/p-ai").TSchema, unknown, any> | undefined;
  setupExtensionShortcuts(extensionRunner: ExtensionRunner): void;
  setExtensionStatus(key: string, text: string | undefined): void;
  getWorkingLoaderMessage(): string;
  createWorkingLoader(): Loader;
  stopWorkingLoader(): void;
  setWorkingVisible(visible: boolean): void;
  setWorkingIndicator(options?: LoaderIndicatorOptions): void;
  setHiddenThinkingLabel(label?: string): void;
  setExtensionWidget(
    key: string,
    content:
      | string[]
      | ((
          tui: TUI,
          thm: Theme,
        ) => Component & {
          dispose?(): void;
        })
      | undefined,
    options?: ExtensionWidgetOptions,
  ): void;
  clearExtensionWidgets(): void;
  resetExtensionUI(): void;
  renderWidgets(): void;
  renderWidgetContainer(
    container: Container,
    widgets: Map<
      string,
      Component & {
        dispose?(): void;
      }
    >,
    spacerWhenEmpty: boolean,
    leadingSpacer: boolean,
  ): void;
  setExtensionFooter(
    factory:
      | ((
          tui: TUI,
          thm: Theme,
          footerData: ReadonlyFooterDataProvider,
        ) => Component & {
          dispose?(): void;
        })
      | undefined,
  ): void;
  setExtensionHeader(
    factory:
      | ((
          tui: TUI,
          thm: Theme,
        ) => Component & {
          dispose?(): void;
        })
      | undefined,
  ): void;
  addExtensionTerminalInputListener(
    handler: (data: string) =>
      | {
          consume?: boolean;
          data?: string;
        }
      | undefined,
  ): () => void;
  clearExtensionTerminalInputListeners(): void;
  createProjectTrustContext(cwd: string): ProjectTrustContext;
  createExtensionUIContext(): ExtensionUIContext;
  showExtensionSelector(title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
  hideExtensionSelector(): void;
  showExtensionConfirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean>;
  promptForMissingSessionCwd(error: MissingSessionCwdError): Promise<string | undefined>;
  promptForCodeIndexingIfNeeded(): Promise<void>;
  showExtensionInput(title: string, placeholder?: string, opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
  hideExtensionInput(): void;
  showExtensionEditor(title: string, prefill?: string): Promise<string | undefined>;
  hideExtensionEditor(): void;
  setCustomEditorComponent(factory: EditorFactory | undefined): void;
  showExtensionNotify(message: string, type?: "info" | "warning" | "error"): void;
  showExtensionCustom<T>(
    factory: (
      tui: TUI,
      theme: Theme,
      keybindings: KeybindingsManager,
      done: (result: T) => void,
    ) =>
      | (Component & {
          dispose?(): void;
        })
      | Promise<
          Component & {
            dispose?(): void;
          }
        >,
    options?: {
      overlay?: boolean;
      overlayOptions?: OverlayOptions | (() => OverlayOptions);
      onHandle?: (handle: OverlayHandle) => void;
    },
  ): Promise<T>;
  showExtensionError(extensionPath: string, error: string, stack?: string): void;
  setupKeyHandlers(): void;
  handleClipboardImagePaste(): Promise<void>;
  setupEditorSubmitHandler(): void;
  subscribeToAgent(): void;
  handleEvent(event: AgentSessionEvent): Promise<void>;
  getUserMessageText(message: Message): string;
  togglePlanPanel(): void;
  hidePlanPanel(): void;
  showPlanPanelOverlay(): void;
  getPlanPanelMaxHeight(): number;
  getPlanPanelCompactWidth(): number;
  getPlanPanelBounds(): PlanPanelBounds;
  handlePlanPanelInput(data: string):
    | {
        consume: boolean;
      }
    | undefined;
  setPlanPanelMouseMode(active: boolean): void;
  scrollPlanPanel(direction: -1 | 1): void;
  resizePlanPanel(widthDelta: number, heightDelta: number): void;
  setPlanPanelSize(width: number | undefined, height: number | undefined): void;
  handlePlanPanelMouse(event: SgrMouseEvent): boolean;
  syncPlanTracker(): void;
  showStatus(message: string): void;
  addMessageToChat(
    message: AgentMessage,
    options?: {
      populateHistory?: boolean;
    },
  ): void;
  renderSessionContext(
    sessionContext: SessionContext,
    options?: {
      updateFooter?: boolean;
      populateHistory?: boolean;
    },
  ): void;
  renderInitialMessages(): void;
}
