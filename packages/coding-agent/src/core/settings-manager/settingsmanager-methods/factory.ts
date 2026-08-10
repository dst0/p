import { getAgentDir } from "../../../config.ts";
import { FileSettingsStorage } from "../filesettingsstorage.ts";
import { InMemorySettingsStorage } from "../inmemorysettingsstorage.ts";
import { SettingsManager } from "../settingsmanager.ts";
import type { Settings, SettingsError, SettingsManagerCreateOptions, SettingsStorage } from "../types.ts";

export function do_create(
  cwd: string,
  agentDir: string = getAgentDir(),
  options: SettingsManagerCreateOptions = {},
): SettingsManager {
  const storage = new FileSettingsStorage(cwd, agentDir);
  return SettingsManager.fromStorage(storage, options);
}

export function do_fromStorage(storage: SettingsStorage, options: SettingsManagerCreateOptions = {}): SettingsManager {
  const projectTrusted = options.projectTrusted ?? true;
  const globalLoad = SettingsManager.tryLoadFromStorage(storage, "global");
  const projectLoad = SettingsManager.tryLoadFromStorage(storage, "project", projectTrusted);
  const initialErrors: SettingsError[] = [];
  if (globalLoad.error) {
    initialErrors.push({ scope: "global", error: globalLoad.error });
  }
  if (projectLoad.error) {
    initialErrors.push({ scope: "project", error: projectLoad.error });
  }

  return new SettingsManager(
    storage,
    globalLoad.settings,
    projectLoad.settings,
    globalLoad.error,
    projectLoad.error,
    initialErrors,
    projectTrusted,
  );
}

export function do_inMemory(settings: Partial<Settings> = {}): SettingsManager {
  const storage = new InMemorySettingsStorage();
  const initialSettings = SettingsManager.migrateSettings(structuredClone(settings) as Record<string, unknown>);
  storage.withLock("global", () => JSON.stringify(initialSettings, null, 2));
  return SettingsManager.fromStorage(storage);
}
