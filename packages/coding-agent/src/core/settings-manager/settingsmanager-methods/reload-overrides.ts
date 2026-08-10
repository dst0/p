import { stripJsonComments } from "../../../utils/json.ts";
import { deepMergeSettings } from "../helpers.ts";
import { SettingsManager } from "../settingsmanager.ts";
import type { Settings, SettingsScope } from "../types.ts";

export async function do_reload(self: SettingsManager): Promise<void> {
  await self.writeQueue;
  const globalLoad = SettingsManager.tryLoadFromStorage(self.storage, "global");
  if (!globalLoad.error) {
    self.globalSettings = globalLoad.settings;
    self.globalSettingsLoadError = null;
  } else {
    self.globalSettingsLoadError = globalLoad.error;
    self.recordError("global", globalLoad.error);
  }

  self.modifiedFields.clear();
  self.modifiedNestedFields.clear();
  self.modifiedProjectFields.clear();
  self.modifiedProjectNestedFields.clear();

  const projectLoad = SettingsManager.tryLoadFromStorage(self.storage, "project", self.projectTrusted);
  if (!projectLoad.error) {
    self.projectSettings = projectLoad.settings;
    self.projectSettingsLoadError = null;
  } else {
    self.projectSettingsLoadError = projectLoad.error;
    self.recordError("project", projectLoad.error);
  }

  self.settings = deepMergeSettings(self.globalSettings, self.projectSettings);
}

export function do_applyOverrides(self: SettingsManager, overrides: Partial<Settings>): void {
  self.settings = deepMergeSettings(self.settings, overrides);
}

export function do_markModified(self: SettingsManager, field: keyof Settings, nestedKey?: string): void {
  self.modifiedFields.add(field);
  if (nestedKey) {
    if (!self.modifiedNestedFields.has(field)) {
      self.modifiedNestedFields.set(field, new Set());
    }
    self.modifiedNestedFields.get(field)!.add(nestedKey);
  }
}

export function do_markProjectModified(self: SettingsManager, field: keyof Settings, nestedKey?: string): void {
  self.modifiedProjectFields.add(field);
  if (nestedKey) {
    if (!self.modifiedProjectNestedFields.has(field)) {
      self.modifiedProjectNestedFields.set(field, new Set());
    }
    self.modifiedProjectNestedFields.get(field)!.add(nestedKey);
  }
}

export function do_assertProjectTrustedForWrite(self: SettingsManager): void {
  if (!self.projectTrusted) {
    throw new Error("Project is not trusted; refusing to write project settings");
  }
}

export function do_recordError(self: SettingsManager, scope: SettingsScope, error: unknown): void {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  self.errors.push({ scope, error: normalizedError });
}

export function do_clearModifiedScope(self: SettingsManager, scope: SettingsScope): void {
  if (scope === "global") {
    self.modifiedFields.clear();
    self.modifiedNestedFields.clear();
    return;
  }

  self.modifiedProjectFields.clear();
  self.modifiedProjectNestedFields.clear();
}

export function do_enqueueWrite(self: SettingsManager, scope: SettingsScope, task: () => void): void {
  self.writeQueue = self.writeQueue
    .then(() => {
      if (scope === "project") {
        self.assertProjectTrustedForWrite();
      }
      task();
      self.clearModifiedScope(scope);
    })
    .catch((error) => {
      self.recordError(scope, error);
    });
}

export function do_cloneModifiedNestedFields(
  _self: SettingsManager,
  source: Map<keyof Settings, Set<string>>,
): Map<keyof Settings, Set<string>> {
  const snapshot = new Map<keyof Settings, Set<string>>();
  for (const [key, value] of source.entries()) {
    snapshot.set(key, new Set(value));
  }
  return snapshot;
}

export function do_persistScopedSettings(
  self: SettingsManager,
  scope: SettingsScope,
  snapshotSettings: Settings,
  modifiedFields: Set<keyof Settings>,
  modifiedNestedFields: Map<keyof Settings, Set<string>>,
): void {
  self.storage.withLock(scope, (current) => {
    const currentFileSettings = current
      ? SettingsManager.migrateSettings(JSON.parse(stripJsonComments(current)) as Record<string, unknown>)
      : {};
    const mergedSettings: Settings = { ...currentFileSettings };
    for (const field of modifiedFields) {
      const value = snapshotSettings[field];
      if (modifiedNestedFields.has(field) && typeof value === "object" && value !== null) {
        const nestedModified = modifiedNestedFields.get(field)!;
        const baseNested = (currentFileSettings[field] as Record<string, unknown>) ?? {};
        const inMemoryNested = value as Record<string, unknown>;
        const mergedNested = { ...baseNested };
        for (const nestedKey of nestedModified) {
          mergedNested[nestedKey] = inMemoryNested[nestedKey];
        }
        (mergedSettings as Record<string, unknown>)[field] = mergedNested;
      } else {
        (mergedSettings as Record<string, unknown>)[field] = value;
      }
    }

    return JSON.stringify(mergedSettings, null, 2);
  });
}

export function do_save(self: SettingsManager): void {
  self.settings = deepMergeSettings(self.globalSettings, self.projectSettings);

  if (self.globalSettingsLoadError) {
    return;
  }

  const snapshotGlobalSettings = structuredClone(self.globalSettings);
  const modifiedFields = new Set(self.modifiedFields);
  const modifiedNestedFields = self.cloneModifiedNestedFields(self.modifiedNestedFields);

  self.enqueueWrite("global", () => {
    self.persistScopedSettings("global", snapshotGlobalSettings, modifiedFields, modifiedNestedFields);
  });
}

export function do_saveProjectSettings(self: SettingsManager, settings: Settings): void {
  self.assertProjectTrustedForWrite();
  self.projectSettings = structuredClone(settings);
  self.settings = deepMergeSettings(self.globalSettings, self.projectSettings);

  if (self.projectSettingsLoadError) {
    return;
  }

  const snapshotProjectSettings = structuredClone(self.projectSettings);
  const modifiedFields = new Set(self.modifiedProjectFields);
  const modifiedNestedFields = self.cloneModifiedNestedFields(self.modifiedProjectNestedFields);
  self.enqueueWrite("project", () => {
    self.persistScopedSettings("project", snapshotProjectSettings, modifiedFields, modifiedNestedFields);
  });
}

export function do_updateProjectSettings(
  self: SettingsManager,
  field: keyof Settings,
  update: (settings: Settings) => void,
): void {
  self.assertProjectTrustedForWrite();
  const projectSettings = structuredClone(self.projectSettings);
  update(projectSettings);
  self.markProjectModified(field);
  self.saveProjectSettings(projectSettings);
}
