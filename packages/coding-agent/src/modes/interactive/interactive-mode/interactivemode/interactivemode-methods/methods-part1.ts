import type { AutocompleteProvider, MarkdownTheme } from "@dst0/p-tui";
import type { ExtensionRunner } from "../../../../../core/extensions/index.ts";
import type { ResourceDiagnostic } from "../../../../../core/resource-loader.ts";
import type { SourceInfo } from "../../../../../core/source-info.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_updateTerminalBackground(self: InteractiveMode): void {
  do_updateTerminalBackground(self);
}

export async function do_detectThemeIfUnset(self: InteractiveMode): Promise<void> {
  return do_detectThemeIfUnset(self);
}

export function do_getAutocompleteSourceTag(self: InteractiveMode, sourceInfo?: SourceInfo): string | undefined {
  return do_getAutocompleteSourceTag(self, sourceInfo);
}

export function do_prefixAutocompleteDescription(
  self: InteractiveMode,
  description: string | undefined,
  sourceInfo?: SourceInfo,
): string | undefined {
  return do_prefixAutocompleteDescription(self, description, sourceInfo);
}

export function do_getBuiltInCommandConflictDiagnostics(
  self: InteractiveMode,
  extensionRunner: ExtensionRunner,
): ResourceDiagnostic[] {
  return do_getBuiltInCommandConflictDiagnostics(self, extensionRunner);
}

export function do_createBaseAutocompleteProvider(self: InteractiveMode): AutocompleteProvider {
  return do_createBaseAutocompleteProvider(self);
}

export function do_setupAutocompleteProvider(self: InteractiveMode): void {
  do_setupAutocompleteProvider(self);
}

export function do_showStartupNoticesIfNeeded(self: InteractiveMode): void {
  do_showStartupNoticesIfNeeded(self);
}

export async function do_init(self: InteractiveMode): Promise<void> {
  return do_init(self);
}

export function do_updateTerminalTitle(self: InteractiveMode): void {
  do_updateTerminalTitle(self);
}

export async function do_run(self: InteractiveMode): Promise<void> {
  return do_run(self);
}

export async function do_checkForPackageUpdates(self: InteractiveMode): Promise<string[]> {
  return do_checkForPackageUpdates(self);
}

export async function do_checkTmuxKeyboardSetup(self: InteractiveMode): Promise<string | undefined> {
  return do_checkTmuxKeyboardSetup(self);
}

export function do_getChangelogForDisplay(self: InteractiveMode): string | undefined {
  return do_getChangelogForDisplay(self);
}

export function do_reportInstallTelemetry(self: InteractiveMode, version: string): void {
  do_reportInstallTelemetry(self, version);
}

export function do_getMarkdownThemeWithSettings(self: InteractiveMode): MarkdownTheme {
  return do_getMarkdownThemeWithSettings(self);
}

export function do_formatDisplayPath(self: InteractiveMode, p: string): string {
  return do_formatDisplayPath(self, p);
}

export function do_formatExtensionDisplayPath(self: InteractiveMode, path: string): string {
  return do_formatExtensionDisplayPath(self, path);
}

export function do_formatContextPath(self: InteractiveMode, p: string): string {
  return do_formatContextPath(self, p);
}

export function do_getStartupExpansionState(self: InteractiveMode): boolean {
  return do_getStartupExpansionState(self);
}

export function do_getShortPath(self: InteractiveMode, fullPath: string, sourceInfo?: SourceInfo): string {
  return do_getShortPath(self, fullPath, sourceInfo);
}

export function do_getCompactPathLabel(self: InteractiveMode, resourcePath: string, sourceInfo?: SourceInfo): string {
  return do_getCompactPathLabel(self, resourcePath, sourceInfo);
}

export function do_getCompactPackageSourceLabel(self: InteractiveMode, sourceInfo?: SourceInfo): string {
  return do_getCompactPackageSourceLabel(self, sourceInfo);
}

export function do_getCompactExtensionLabel(
  self: InteractiveMode,
  resourcePath: string,
  sourceInfo?: SourceInfo,
): string {
  return do_getCompactExtensionLabel(self, resourcePath, sourceInfo);
}

export function do_getCompactDisplayPathSegments(self: InteractiveMode, resourcePath: string): string[] {
  return do_getCompactDisplayPathSegments(self, resourcePath);
}

export function do_getCompactNonPackageExtensionLabel(
  self: InteractiveMode,
  resourcePath: string,
  index: number,
  allPaths: Array<{ path: string; segments: string[] }>,
): string {
  return do_getCompactNonPackageExtensionLabel(self, resourcePath, index, allPaths);
}

export function do_getCompactExtensionLabels(
  self: InteractiveMode,
  extensions: Array<{ path: string; sourceInfo?: SourceInfo }>,
): string[] {
  return do_getCompactExtensionLabels(self, extensions);
}

export function do_getDisplaySourceInfo(
  self: InteractiveMode,
  sourceInfo?: SourceInfo,
): {
  label: string;
  scopeLabel?: string;
  color: "accent" | "muted";
} {
  return do_getDisplaySourceInfo(self, sourceInfo);
}

export function do_getScopeGroup(self: InteractiveMode, sourceInfo?: SourceInfo): "user" | "project" | "path" {
  return do_getScopeGroup(self, sourceInfo);
}

export function do_isPackageSource(self: InteractiveMode, sourceInfo?: SourceInfo): boolean {
  return do_isPackageSource(self, sourceInfo);
}

export function do_buildScopeGroups(
  self: InteractiveMode,
  items: Array<{ path: string; sourceInfo?: SourceInfo }>,
): Array<{
  scope: "user" | "project" | "path";
  paths: Array<{ path: string; sourceInfo?: SourceInfo }>;
  packages: Map<string, Array<{ path: string; sourceInfo?: SourceInfo }>>;
}> {
  return do_buildScopeGroups(self, items);
}

export function do_formatScopeGroups(
  self: InteractiveMode,
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
  return do_formatScopeGroups(self, groups, options);
}

export function do_findSourceInfoForPath(
  self: InteractiveMode,
  p: string,
  sourceInfos: Map<string, SourceInfo>,
): SourceInfo | undefined {
  return do_findSourceInfoForPath(self, p, sourceInfos);
}

export function do_formatPathWithSource(self: InteractiveMode, p: string, sourceInfo?: SourceInfo): string {
  return do_formatPathWithSource(self, p, sourceInfo);
}

export function do_formatDiagnostics(
  self: InteractiveMode,
  diagnostics: readonly ResourceDiagnostic[],
  sourceInfos: Map<string, SourceInfo>,
): string {
  return do_formatDiagnostics(self, diagnostics, sourceInfos);
}

export function do_showLoadedResources(
  self: InteractiveMode,
  options?: {
    extensions?: Array<{ path: string; sourceInfo?: SourceInfo }>;
    force?: boolean;
    showDiagnosticsWhenQuiet?: boolean;
  },
): void {
  do_showLoadedResources(self, options);
}

export async function do_bindCurrentSessionExtensions(self: InteractiveMode): Promise<void> {
  return do_bindCurrentSessionExtensions(self);
}

export function do_applyRuntimeSettings(self: InteractiveMode): void {
  do_applyRuntimeSettings(self);
}

export async function do_rebindCurrentSession(self: InteractiveMode): Promise<void> {
  return do_rebindCurrentSession(self);
}

export async function do_handleFatalRuntimeError(
  self: InteractiveMode,
  prefix: string,
  error: unknown,
): Promise<never> {
  return do_handleFatalRuntimeError(self, prefix, error);
}

export function do_renderCurrentSessionState(self: InteractiveMode): void {
  do_renderCurrentSessionState(self);
}

export function do_getRegisteredToolDefinition(self: InteractiveMode, toolName: string) {
  return do_getRegisteredToolDefinition(self, toolName);
}

export function do_setupExtensionShortcuts(self: InteractiveMode, extensionRunner: ExtensionRunner): void {
  do_setupExtensionShortcuts(self, extensionRunner);
}
