import { deepMergeSettings } from "../helpers.ts";
import type { SettingsManager } from "../settingsmanager.ts";
import type { Settings } from "../types.ts";
import { do_tryLoadFromStorage } from "./storage-loading.ts";

export function do_getGlobalSettings(self: SettingsManager): Settings {
  return structuredClone(self.globalSettings);
}

export function do_getProjectSettings(self: SettingsManager): Settings {
  return structuredClone(self.projectSettings);
}

export function do_isProjectTrusted(self: SettingsManager): boolean {
  return self.projectTrusted;
}

export function do_setProjectTrusted(self: SettingsManager, trusted: boolean): void {
  if (self.projectTrusted === trusted) return;

  self.projectTrusted = trusted;
  self.modifiedProjectFields.clear();
  self.modifiedProjectNestedFields.clear();

  if (!trusted) {
    self.projectSettings = {};
    self.projectSettingsLoadError = null;
    self.settings = deepMergeSettings(self.globalSettings, self.projectSettings);
    return;
  }

  const projectLoad = do_tryLoadFromStorage(self.storage, "project", trusted);
  self.projectSettings = projectLoad.settings;
  self.projectSettingsLoadError = projectLoad.error;
  if (projectLoad.error) self.recordError("project", projectLoad.error);
  self.settings = deepMergeSettings(self.globalSettings, self.projectSettings);
}
