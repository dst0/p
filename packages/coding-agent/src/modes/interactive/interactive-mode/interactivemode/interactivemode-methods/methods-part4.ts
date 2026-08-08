import type { Model, OAuthSelectPrompt } from "@dst0/p-ai";
import type { Keybinding } from "@dst0/p-tui";
import type { ExtensionCommandContext } from "../../../../../core/extensions/index.ts";
import type { AppKeybinding } from "../../../../../core/keybindings.ts";
import type { LoginDialogComponent } from "../../../components/login-dialog.ts";
import type { AuthSelectorProvider } from "../../../components/oauth-selector.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_showSettingsSelector(self: InteractiveMode): void {
  do_showSettingsSelector(self);
}

export function do_setShowHarnessMessages(self: InteractiveMode, enabled: boolean): void {
  do_setShowHarnessMessages(self, enabled);
}

export async function do_handleModelCommand(self: InteractiveMode, searchTerm?: string): Promise<void> {
  return do_handleModelCommand(self, searchTerm);
}

export async function do_findExactModelMatch(
  self: InteractiveMode,
  searchTerm: string,
): Promise<Model<any> | undefined> {
  return do_findExactModelMatch(self, searchTerm);
}

export async function do_getModelCandidates(self: InteractiveMode): Promise<Model<any>[]> {
  return do_getModelCandidates(self);
}

export async function do_updateAvailableProviderCount(self: InteractiveMode): Promise<void> {
  return do_updateAvailableProviderCount(self);
}

export async function do_maybeWarnAboutAnthropicSubscriptionAuth(
  self: InteractiveMode,
  model: Model<any> | undefined = self.session.model,
): Promise<void> {
  return do_maybeWarnAboutAnthropicSubscriptionAuth(self, model);
}

export function do_maybeSaveImplicitProjectTrustAfterReload(self: InteractiveMode): boolean {
  return do_maybeSaveImplicitProjectTrustAfterReload(self);
}

export function do_showTrustSelector(self: InteractiveMode): void {
  do_showTrustSelector(self);
}

export function do_showModelSelector(self: InteractiveMode, initialSearchInput?: string): void {
  do_showModelSelector(self, initialSearchInput);
}

export async function do_showModelsSelector(self: InteractiveMode): Promise<void> {
  return do_showModelsSelector(self);
}

export function do_showUserMessageSelector(self: InteractiveMode): void {
  do_showUserMessageSelector(self);
}

export async function do_handleCloneCommand(self: InteractiveMode): Promise<void> {
  return do_handleCloneCommand(self);
}

export function do_showTreeSelector(self: InteractiveMode, initialSelectedId?: string): void {
  do_showTreeSelector(self, initialSelectedId);
}

export function do_showSessionSelector(self: InteractiveMode): void {
  do_showSessionSelector(self);
}

export async function do_handleResumeSession(
  self: InteractiveMode,
  sessionPath: string,
  options?: Parameters<ExtensionCommandContext["switchSession"]>[1],
): Promise<{ cancelled: boolean }> {
  return do_handleResumeSession(self, sessionPath, options);
}

export function do_getLoginProviderOptions(
  self: InteractiveMode,
  authType?: "oauth" | "api_key",
): AuthSelectorProvider[] {
  return do_getLoginProviderOptions(self, authType);
}

export function do_getLogoutProviderOptions(self: InteractiveMode): AuthSelectorProvider[] {
  return do_getLogoutProviderOptions(self);
}

export function do_showLoginAuthTypeSelector(self: InteractiveMode): void {
  do_showLoginAuthTypeSelector(self);
}

export function do_showLoginProviderSelector(self: InteractiveMode, authType: "oauth" | "api_key"): void {
  do_showLoginProviderSelector(self, authType);
}

export async function do_showOAuthSelector(self: InteractiveMode, mode: "login" | "logout"): Promise<void> {
  return do_showOAuthSelector(self, mode);
}

export async function do_completeProviderAuthentication(
  self: InteractiveMode,
  providerId: string,
  providerName: string,
  authType: "oauth" | "api_key",
  previousModel: Model<any> | undefined,
): Promise<void> {
  return do_completeProviderAuthentication(self, providerId, providerName, authType, previousModel);
}

export function do_showBedrockSetupDialog(self: InteractiveMode, providerId: string, providerName: string): void {
  do_showBedrockSetupDialog(self, providerId, providerName);
}

export async function do_showApiKeyLoginDialog(
  self: InteractiveMode,
  providerId: string,
  providerName: string,
): Promise<void> {
  return do_showApiKeyLoginDialog(self, providerId, providerName);
}

export function do_showOAuthLoginSelect(
  self: InteractiveMode,
  dialog: LoginDialogComponent,
  prompt: OAuthSelectPrompt,
): Promise<string | undefined> {
  return do_showOAuthLoginSelect(self, dialog, prompt);
}

export async function do_showLoginDialog(
  self: InteractiveMode,
  providerId: string,
  providerName: string,
): Promise<void> {
  return do_showLoginDialog(self, providerId, providerName);
}

export async function do_handlePlanCommand(self: InteractiveMode, text: string): Promise<void> {
  return do_handlePlanCommand(self, text);
}

export async function do_handleReloadCommand(self: InteractiveMode): Promise<void> {
  return do_handleReloadCommand(self);
}

export async function do_handleExportCommand(self: InteractiveMode, text: string): Promise<void> {
  return do_handleExportCommand(self, text);
}

export function do_getPathCommandArgument(
  self: InteractiveMode,
  text: string,
  command: "/export" | "/import",
): string | undefined {
  return do_getPathCommandArgument(self, text, command);
}

export async function do_handleImportCommand(self: InteractiveMode, text: string): Promise<void> {
  return do_handleImportCommand(self, text);
}

export async function do_handleShareCommand(self: InteractiveMode): Promise<void> {
  return do_handleShareCommand(self);
}

export async function do_handleCopyCommand(self: InteractiveMode): Promise<void> {
  return do_handleCopyCommand(self);
}

export function do_handleNameCommand(self: InteractiveMode, text: string): void {
  do_handleNameCommand(self, text);
}

export function do_handleSessionCommand(self: InteractiveMode): void {
  do_handleSessionCommand(self);
}

export function do_handleStateCommand(self: InteractiveMode): void {
  do_handleStateCommand(self);
}

export function do_handleMemoryCommand(self: InteractiveMode, text: string): void {
  do_handleMemoryCommand(self, text);
}

export function do_handleRulesCommand(self: InteractiveMode, text: string): void {
  do_handleRulesCommand(self, text);
}

export async function do_handleIndexCommand(self: InteractiveMode, text?: string): Promise<void> {
  return do_handleIndexCommand(self, text);
}

export async function do_buildIndexStatusText(
  self: InteractiveMode,
  resolvedPath: string,
  args: string,
): Promise<string> {
  return do_buildIndexStatusText(self, resolvedPath, args);
}

export function do_handleChangelogCommand(self: InteractiveMode): void {
  do_handleChangelogCommand(self);
}

export function do_getAppKeyDisplay(self: InteractiveMode, action: AppKeybinding): string {
  return do_getAppKeyDisplay(self, action);
}

export function do_getEditorKeyDisplay(self: InteractiveMode, action: Keybinding): string {
  return do_getEditorKeyDisplay(self, action);
}

export function do_handleHotkeysCommand(self: InteractiveMode): void {
  do_handleHotkeysCommand(self);
}

export async function do_handleClearCommand(self: InteractiveMode): Promise<void> {
  return do_handleClearCommand(self);
}

export function do_handleDebugCommand(self: InteractiveMode): void {
  do_handleDebugCommand(self);
}

export function do_handleArminSaysHi(self: InteractiveMode): void {
  do_handleArminSaysHi(self);
}

export function do_handleDementedDelves(self: InteractiveMode): void {
  do_handleDementedDelves(self);
}

export function do_handleDaxnuts(self: InteractiveMode): void {
  do_handleDaxnuts(self);
}

export function do_checkDaxnutsEasterEgg(self: InteractiveMode, model: { provider: string; id: string }): void {
  do_checkDaxnutsEasterEgg(self, model);
}
