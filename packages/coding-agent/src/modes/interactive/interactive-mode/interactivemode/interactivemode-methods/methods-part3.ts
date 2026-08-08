import type { AgentMessage } from "@dst0/p-agent-core";
import type { Model } from "@dst0/p-ai";
import type { Component } from "@dst0/p-tui";
import type { AgentSessionEvent } from "../../../../../core/agent-session.ts";
import type { SessionContext } from "../../../../../core/session-manager.ts";
import type { LatestPiRelease } from "../../../../../utils/version-check.ts";
import type { SgrMouseEvent } from "../../../components/plan-panel.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_resizePlanPanel(self: InteractiveMode, widthDelta: number, heightDelta: number): void {
  do_resizePlanPanel(self, widthDelta, heightDelta);
}

export function do_setPlanPanelSize(
  self: InteractiveMode,
  width: number | undefined,
  height: number | undefined,
): void {
  do_setPlanPanelSize(self, width, height);
}

export function do_handlePlanPanelMouse(self: InteractiveMode, event: SgrMouseEvent): boolean {
  return do_handlePlanPanelMouse(self, event);
}

export function do_syncPlanTracker(self: InteractiveMode): void {
  do_syncPlanTracker(self);
}

export function do_showStatus(self: InteractiveMode, message: string): void {
  do_showStatus(self, message);
}

export function do_addMessageToChat(
  self: InteractiveMode,
  message: AgentMessage,
  options?: { populateHistory?: boolean },
): void {
  do_addMessageToChat(self, message, options);
}

export function do_renderSessionContext(
  self: InteractiveMode,
  sessionContext: SessionContext,
  options: { updateFooter?: boolean; populateHistory?: boolean } = {},
): void {
  do_renderSessionContext(self, sessionContext, options);
}

export function do_renderInitialMessages(self: InteractiveMode): void {
  do_renderInitialMessages(self);
}

export function do_renderProjectTrustWarningIfNeeded(self: InteractiveMode): void {
  do_renderProjectTrustWarningIfNeeded(self);
}

export async function do_getUserInput(self: InteractiveMode): Promise<string> {
  return do_getUserInput(self);
}

export function do_rebuildChatFromMessages(self: InteractiveMode): void {
  do_rebuildChatFromMessages(self);
}

export function do_handleCtrlC(self: InteractiveMode): void {
  do_handleCtrlC(self);
}

export function do_handleCtrlD(self: InteractiveMode): void {
  do_handleCtrlD(self);
}

export async function do_shutdown(self: InteractiveMode, options?: { fromSignal?: boolean }): Promise<void> {
  return do_shutdown(self, options);
}

export function do_emergencyTerminalExit(self: InteractiveMode): never {
  return do_emergencyTerminalExit(self);
}

export function do_uncaughtCrash(self: InteractiveMode, error: Error): never {
  return do_uncaughtCrash(self, error);
}

export async function do_checkShutdownRequested(self: InteractiveMode): Promise<void> {
  return do_checkShutdownRequested(self);
}

export function do_registerSignalHandlers(self: InteractiveMode): void {
  do_registerSignalHandlers(self);
}

export function do_unregisterSignalHandlers(self: InteractiveMode): void {
  do_unregisterSignalHandlers(self);
}

export function do_handleCtrlZ(self: InteractiveMode): void {
  do_handleCtrlZ(self);
}

export async function do_handleFollowUp(self: InteractiveMode): Promise<void> {
  return do_handleFollowUp(self);
}

export function do_handleDequeue(self: InteractiveMode): void {
  do_handleDequeue(self);
}

export function do_updateEditorBorderColor(self: InteractiveMode): void {
  do_updateEditorBorderColor(self);
}

export function do_cycleThinkingLevel(self: InteractiveMode): void {
  do_cycleThinkingLevel(self);
}

export async function do_cycleModel(self: InteractiveMode, direction: "forward" | "backward"): Promise<void> {
  return do_cycleModel(self, direction);
}

export function do_toggleToolOutputExpansion(self: InteractiveMode): void {
  do_toggleToolOutputExpansion(self);
}

export function do_setToolsExpanded(self: InteractiveMode, expanded: boolean): void {
  do_setToolsExpanded(self, expanded);
}

export function do_getModelStatusLabel(self: InteractiveMode, model: Model<any>): string {
  return do_getModelStatusLabel(self, model);
}

export function do_noteModelSwitch(
  self: InteractiveMode,
  previousModel: Model<any> | undefined,
  nextModel: Model<any>,
): void {
  do_noteModelSwitch(self, previousModel, nextModel);
}

export function do_getRecentModelSwitch(self: InteractiveMode): { fromModel: string; toModel: string } | undefined {
  return do_getRecentModelSwitch(self);
}

export function do_clearLlmOrchestratorQueueProgress(self: InteractiveMode): void {
  do_clearLlmOrchestratorQueueProgress(self);
}

export function do_updateQueuedFooterSpinnerTimer(self: InteractiveMode): void {
  do_updateQueuedFooterSpinnerTimer(self);
}

export function do_removeTransientStreamingUi(self: InteractiveMode): void {
  do_removeTransientStreamingUi(self);
}

export function do_showRetryProgressInFooter(
  self: InteractiveMode,
  event: Extract<AgentSessionEvent, { type: "auto_retry_start" }>,
): void {
  do_showRetryProgressInFooter(self, event);
}

export function do_toggleThinkingBlockVisibility(self: InteractiveMode): void {
  do_toggleThinkingBlockVisibility(self);
}

export async function do_openExternalEditor(self: InteractiveMode): Promise<void> {
  return do_openExternalEditor(self);
}

export function do_clearEditor(self: InteractiveMode): void {
  do_clearEditor(self);
}

export function do_showError(self: InteractiveMode, errorMessage: string): void {
  do_showError(self, errorMessage);
}

export function do_showWarning(self: InteractiveMode, warningMessage: string): void {
  do_showWarning(self, warningMessage);
}

export function do_showNewVersionNotification(self: InteractiveMode, release: LatestPiRelease): void {
  do_showNewVersionNotification(self, release);
}

export function do_showPackageUpdateNotification(self: InteractiveMode, packages: string[]): void {
  do_showPackageUpdateNotification(self, packages);
}

export function do_getAllQueuedMessages(self: InteractiveMode): { steering: string[]; followUp: string[] } {
  return do_getAllQueuedMessages(self);
}

export function do_clearAllQueues(self: InteractiveMode): { steering: string[]; followUp: string[] } {
  return do_clearAllQueues(self);
}

export function do_updatePendingMessagesDisplay(self: InteractiveMode): void {
  do_updatePendingMessagesDisplay(self);
}

export function do_restoreQueuedMessagesToEditor(
  self: InteractiveMode,
  options?: { abort?: boolean; currentText?: string },
): number {
  return do_restoreQueuedMessagesToEditor(self, options);
}

export function do_queueCompactionMessage(self: InteractiveMode, text: string, mode: "steer" | "followUp"): void {
  do_queueCompactionMessage(self, text, mode);
}

export function do_isExtensionCommand(self: InteractiveMode, text: string): boolean {
  return do_isExtensionCommand(self, text);
}

export async function do_flushCompactionQueue(self: InteractiveMode, options?: { willRetry?: boolean }): Promise<void> {
  return do_flushCompactionQueue(self, options);
}

export function do_flushPendingBashComponents(self: InteractiveMode): void {
  do_flushPendingBashComponents(self);
}

export function do_showSelector(
  self: InteractiveMode,
  create: (done: () => void) => { component: Component; focus: Component },
): void {
  do_showSelector(self, create);
}
