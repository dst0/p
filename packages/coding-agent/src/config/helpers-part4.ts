import { join } from "path";
import { APP_NAME } from "./constants.ts";
import { getAgentDir } from "./helpers-part3.ts";

export function getCustomThemesDir(): string {
  return join(getAgentDir(), "themes");
}

export function getModelsPath(): string {
  return join(getAgentDir(), "models.json");
}

export function getAuthPath(): string {
  return join(getAgentDir(), "auth.json");
}

export function getSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}

export function getToolsDir(): string {
  return join(getAgentDir(), "tools");
}

export function getBinDir(): string {
  return join(getAgentDir(), "bin");
}

export function getPromptsDir(): string {
  return join(getAgentDir(), "prompts");
}

export function getSessionsDir(): string {
  return join(getAgentDir(), "sessions");
}

export function getDebugLogPath(): string {
  return join(getAgentDir(), `${APP_NAME}-debug.log`);
}
