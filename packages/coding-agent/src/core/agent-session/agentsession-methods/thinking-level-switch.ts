import type { ThinkingLevel } from "@dst0/p-agent-core";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@dst0/p-ai";
import {
  createLiveStructuredSessionState,
  getLatestStructuredSessionState,
  renderStructuredSessionCheckpoint,
  STRUCTURED_SESSION_STATE_CUSTOM_TYPE,
  type StructuredSessionState,
} from "../../compaction/index.ts";
import { DEFAULT_THINKING_LEVEL } from "../../defaults.ts";
import { createProjectMemoryContext, updateProjectMemorySnapshot } from "../../project-memory.ts";
import type { SessionEntry } from "../../session-manager.ts";
import { getLatestCompactionEntry } from "../../session-manager.ts";
import type { AgentSession } from "../agentsession.ts";
import { THINKING_LEVELS } from "../constants.ts";
import { normalizeCompactionDetails } from "../message-utils.ts";
import type { SessionStateSnapshot } from "../session-types.ts";

export function do_setThinkingLevel(self: AgentSession, level: ThinkingLevel): void {
  const availableLevels = self.getAvailableThinkingLevels();
  const effectiveLevel = availableLevels.includes(level) ? level : self._clampThinkingLevel(level, availableLevels);

  // Only persist if actually changing
  const previousLevel = self.agent.state.thinkingLevel;
  const isChanging = effectiveLevel !== previousLevel;

  self.agent.state.thinkingLevel = effectiveLevel;

  if (isChanging) {
    self.sessionManager.appendThinkingLevelChange(effectiveLevel);
    if (self.supportsThinking() || effectiveLevel !== "off") {
      self.settingsManager.setDefaultThinkingLevel(effectiveLevel);
    }
    self._emit({ type: "thinking_level_changed", level: effectiveLevel });
    void self._extensionRunner.emit({
      type: "thinking_level_select",
      level: effectiveLevel,
      previousLevel,
    });
  }
}

export function do_cycleThinkingLevel(self: AgentSession): ThinkingLevel | undefined {
  if (!self.supportsThinking()) return undefined;

  const levels = self.getAvailableThinkingLevels();
  const currentIndex = levels.indexOf(self.thinkingLevel);
  const nextIndex = (currentIndex + 1) % levels.length;
  const nextLevel = levels[nextIndex];

  self.setThinkingLevel(nextLevel);
  return nextLevel;
}

export function do_getAvailableThinkingLevels(self: AgentSession): ThinkingLevel[] {
  if (!self.model) return THINKING_LEVELS;
  return getSupportedThinkingLevels(self.model) as ThinkingLevel[];
}

export function do_supportsThinking(self: AgentSession): boolean {
  return !!self.model?.reasoning;
}

export function do__getThinkingLevelForModelSwitch(self: AgentSession, explicitLevel?: ThinkingLevel): ThinkingLevel {
  if (explicitLevel !== undefined) {
    return explicitLevel;
  }
  if (!self.supportsThinking()) {
    return self.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
  }
  return self.thinkingLevel;
}

export function do__clampThinkingLevel(
  self: AgentSession,
  level: ThinkingLevel,
  _availableLevels: ThinkingLevel[],
): ThinkingLevel {
  return self.model ? (clampThinkingLevel(self.model, level) as ThinkingLevel) : "off";
}

export function do_syncQueueModesFromSettings(self: AgentSession): void {
  self.agent.steeringMode = self.settingsManager.getSteeringMode();
  self.agent.followUpMode = self.settingsManager.getFollowUpMode();
}

export function do_setSteeringMode(self: AgentSession, mode: "all" | "one-at-a-time"): void {
  self.agent.steeringMode = mode;
  self.settingsManager.setSteeringMode(mode);
}

export function do_setFollowUpMode(self: AgentSession, mode: "all" | "one-at-a-time"): void {
  self.agent.followUpMode = mode;
  self.settingsManager.setFollowUpMode(mode);
}

export function do_getSessionStateSnapshot(self: AgentSession): SessionStateSnapshot {
  const branchEntries = self.sessionManager.getBranch();
  const state = self._getCurrentStructuredSessionState(branchEntries);
  const settings = self._getEffectiveCompactionSettings();
  const checkpoint = renderStructuredSessionCheckpoint(state, settings.renderedStateMaxTokens);
  const latestCompaction = getLatestCompactionEntry(branchEntries);
  const details = latestCompaction ? normalizeCompactionDetails(latestCompaction.details) : undefined;
  return {
    sessionId: self.sessionManager.getSessionId(),
    checkpoint,
    state,
    contextUsage: self.getContextUsage(),
    lastCompaction: latestCompaction
      ? {
          id: latestCompaction.id,
          timestamp: latestCompaction.timestamp,
          audit: details?.audit,
        }
      : undefined,
  };
}

export function do__getCurrentStructuredSessionState(
  self: AgentSession,
  branchEntries = self.sessionManager.getBranch(),
): StructuredSessionState {
  const previous = getLatestStructuredSessionState(branchEntries);
  const fallbackEntries = self._getLiveStateFallbackEntries(branchEntries);
  if (previous && fallbackEntries.length === 0) {
    return previous;
  }
  return self._createLiveStructuredSessionState(fallbackEntries.length > 0 ? fallbackEntries : branchEntries, previous);
}

export function do__getLiveStateFallbackEntries(_self: AgentSession, branchEntries: SessionEntry[]): SessionEntry[] {
  for (let index = branchEntries.length - 1; index >= 0; index--) {
    const entry = branchEntries[index];
    if (entry.type === "custom" && entry.customType === STRUCTURED_SESSION_STATE_CUSTOM_TYPE) {
      return branchEntries.slice(index + 1);
    }
  }
  return branchEntries;
}

export function do__createLiveStructuredSessionState(
  self: AgentSession,
  branchEntries: SessionEntry[],
  previous?: StructuredSessionState,
): StructuredSessionState {
  return createLiveStructuredSessionState({
    sessionId: self.sessionManager.getSessionId(),
    previous,
    entries: branchEntries,
    timestamp: new Date().toISOString(),
  });
}

export function do__syncProjectMemory(self: AgentSession): void {
  try {
    const snapshot = self.getSessionStateSnapshot();
    updateProjectMemorySnapshot({
      cwd: self._cwd,
      sessionId: snapshot.sessionId,
      checkpoint: snapshot.checkpoint,
      state: snapshot.state,
      contextUsage: snapshot.contextUsage,
    });
  } catch {
    // Project memory is a durability aid; prompt execution must not fail because the workspace is read-only.
  }
}

export function do__createProjectMemoryPrompt(self: AgentSession, query: string): string | undefined {
  const context = createProjectMemoryContext(self._cwd, query);
  return context?.content;
}
