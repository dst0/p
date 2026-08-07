import { parseHttpIdleTimeoutMs } from "../http-dispatcher.ts";
import type { Settings } from "./types-part1.ts";

export function deepMergeSettings(base: Settings, overrides: Settings): Settings {
  const result: Settings = { ...base };

  for (const key of Object.keys(overrides) as (keyof Settings)[]) {
    const overrideValue = overrides[key];
    const baseValue = base[key];

    if (overrideValue === undefined) {
      continue;
    }

    // For nested objects, merge recursively
    if (
      typeof overrideValue === "object" &&
      overrideValue !== null &&
      !Array.isArray(overrideValue) &&
      typeof baseValue === "object" &&
      baseValue !== null &&
      !Array.isArray(baseValue)
    ) {
      (result as Record<string, unknown>)[key] = { ...baseValue, ...overrideValue };
    } else {
      // For primitives and arrays, override value wins
      (result as Record<string, unknown>)[key] = overrideValue;
    }
  }

  return result;
}

export function parseTimeoutSetting(value: unknown, settingName: string): number | undefined {
  const timeoutMs = parseHttpIdleTimeoutMs(value);
  if (timeoutMs !== undefined) {
    return timeoutMs;
  }
  if (value !== undefined) {
    throw new Error(`Invalid ${settingName} setting: ${String(value)}`);
  }
  return undefined;
}

export function parsePositiveIntegerSetting(value: unknown, settingName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error(`Invalid ${settingName} setting: ${String(value)}`);
  }
  return Math.floor(value);
}
