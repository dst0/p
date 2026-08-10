import { stripJsonComments } from "../../../utils/json.ts";
import type { Settings, SettingsScope, SettingsStorage } from "../types.ts";

export function do_loadFromStorage(storage: SettingsStorage, scope: SettingsScope, projectTrusted = true): Settings {
  if (scope === "project" && !projectTrusted) return {};

  let content: string | undefined;
  storage.withLock(scope, (current) => {
    content = current;
    return undefined;
  });

  if (!content) return {};
  return do_migrateSettings(JSON.parse(stripJsonComments(content)));
}

export function do_tryLoadFromStorage(
  storage: SettingsStorage,
  scope: SettingsScope,
  projectTrusted = true,
): { settings: Settings; error: Error | null } {
  try {
    return { settings: do_loadFromStorage(storage, scope, projectTrusted), error: null };
  } catch (error) {
    return { settings: {}, error: error as Error };
  }
}

export function do_migrateSettings(settings: Record<string, unknown>): Settings {
  if ("queueMode" in settings && !("steeringMode" in settings)) {
    settings.steeringMode = settings.queueMode;
    delete settings.queueMode;
  }

  if (!("transport" in settings) && typeof settings.websockets === "boolean") {
    settings.transport = settings.websockets ? "websocket" : "sse";
    delete settings.websockets;
  }

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
