import type { Message } from "@dst0/p-ai";
import type {
  Component,
  Container,
  Loader,
  LoaderIndicatorOptions,
  OverlayHandle,
  OverlayOptions,
  TUI,
} from "@dst0/p-tui";
import type { AgentSessionEvent } from "../../../../../core/agent-session.ts";
import type {
  EditorFactory,
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
  ProjectTrustContext,
} from "../../../../../core/extensions/index.ts";
import type { ReadonlyFooterDataProvider } from "../../../../../core/footer-data-provider.ts";
import type { KeybindingsManager } from "../../../../../core/keybindings.ts";
import type { MissingSessionCwdError } from "../../../../../core/session-cwd.ts";
import type { Theme } from "../../../theme/theme.ts";
import type { PlanPanelBounds } from "../../types.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_setExtensionStatus(self: InteractiveMode, key: string, text: string | undefined): void {
  do_setExtensionStatus(self, key, text);
}

export function do_getWorkingLoaderMessage(self: InteractiveMode): string {
  return do_getWorkingLoaderMessage(self);
}

export function do_createWorkingLoader(self: InteractiveMode): Loader {
  return do_createWorkingLoader(self);
}

export function do_stopWorkingLoader(self: InteractiveMode): void {
  do_stopWorkingLoader(self);
}

export function do_setWorkingVisible(self: InteractiveMode, visible: boolean): void {
  do_setWorkingVisible(self, visible);
}

export function do_setWorkingIndicator(self: InteractiveMode, options?: LoaderIndicatorOptions): void {
  do_setWorkingIndicator(self, options);
}

export function do_setHiddenThinkingLabel(self: InteractiveMode, label?: string): void {
  do_setHiddenThinkingLabel(self, label);
}

export function do_setExtensionWidget(
  self: InteractiveMode,
  key: string,
  content: string[] | ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined,
  options?: ExtensionWidgetOptions,
): void {
  do_setExtensionWidget(self, key, content, options);
}

export function do_clearExtensionWidgets(self: InteractiveMode): void {
  do_clearExtensionWidgets(self);
}

export function do_resetExtensionUI(self: InteractiveMode): void {
  do_resetExtensionUI(self);
}

export function do_renderWidgets(self: InteractiveMode): void {
  do_renderWidgets(self);
}

export function do_renderWidgetContainer(
  self: InteractiveMode,
  container: Container,
  widgets: Map<string, Component & { dispose?(): void }>,
  spacerWhenEmpty: boolean,
  leadingSpacer: boolean,
): void {
  do_renderWidgetContainer(self, container, widgets, spacerWhenEmpty, leadingSpacer);
}

export function do_setExtensionFooter(
  self: InteractiveMode,
  factory:
    | ((tui: TUI, thm: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose?(): void })
    | undefined,
): void {
  do_setExtensionFooter(self, factory);
}

export function do_setExtensionHeader(
  self: InteractiveMode,
  factory: ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined,
): void {
  do_setExtensionHeader(self, factory);
}

export function do_addExtensionTerminalInputListener(
  self: InteractiveMode,
  handler: (data: string) => { consume?: boolean; data?: string } | undefined,
): () => void {
  return do_addExtensionTerminalInputListener(self, handler);
}

export function do_clearExtensionTerminalInputListeners(self: InteractiveMode): void {
  do_clearExtensionTerminalInputListeners(self);
}

export function do_createProjectTrustContext(self: InteractiveMode, cwd: string): ProjectTrustContext {
  return do_createProjectTrustContext(self, cwd);
}

export function do_createExtensionUIContext(self: InteractiveMode): ExtensionUIContext {
  return do_createExtensionUIContext(self);
}

export function do_showExtensionSelector(
  self: InteractiveMode,
  title: string,
  options: string[],
  opts?: ExtensionUIDialogOptions,
): Promise<string | undefined> {
  return do_showExtensionSelector(self, title, options, opts);
}

export function do_hideExtensionSelector(self: InteractiveMode): void {
  do_hideExtensionSelector(self);
}

export async function do_showExtensionConfirm(
  self: InteractiveMode,
  title: string,
  message: string,
  opts?: ExtensionUIDialogOptions,
): Promise<boolean> {
  return do_showExtensionConfirm(self, title, message, opts);
}

export async function do_promptForMissingSessionCwd(
  self: InteractiveMode,
  error: MissingSessionCwdError,
): Promise<string | undefined> {
  return do_promptForMissingSessionCwd(self, error);
}

export async function do_promptForCodeIndexingIfNeeded(self: InteractiveMode): Promise<void> {
  return do_promptForCodeIndexingIfNeeded(self);
}

export function do_showExtensionInput(
  self: InteractiveMode,
  title: string,
  placeholder?: string,
  opts?: ExtensionUIDialogOptions,
): Promise<string | undefined> {
  return do_showExtensionInput(self, title, placeholder, opts);
}

export function do_hideExtensionInput(self: InteractiveMode): void {
  do_hideExtensionInput(self);
}

export function do_showExtensionEditor(
  self: InteractiveMode,
  title: string,
  prefill?: string,
): Promise<string | undefined> {
  return do_showExtensionEditor(self, title, prefill);
}

export function do_hideExtensionEditor(self: InteractiveMode): void {
  do_hideExtensionEditor(self);
}

export function do_setCustomEditorComponent(self: InteractiveMode, factory: EditorFactory | undefined): void {
  do_setCustomEditorComponent(self, factory);
}

export function do_showExtensionNotify(
  self: InteractiveMode,
  message: string,
  type?: "info" | "warning" | "error",
): void {
  do_showExtensionNotify(self, message, type);
}

export async function do_showExtensionCustom<T>(
  self: InteractiveMode,
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
  return do_showExtensionCustom(self, factory, options);
}

export function do_showExtensionError(
  self: InteractiveMode,
  extensionPath: string,
  error: string,
  stack?: string,
): void {
  do_showExtensionError(self, extensionPath, error, stack);
}

export function do_setupKeyHandlers(self: InteractiveMode): void {
  do_setupKeyHandlers(self);
}

export async function do_handleClipboardImagePaste(self: InteractiveMode): Promise<void> {
  return do_handleClipboardImagePaste(self);
}

export function do_setupEditorSubmitHandler(self: InteractiveMode): void {
  do_setupEditorSubmitHandler(self);
}

export function do_subscribeToAgent(self: InteractiveMode): void {
  do_subscribeToAgent(self);
}

export async function do_handleEvent(self: InteractiveMode, event: AgentSessionEvent): Promise<void> {
  return do_handleEvent(self, event);
}

export function do_getUserMessageText(self: InteractiveMode, message: Message): string {
  return do_getUserMessageText(self, message);
}

export function do_togglePlanPanel(self: InteractiveMode): void {
  do_togglePlanPanel(self);
}

export function do_hidePlanPanel(self: InteractiveMode): void {
  do_hidePlanPanel(self);
}

export function do_showPlanPanelOverlay(self: InteractiveMode): void {
  do_showPlanPanelOverlay(self);
}

export function do_getPlanPanelMaxHeight(self: InteractiveMode): number {
  return do_getPlanPanelMaxHeight(self);
}

export function do_getPlanPanelCompactWidth(self: InteractiveMode): number {
  return do_getPlanPanelCompactWidth(self);
}

export function do_getPlanPanelBounds(self: InteractiveMode): PlanPanelBounds {
  return do_getPlanPanelBounds(self);
}

export function do_handlePlanPanelInput(self: InteractiveMode, data: string): { consume: boolean } | undefined {
  return do_handlePlanPanelInput(self, data);
}

export function do_setPlanPanelMouseMode(self: InteractiveMode, active: boolean): void {
  do_setPlanPanelMouseMode(self, active);
}

export function do_scrollPlanPanel(self: InteractiveMode, direction: -1 | 1): void {
  do_scrollPlanPanel(self, direction);
}
