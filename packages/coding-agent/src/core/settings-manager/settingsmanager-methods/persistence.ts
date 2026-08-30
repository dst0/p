import type { CompletionMode, CompletionProtocolLimits } from "@dst0/p-agent-core";
import { normalizePath } from "../../../utils/paths.ts";
import { COMPLETION_MODE_ALIASES } from "../constants.ts";
import { parsePositiveIntegerSetting } from "../helpers.ts";
import type { SettingsManager } from "../settingsmanager.ts";
import type { SettingsError } from "../types.ts";

export async function do_flush(self: SettingsManager): Promise<void> {
  await self.writeQueue;
}

export function do_drainErrors(self: SettingsManager): SettingsError[] {
  const drained = [...self.errors];
  self.errors = [];
  return drained;
}

export function do_getLastChangelogVersion(self: SettingsManager): string | undefined {
  return self.settings.lastChangelogVersion;
}

export function do_setLastChangelogVersion(self: SettingsManager, version: string): void {
  self.globalSettings.lastChangelogVersion = version;
  self.markModified("lastChangelogVersion");
  self.save();
}

export function do_getSessionDir(self: SettingsManager): string | undefined {
  const sessionDir = self.settings.sessionDir;
  return sessionDir ? normalizePath(sessionDir) : sessionDir;
}

export function do_getDefaultProvider(self: SettingsManager): string | undefined {
  return self.settings.defaultProvider;
}

export function do_getDefaultModel(self: SettingsManager): string | undefined {
  return self.settings.defaultModel;
}

export function do_getDefaultImageProvider(self: SettingsManager): string | undefined {
  return self.settings.defaultImageProvider ?? self.settings.images?.defaultProvider;
}

export function do_getDefaultImageModel(self: SettingsManager): string | undefined {
  return self.settings.defaultImageModel ?? self.settings.images?.defaultModel;
}

export function do_getServiceModelSelection(self: SettingsManager): {
  provider?: string;
  modelId?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
} {
  return {
    provider: self.settings.serviceProvider,
    modelId: self.settings.serviceModel,
    thinkingLevel: self.settings.serviceThinkingLevel,
  };
}

export function do_getFastResponderSettings(self: SettingsManager): {
  enabled: boolean;
  provider?: string;
  modelId?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  minContextTokens: number;
  timeoutMs: number;
  maxTokens: number;
} {
  const responder = self.settings.fastResponder;
  const service = self.getServiceModelSelection();
  const modelId = responder?.model ?? service.modelId;
  const provider = responder?.provider ?? service.provider;
  const minContextTokens = parsePositiveIntegerSetting(responder?.minContextTokens, "fastResponder.minContextTokens");
  const timeoutMs = parsePositiveIntegerSetting(responder?.timeoutMs, "fastResponder.timeoutMs");
  const maxTokens = parsePositiveIntegerSetting(responder?.maxTokens, "fastResponder.maxTokens");
  return {
    enabled: responder?.enabled ?? true,
    provider,
    modelId,
    thinkingLevel: responder?.thinkingLevel ?? service.thinkingLevel,
    minContextTokens: minContextTokens ?? 1000,
    timeoutMs: timeoutMs ?? 2000,
    maxTokens: maxTokens ?? 120,
  };
}

export function do_setDefaultProvider(self: SettingsManager, provider: string): void {
  self.globalSettings.defaultProvider = provider;
  self.markModified("defaultProvider");
  self.save();
}

export function do_setDefaultModel(self: SettingsManager, modelId: string): void {
  self.globalSettings.defaultModel = modelId;
  self.markModified("defaultModel");
  self.save();
}

export function do_setDefaultModelAndProvider(self: SettingsManager, provider: string, modelId: string): void {
  self.globalSettings.defaultProvider = provider;
  self.globalSettings.defaultModel = modelId;
  self.markModified("defaultProvider");
  self.markModified("defaultModel");
  self.save();
}

export function do_setDefaultImageModelAndProvider(self: SettingsManager, provider: string, modelId: string): void {
  self.globalSettings.defaultImageProvider = provider;
  self.globalSettings.defaultImageModel = modelId;
  self.markModified("defaultImageProvider");
  self.markModified("defaultImageModel");
  self.save();
}

export function do_getSteeringMode(self: SettingsManager): "all" | "one-at-a-time" {
  return self.settings.steeringMode || "one-at-a-time";
}

export function do_setSteeringMode(self: SettingsManager, mode: "all" | "one-at-a-time"): void {
  self.globalSettings.steeringMode = mode;
  self.markModified("steeringMode");
  self.save();
}

export function do_getFollowUpMode(self: SettingsManager): "all" | "one-at-a-time" {
  return self.settings.followUpMode || "one-at-a-time";
}

export function do_setFollowUpMode(self: SettingsManager, mode: "all" | "one-at-a-time"): void {
  self.globalSettings.followUpMode = mode;
  self.markModified("followUpMode");
  self.save();
}

export function do_getCompletionMode(self: SettingsManager): CompletionMode {
  const mode = self.settings.completionMode;
  if (typeof mode === "string" && mode in COMPLETION_MODE_ALIASES) {
    return COMPLETION_MODE_ALIASES[mode as keyof typeof COMPLETION_MODE_ALIASES];
  }
  return "explicit_finish";
}

export function do_getCompletionLimits(self: SettingsManager): CompletionProtocolLimits | undefined {
  const limits = self.settings.completionLimits;
  if (!limits) {
    return undefined;
  }
  const parsed: CompletionProtocolLimits = {};
  const maxTurns = parsePositiveIntegerSetting(limits.maxTurns, "completionLimits.maxTurns");
  const maxNoProgressTurns = parsePositiveIntegerSetting(
    limits.maxNoProgressTurns,
    "completionLimits.maxNoProgressTurns",
  );
  const maxMalformedToolRetries = parsePositiveIntegerSetting(
    limits.maxMalformedToolRetries,
    "completionLimits.maxMalformedToolRetries",
  );
  const maxEmptyAssistantRetries = parsePositiveIntegerSetting(
    limits.maxEmptyAssistantRetries,
    "completionLimits.maxEmptyAssistantRetries",
  );
  const maxMissingFinishRetries = parsePositiveIntegerSetting(
    limits.maxMissingFinishRetries,
    "completionLimits.maxMissingFinishRetries",
  );
  if (maxTurns !== undefined) parsed.maxTurns = maxTurns;
  if (maxNoProgressTurns !== undefined) parsed.maxNoProgressTurns = maxNoProgressTurns;
  if (maxMalformedToolRetries !== undefined) parsed.maxMalformedToolRetries = maxMalformedToolRetries;
  if (maxEmptyAssistantRetries !== undefined) parsed.maxEmptyAssistantRetries = maxEmptyAssistantRetries;
  if (maxMissingFinishRetries !== undefined) parsed.maxMissingFinishRetries = maxMissingFinishRetries;
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function do_getTheme(self: SettingsManager): string | undefined {
  return self.settings.theme;
}

export function do_setTheme(self: SettingsManager, theme: string): void {
  self.globalSettings.theme = theme;
  self.markModified("theme");
  self.save();
}

export function do_getDefaultThinkingLevel(
  self: SettingsManager,
): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined {
  return self.settings.defaultThinkingLevel;
}

export function do_setDefaultThinkingLevel(
  self: SettingsManager,
  level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh",
): void {
  self.globalSettings.defaultThinkingLevel = level;
  self.markModified("defaultThinkingLevel");
  self.save();
}
