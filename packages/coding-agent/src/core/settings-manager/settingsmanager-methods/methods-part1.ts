import { getAgentDir } from "../../../config.ts";
import { stripJsonComments } from "../../../utils/json.ts";
import { FileSettingsStorage } from "../filesettingsstorage.ts";
import { deepMergeSettings } from "../helpers.ts";
import { InMemorySettingsStorage } from "../inmemorysettingsstorage.ts";
import { SettingsManager } from "../settingsmanager.ts";
import type {
  Settings,
  SettingsError,
  SettingsManagerCreateOptions,
  SettingsScope,
  SettingsStorage,
} from "../types-part1.ts";

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

export function do_loadFromStorage(storage: SettingsStorage, scope: SettingsScope, projectTrusted = true): Settings {
  if (scope === "project" && !projectTrusted) {
    return {};
  }

  let content: string | undefined;
  storage.withLock(scope, (current) => {
    content = current;
    return undefined;
  });

  if (!content) {
    return {};
  }
  const settings = JSON.parse(stripJsonComments(content));
  return SettingsManager.migrateSettings(settings);
}

export function do_tryLoadFromStorage(
  storage: SettingsStorage,
  scope: SettingsScope,
  projectTrusted = true,
): { settings: Settings; error: Error | null } {
  try {
    return { settings: SettingsManager.loadFromStorage(storage, scope, projectTrusted), error: null };
  } catch (error) {
    return { settings: {}, error: error as Error };
  }
}

export function do_migrateSettings(settings: Record<string, unknown>): Settings {
  // Migrate queueMode -> steeringMode
  if ("queueMode" in settings && !("steeringMode" in settings)) {
    settings.steeringMode = settings.queueMode;
    delete settings.queueMode;
  }

  // Migrate legacy websockets boolean -> transport enum
  if (!("transport" in settings) && typeof settings.websockets === "boolean") {
    settings.transport = settings.websockets ? "websocket" : "sse";
    delete settings.websockets;
  }

  // Migrate old skills object format to new array format
  if (
    "skills" in settings &&
    typeof settings.skills === "object" &&
    settings.skills !== null &&
    !Array.isArray(settings.skills)
  ) {
    const skillsSettings = settings.skills as {
      enableSkillCommands?: boolean;
      customDirectories?: unknown;
    };
    if (skillsSettings.enableSkillCommands !== undefined && settings.enableSkillCommands === undefined) {
      settings.enableSkillCommands = skillsSettings.enableSkillCommands;
    }
    if (Array.isArray(skillsSettings.customDirectories) && skillsSettings.customDirectories.length > 0) {
      settings.skills = skillsSettings.customDirectories;
    } else {
      delete settings.skills;
    }
  }

  // Migrate retry.maxDelayMs -> retry.provider.maxRetryDelayMs
  if (
    "retry" in settings &&
    typeof settings.retry === "object" &&
    settings.retry !== null &&
    !Array.isArray(settings.retry)
  ) {
    const retrySettings = settings.retry as Record<string, unknown>;
    const providerSettings =
      typeof retrySettings.provider === "object" && retrySettings.provider !== null
        ? (retrySettings.provider as Record<string, unknown>)
        : undefined;
    if (
      typeof retrySettings.maxDelayMs === "number" &&
      (providerSettings?.maxRetryDelayMs === undefined || providerSettings?.maxRetryDelayMs === null)
    ) {
      retrySettings.provider = {
        ...(providerSettings ?? {}),
        maxRetryDelayMs: retrySettings.maxDelayMs,
      };
    }
    delete retrySettings.maxDelayMs;
  }

  return settings as Settings;
}

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
  if (self.projectTrusted === trusted) {
    return;
  }

  self.projectTrusted = trusted;
  self.modifiedProjectFields.clear();
  self.modifiedProjectNestedFields.clear();

  if (!trusted) {
    self.projectSettings = {};
    self.projectSettingsLoadError = null;
    self.settings = deepMergeSettings(self.globalSettings, self.projectSettings);
    return;
  }

  const projectLoad = SettingsManager.tryLoadFromStorage(self.storage, "project", trusted);
  self.projectSettings = projectLoad.settings;
  self.projectSettingsLoadError = projectLoad.error;
  if (projectLoad.error) {
    self.recordError("project", projectLoad.error);
  }
  self.settings = deepMergeSettings(self.globalSettings, self.projectSettings);
}
