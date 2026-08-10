import { randomUUID } from "crypto";
import type { SettingsManager } from "../settingsmanager.ts";
import type { DefaultProjectTrust, PackageSource } from "../types.ts";

export function do_setHideThinkingBlock(self: SettingsManager, hide: boolean): void {
  self.globalSettings.hideThinkingBlock = hide;
  self.markModified("hideThinkingBlock");
  self.save();
}

export function do_getShellPath(self: SettingsManager): string | undefined {
  return self.settings.shellPath;
}

export function do_setShellPath(self: SettingsManager, path: string | undefined): void {
  self.globalSettings.shellPath = path;
  self.markModified("shellPath");
  self.save();
}

export function do_getQuietStartup(self: SettingsManager): boolean {
  return self.settings.quietStartup ?? false;
}

export function do_setQuietStartup(self: SettingsManager, quiet: boolean): void {
  self.globalSettings.quietStartup = quiet;
  self.markModified("quietStartup");
  self.save();
}

export function do_getDefaultProjectTrust(self: SettingsManager): DefaultProjectTrust {
  const value = self.globalSettings.defaultProjectTrust;
  return value === "always" || value === "never" ? value : "ask";
}

export function do_setDefaultProjectTrust(self: SettingsManager, defaultProjectTrust: DefaultProjectTrust): void {
  self.globalSettings.defaultProjectTrust = defaultProjectTrust;
  self.markModified("defaultProjectTrust");
  self.save();
}

export function do_getShellCommandPrefix(self: SettingsManager): string | undefined {
  return self.settings.shellCommandPrefix;
}

export function do_setShellCommandPrefix(self: SettingsManager, prefix: string | undefined): void {
  self.globalSettings.shellCommandPrefix = prefix;
  self.markModified("shellCommandPrefix");
  self.save();
}

export function do_getNpmCommand(self: SettingsManager): string[] | undefined {
  return self.settings.npmCommand ? [...self.settings.npmCommand] : undefined;
}

export function do_setNpmCommand(self: SettingsManager, command: string[] | undefined): void {
  self.globalSettings.npmCommand = command ? [...command] : undefined;
  self.markModified("npmCommand");
  self.save();
}

export function do_getCollapseChangelog(self: SettingsManager): boolean {
  return self.settings.collapseChangelog ?? false;
}

export function do_setCollapseChangelog(self: SettingsManager, collapse: boolean): void {
  self.globalSettings.collapseChangelog = collapse;
  self.markModified("collapseChangelog");
  self.save();
}

export function do_getStartupNotices(self: SettingsManager): boolean {
  return self.settings.startupNotices ?? false;
}

export function do_setStartupNotices(self: SettingsManager, enabled: boolean): void {
  self.globalSettings.startupNotices = enabled;
  self.markModified("startupNotices");
  self.save();
}

export function do_getEnableInstallTelemetry(self: SettingsManager): boolean {
  return self.settings.enableInstallTelemetry ?? true;
}

export function do_setEnableInstallTelemetry(self: SettingsManager, enabled: boolean): void {
  self.globalSettings.enableInstallTelemetry = enabled;
  self.markModified("enableInstallTelemetry");
  self.save();
}

export function do_getEnableAnalytics(self: SettingsManager): boolean {
  return self.settings.enableAnalytics ?? false;
}

export function do_getTrackingId(self: SettingsManager): string | undefined {
  return self.settings.trackingId;
}

export function do_setEnableAnalytics(self: SettingsManager, enabled: boolean): void {
  self.globalSettings.enableAnalytics = enabled;
  self.markModified("enableAnalytics");
  if (enabled && !self.globalSettings.trackingId) {
    self.globalSettings.trackingId = randomUUID();
    self.markModified("trackingId");
  }
  self.save();
}

export function do_getPackages(self: SettingsManager): PackageSource[] {
  return [...(self.settings.packages ?? [])];
}

export function do_setPackages(self: SettingsManager, packages: PackageSource[]): void {
  self.globalSettings.packages = packages;
  self.markModified("packages");
  self.save();
}

export function do_setProjectPackages(self: SettingsManager, packages: PackageSource[]): void {
  self.updateProjectSettings("packages", (settings) => {
    settings.packages = packages;
  });
}

export function do_getExtensionPaths(self: SettingsManager): string[] {
  return [...(self.settings.extensions ?? [])];
}

export function do_setExtensionPaths(self: SettingsManager, paths: string[]): void {
  self.globalSettings.extensions = paths;
  self.markModified("extensions");
  self.save();
}

export function do_setProjectExtensionPaths(self: SettingsManager, paths: string[]): void {
  self.updateProjectSettings("extensions", (settings) => {
    settings.extensions = paths;
  });
}

export function do_getSkillPaths(self: SettingsManager): string[] {
  return [...(self.settings.skills ?? [])];
}

export function do_setSkillPaths(self: SettingsManager, paths: string[]): void {
  self.globalSettings.skills = paths;
  self.markModified("skills");
  self.save();
}

export function do_setProjectSkillPaths(self: SettingsManager, paths: string[]): void {
  self.updateProjectSettings("skills", (settings) => {
    settings.skills = paths;
  });
}

export function do_getPromptTemplatePaths(self: SettingsManager): string[] {
  return [...(self.settings.prompts ?? [])];
}

export function do_setPromptTemplatePaths(self: SettingsManager, paths: string[]): void {
  self.globalSettings.prompts = paths;
  self.markModified("prompts");
  self.save();
}

export function do_setProjectPromptTemplatePaths(self: SettingsManager, paths: string[]): void {
  self.updateProjectSettings("prompts", (settings) => {
    settings.prompts = paths;
  });
}

export function do_getThemePaths(self: SettingsManager): string[] {
  return [...(self.settings.themes ?? [])];
}

export function do_setThemePaths(self: SettingsManager, paths: string[]): void {
  self.globalSettings.themes = paths;
  self.markModified("themes");
  self.save();
}

export function do_setProjectThemePaths(self: SettingsManager, paths: string[]): void {
  self.updateProjectSettings("themes", (settings) => {
    settings.themes = paths;
  });
}
