import { DEFAULT_COMPACTION_SETTINGS } from "../../compaction/default-settings.ts";
import { DEFAULT_HTTP_IDLE_TIMEOUT_MS } from "../../http-dispatcher.ts";
import { DEFAULT_AGENT_RETRY_BASE_DELAY_MS } from "../constants.ts";
import { parseTimeoutSetting } from "../helpers.ts";
import type { SettingsManager } from "../settingsmanager.ts";
import type { TransportSetting } from "../types-part1.ts";

export function do_getTransport(self: SettingsManager): TransportSetting {
  return self.settings.transport ?? "auto";
}

export function do_setTransport(self: SettingsManager, transport: TransportSetting): void {
  self.globalSettings.transport = transport;
  self.markModified("transport");
  self.save();
}

export function do_getCompactionEnabled(self: SettingsManager): boolean {
  return self.settings.compaction?.enabled ?? DEFAULT_COMPACTION_SETTINGS.enabled;
}

export function do_isToolResultContextExtractionEnabled(self: SettingsManager): boolean {
  return self.settings.enableToolResultContextExtraction ?? false;
}

export function do_setToolResultContextExtractionEnabled(self: SettingsManager, enabled: boolean): void {
  self.globalSettings.enableToolResultContextExtraction = enabled;
  self.markModified("enableToolResultContextExtraction", String(enabled));
}

export function do_setCompactionEnabled(self: SettingsManager, enabled: boolean): void {
  if (!self.globalSettings.compaction) {
    self.globalSettings.compaction = {};
  }
  self.globalSettings.compaction.enabled = enabled;
  self.markModified("compaction", "enabled");
  self.save();
}

export function do_getCompactionReserveTokens(self: SettingsManager): number {
  return self.getCompactionTriggerReserveTokens();
}

export function do_getCompactionKeepRecentTokens(self: SettingsManager): number {
  return self.getCompactionKeepRecentMaxTokens();
}

export function do_getCompactionTargetContextTokens(self: SettingsManager): number {
  return self.settings.compaction?.targetContextTokens ?? DEFAULT_COMPACTION_SETTINGS.targetContextTokens;
}

export function do_getCompactionTriggerReserveTokens(self: SettingsManager): number {
  return (
    self.settings.compaction?.triggerReserveTokens ??
    self.settings.compaction?.reserveTokens ??
    DEFAULT_COMPACTION_SETTINGS.triggerReserveTokens
  );
}

export function do_getCompactionTriggerRatio(self: SettingsManager): number | undefined {
  if (self.settings.compaction?.triggerRatio !== undefined) {
    return self.settings.compaction.triggerRatio;
  }
  if (
    self.settings.compaction?.triggerReserveTokens === undefined &&
    self.settings.compaction?.reserveTokens !== undefined
  ) {
    return undefined;
  }
  return DEFAULT_COMPACTION_SETTINGS.triggerRatio;
}

export function do_getCompactionKeepRecentMinTokens(self: SettingsManager): number {
  return (
    self.settings.compaction?.keepRecentMinTokens ??
    self.settings.compaction?.keepRecentTokens ??
    DEFAULT_COMPACTION_SETTINGS.keepRecentMinTokens
  );
}

export function do_getCompactionKeepRecentMaxTokens(self: SettingsManager): number {
  return (
    self.settings.compaction?.keepRecentMaxTokens ??
    self.settings.compaction?.keepRecentTokens ??
    DEFAULT_COMPACTION_SETTINGS.keepRecentMaxTokens
  );
}

export function do_getCompactionSummaryMaxTokens(self: SettingsManager): number {
  return self.settings.compaction?.summaryMaxTokens ?? DEFAULT_COMPACTION_SETTINGS.summaryMaxTokens;
}

export function do_getCompactionRenderedStateMaxTokens(self: SettingsManager): number {
  return self.settings.compaction?.renderedStateMaxTokens ?? DEFAULT_COMPACTION_SETTINGS.renderedStateMaxTokens;
}

export function do_getCompactionSettings(self: SettingsManager): {
  enabled: boolean;
  triggerReserveTokens: number;
  triggerRatio?: number;
  keepRecentMinTokens: number;
  keepRecentMaxTokens: number;
  summaryMaxTokens: number;
  renderedStateMaxTokens: number;
  targetContextTokens: number;
} {
  return {
    enabled: self.getCompactionEnabled(),
    triggerReserveTokens: self.getCompactionTriggerReserveTokens(),
    triggerRatio: self.getCompactionTriggerRatio(),
    keepRecentMinTokens: self.getCompactionKeepRecentMinTokens(),
    keepRecentMaxTokens: self.getCompactionKeepRecentMaxTokens(),
    summaryMaxTokens: self.getCompactionSummaryMaxTokens(),
    renderedStateMaxTokens: self.getCompactionRenderedStateMaxTokens(),
    targetContextTokens: self.getCompactionTargetContextTokens(),
  };
}

export function do_getBranchSummarySettings(self: SettingsManager): { reserveTokens: number; skipPrompt: boolean } {
  return {
    reserveTokens: self.settings.branchSummary?.reserveTokens ?? 16384,
    skipPrompt: self.settings.branchSummary?.skipPrompt ?? false,
  };
}

export function do_getBranchSummarySkipPrompt(self: SettingsManager): boolean {
  return self.settings.branchSummary?.skipPrompt ?? false;
}

export function do_getRetryEnabled(self: SettingsManager): boolean {
  return self.settings.retry?.enabled ?? true;
}

export function do_setRetryEnabled(self: SettingsManager, enabled: boolean): void {
  if (!self.globalSettings.retry) {
    self.globalSettings.retry = {};
  }
  self.globalSettings.retry.enabled = enabled;
  self.markModified("retry", "enabled");
  self.save();
}

export function do_getRetrySettings(self: SettingsManager): {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
} {
  return {
    enabled: self.getRetryEnabled(),
    maxRetries: self.settings.retry?.maxRetries ?? 3,
    baseDelayMs: self.settings.retry?.baseDelayMs ?? DEFAULT_AGENT_RETRY_BASE_DELAY_MS,
  };
}

export function do_getHttpIdleTimeoutMs(self: SettingsManager): number {
  return parseTimeoutSetting(self.settings.httpIdleTimeoutMs, "httpIdleTimeoutMs") ?? DEFAULT_HTTP_IDLE_TIMEOUT_MS;
}

export function do_setHttpIdleTimeoutMs(self: SettingsManager, timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error(`Invalid httpIdleTimeoutMs setting: ${String(timeoutMs)}`);
  }
  self.globalSettings.httpIdleTimeoutMs = Math.floor(timeoutMs);
  self.markModified("httpIdleTimeoutMs");
  self.save();
}

export function do_getProviderRetrySettings(self: SettingsManager): {
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryDelayMs: number;
} {
  return {
    timeoutMs: self.settings.retry?.provider?.timeoutMs,
    maxRetries: self.settings.retry?.provider?.maxRetries,
    maxRetryDelayMs: self.settings.retry?.provider?.maxRetryDelayMs ?? 60000,
  };
}

export function do_getWebSocketConnectTimeoutMs(self: SettingsManager): number | undefined {
  return parseTimeoutSetting(self.settings.websocketConnectTimeoutMs, "websocketConnectTimeoutMs");
}

export function do_getHideThinkingBlock(self: SettingsManager): boolean {
  return self.settings.hideThinkingBlock ?? false;
}
