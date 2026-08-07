import type { SettingsManager } from "../settingsmanager.ts";
import type { WarningSettings } from "../types-part1.ts";

export function do_getDoubleEscapeAction(self: SettingsManager): "fork" | "tree" | "none" {
  return self.settings.doubleEscapeAction ?? "tree";
}

export function do_setDoubleEscapeAction(self: SettingsManager, action: "fork" | "tree" | "none"): void {
  self.globalSettings.doubleEscapeAction = action;
  self.markModified("doubleEscapeAction");
  self.save();
}

export function do_getTreeFilterMode(
  self: SettingsManager,
): "default" | "no-tools" | "user-only" | "labeled-only" | "all" {
  const mode = self.settings.treeFilterMode;
  const valid = ["default", "no-tools", "user-only", "labeled-only", "all"];
  return mode && valid.includes(mode) ? mode : "default";
}

export function do_setTreeFilterMode(
  self: SettingsManager,
  mode: "default" | "no-tools" | "user-only" | "labeled-only" | "all",
): void {
  self.globalSettings.treeFilterMode = mode;
  self.markModified("treeFilterMode");
  self.save();
}

export function do_getShowHardwareCursor(self: SettingsManager): boolean {
  return self.settings.showHardwareCursor ?? process.env.PI_HARDWARE_CURSOR === "1";
}

export function do_setShowHardwareCursor(self: SettingsManager, enabled: boolean): void {
  self.globalSettings.showHardwareCursor = enabled;
  self.markModified("showHardwareCursor");
  self.save();
}

export function do_getEditorPaddingX(self: SettingsManager): number {
  return self.settings.editorPaddingX ?? 0;
}

export function do_setEditorPaddingX(self: SettingsManager, padding: number): void {
  self.globalSettings.editorPaddingX = Math.max(0, Math.min(3, Math.floor(padding)));
  self.markModified("editorPaddingX");
  self.save();
}

export function do_getAutocompleteMaxVisible(self: SettingsManager): number {
  return self.settings.autocompleteMaxVisible ?? 5;
}

export function do_setAutocompleteMaxVisible(self: SettingsManager, maxVisible: number): void {
  self.globalSettings.autocompleteMaxVisible = Math.max(3, Math.min(20, Math.floor(maxVisible)));
  self.markModified("autocompleteMaxVisible");
  self.save();
}

export function do_getCodeBlockIndent(self: SettingsManager): string {
  return self.settings.markdown?.codeBlockIndent ?? "  ";
}

export function do_getWarnings(self: SettingsManager): WarningSettings {
  return { ...(self.settings.warnings ?? {}) };
}

export function do_setWarnings(self: SettingsManager, warnings: WarningSettings): void {
  self.globalSettings.warnings = { ...warnings };
  self.markModified("warnings");
  self.save();
}

export function do_getPlanPanelMode(self: SettingsManager): "hidden" | "compact" | "expanded" {
  const mode = self.settings.planPanelMode;
  if (mode === "hidden" || mode === "compact" || mode === "expanded") {
    return mode;
  }
  return "hidden";
}

export function do_setPlanPanelMode(self: SettingsManager, mode: "hidden" | "compact" | "expanded"): void {
  self.globalSettings.planPanelMode = mode;
  self.markModified("planPanelMode");
  self.save();
}

export function do_getPlanPanelCompactWidth(self: SettingsManager): number {
  return self.settings.planPanelCompactWidth ?? 50;
}

export function do_setPlanPanelCompactWidth(self: SettingsManager, width: number): void {
  self.globalSettings.planPanelCompactWidth = Math.max(30, Math.floor(width));
  self.markModified("planPanelCompactWidth");
  self.save();
}

export function do_getPlanPanelHeight(self: SettingsManager): number | undefined {
  const height = self.settings.planPanelHeight;
  if (height === undefined || height === null) return undefined;
  return Math.max(8, Math.floor(height));
}

export function do_setPlanPanelHeight(self: SettingsManager, height: number | undefined): void {
  if (height === undefined) {
    delete self.globalSettings.planPanelHeight;
  } else {
    self.globalSettings.planPanelHeight = Math.max(8, Math.floor(height));
  }
  self.markModified("planPanelHeight");
  self.save();
}
