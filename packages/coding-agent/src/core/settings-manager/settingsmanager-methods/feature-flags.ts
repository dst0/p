import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "../../../config.ts";
import type { SettingsManager } from "../settingsmanager.ts";
import type { ThinkingBudgetsSettings } from "../types.ts";

export function do_getEnableSkillCommands(self: SettingsManager): boolean {
  return self.settings.enableSkillCommands ?? true;
}

export function do_setEnableSkillCommands(self: SettingsManager, enabled: boolean): void {
  self.globalSettings.enableSkillCommands = enabled;
  self.markModified("enableSkillCommands");
  self.save();
}

export function do_getThinkingBudgets(self: SettingsManager): ThinkingBudgetsSettings | undefined {
  return self.settings.thinkingBudgets;
}

export function do_getShowImages(self: SettingsManager): boolean {
  return self.settings.terminal?.showImages ?? true;
}

export function do_setShowImages(self: SettingsManager, show: boolean): void {
  if (!self.globalSettings.terminal) {
    self.globalSettings.terminal = {};
  }
  self.globalSettings.terminal.showImages = show;
  self.markModified("terminal", "showImages");
  self.save();
}

export function do_getImageWidthCells(self: SettingsManager): number {
  const width = self.settings.terminal?.imageWidthCells;
  if (typeof width !== "number" || !Number.isFinite(width)) {
    return 60;
  }
  return Math.max(1, Math.floor(width));
}

export function do_setImageWidthCells(self: SettingsManager, width: number): void {
  if (!self.globalSettings.terminal) {
    self.globalSettings.terminal = {};
  }
  self.globalSettings.terminal.imageWidthCells = Math.max(1, Math.floor(width));
  self.markModified("terminal", "imageWidthCells");
  self.save();
}

export function do_getClearOnShrink(self: SettingsManager): boolean {
  // Settings takes precedence, then env var, then default false
  if (self.settings.terminal?.clearOnShrink !== undefined) {
    return self.settings.terminal.clearOnShrink;
  }
  return process.env.PI_CLEAR_ON_SHRINK === "1";
}

export function do_setClearOnShrink(self: SettingsManager, enabled: boolean): void {
  if (!self.globalSettings.terminal) {
    self.globalSettings.terminal = {};
  }
  self.globalSettings.terminal.clearOnShrink = enabled;
  self.markModified("terminal", "clearOnShrink");
  self.save();
}

export function do_getShowTerminalProgress(self: SettingsManager): boolean {
  return self.settings.terminal?.showTerminalProgress ?? false;
}

export function do_setShowTerminalProgress(self: SettingsManager, enabled: boolean): void {
  if (!self.globalSettings.terminal) {
    self.globalSettings.terminal = {};
  }
  self.globalSettings.terminal.showTerminalProgress = enabled;
  self.markModified("terminal", "showTerminalProgress");
  self.save();
}

export function do_getShowTokenProgress(self: SettingsManager): boolean {
  return self.settings.terminal?.showTokenProgress ?? true;
}

export function do_setShowTokenProgress(self: SettingsManager, enabled: boolean): void {
  if (!self.globalSettings.terminal) {
    self.globalSettings.terminal = {};
  }
  self.globalSettings.terminal.showTokenProgress = enabled;
  self.markModified("terminal", "showTokenProgress");
  self.save();
}

export function do_getShowTokenStats(self: SettingsManager): boolean {
  return self.settings.terminal?.showTokenStats ?? true;
}

export function do_setShowTokenStats(self: SettingsManager, enabled: boolean): void {
  if (!self.globalSettings.terminal) {
    self.globalSettings.terminal = {};
  }
  self.globalSettings.terminal.showTokenStats = enabled;
  self.markModified("terminal", "showTokenStats");
  self.save();
}

export function do_getShowIndexingInfo(self: SettingsManager): boolean {
  return self.settings.terminal?.showIndexingInfo ?? true;
}

export function do_setShowIndexingInfo(self: SettingsManager, enabled: boolean): void {
  if (!self.globalSettings.terminal) {
    self.globalSettings.terminal = {};
  }
  self.globalSettings.terminal.showIndexingInfo = enabled;
  self.markModified("terminal", "showIndexingInfo");
  self.save();
}

function resolveAgentDir(self: SettingsManager): string {
  const storage = self.storage as { globalSettingsPath?: string };
  if (typeof storage?.globalSettingsPath === "string") {
    return path.dirname(storage.globalSettingsPath);
  }
  return getAgentDir();
}

export function do_getEnableIndexingTray(self: SettingsManager): boolean {
  try {
    const configPath = path.join(resolveAgentDir(self), "code-rag.json");
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      if (typeof parsed.enableTray === "boolean") return parsed.enableTray;
    }
  } catch {
    // Fallback on error.
  }
  return self.settings.enableIndexingTray ?? true;
}

export function do_setEnableIndexingTray(self: SettingsManager, enabled: boolean): void {
  self.globalSettings.enableIndexingTray = enabled;
  self.markModified("enableIndexingTray");
  self.save();

  try {
    const configPath = path.join(resolveAgentDir(self), "code-rag.json");
    let current: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      current = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
    }
    current.enableTray = enabled;
    fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
    const tempPath = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tempPath, configPath);
  } catch {
    // Best effort persistence to code-rag.json.
  }
}

export function do_getShowVersion(self: SettingsManager): boolean {
  return self.settings.terminal?.showVersion ?? false;
}

export function do_setShowVersion(self: SettingsManager, enabled: boolean): void {
  if (!self.globalSettings.terminal) {
    self.globalSettings.terminal = {};
  }
  self.globalSettings.terminal.showVersion = enabled;
  self.markModified("terminal", "showVersion");
  self.save();
}

export function do_getShowHarnessMessages(self: SettingsManager): boolean {
  return self.settings.terminal?.showHarnessMessages ?? false;
}

export function do_setShowHarnessMessages(self: SettingsManager, enabled: boolean): void {
  if (!self.globalSettings.terminal) {
    self.globalSettings.terminal = {};
  }
  self.globalSettings.terminal.showHarnessMessages = enabled;
  self.markModified("terminal", "showHarnessMessages");
  self.save();
}

export function do_getImageAutoResize(self: SettingsManager): boolean {
  return self.settings.images?.autoResize ?? true;
}

export function do_setImageAutoResize(self: SettingsManager, enabled: boolean): void {
  if (!self.globalSettings.images) {
    self.globalSettings.images = {};
  }
  self.globalSettings.images.autoResize = enabled;
  self.markModified("images", "autoResize");
  self.save();
}

export function do_getBlockImages(self: SettingsManager): boolean {
  return self.settings.images?.blockImages ?? false;
}

export function do_setBlockImages(self: SettingsManager, blocked: boolean): void {
  if (!self.globalSettings.images) {
    self.globalSettings.images = {};
  }
  self.globalSettings.images.blockImages = blocked;
  self.markModified("images", "blockImages");
  self.save();
}

export function do_getEnabledModels(self: SettingsManager): string[] | undefined {
  return self.settings.enabledModels;
}

export function do_setEnabledModels(self: SettingsManager, patterns: string[] | undefined): void {
  self.globalSettings.enabledModels = patterns;
  self.markModified("enabledModels");
  self.save();
}
