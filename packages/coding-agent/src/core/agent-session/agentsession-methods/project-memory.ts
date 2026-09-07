import type { AgentMessage } from "@dst0/p-agent-core";
import { estimateContextTokens } from "../../compaction/index.ts";
import { type ConstraintPhase, evaluateGuardrails, type GuardrailReport } from "../../guardrails.ts";
import {
  forgetProjectMemory,
  initProjectMemory,
  type ProjectMemoryForgetResult,
  type ProjectMemoryInitResult,
  type ProjectMemoryPinResult,
  type ProjectMemorySearchResult,
  pinProjectMemory,
  searchProjectMemory,
} from "../../project-memory.ts";
import {
  explainProjectRules,
  lintProjectRules,
  type RuleExplainResult,
  type RuleLintResult,
} from "../../project-rules.ts";
import { type RepoMap, updateRepoMap } from "../../repo-map.ts";
import { persistSubagentDigest, type SubagentDigest, type SubagentName } from "../../subagents.ts";
import { createTokenBreakdown, type TokenBreakdown } from "../../token-accounting.ts";
import type { AgentSession } from "../agentsession.ts";
import { estimateToolResultTokens } from "../message-utils.ts";
import { filterProjectInstructionHistory } from "../project-instruction-integrity.ts";
import type { PromptContextPreparation } from "../state-types.ts";

export function do__preparePromptContext(
  self: AgentSession,
  messages: AgentMessage[],
  systemPrompt = self.systemPrompt,
  options: { recordWorkingState?: boolean } = {},
): PromptContextPreparation {
  const compatibleMessages = filterProjectInstructionHistory(messages, self._projectInstructionMode);
  const settings = self._getEffectiveCompactionSettings();
  const latestCompactionTimestamp = self._getLatestCompactionTimestamp();
  if (!settings.enabled) {
    const estimate = estimateContextTokens(compatibleMessages, systemPrompt, {
      sinceTimestamp: latestCompactionTimestamp,
    });
    return {
      messages: compatibleMessages,
      estimate,
      budgetEstimate: estimate,
      source: estimate.lastUsageIndex === null ? "estimated" : "provider_usage",
      toolRawTokens: estimateToolResultTokens(compatibleMessages),
    };
  }

  const initialEstimate = estimateContextTokens(compatibleMessages, systemPrompt, { useProviderUsage: false });
  const pressureEstimate = initialEstimate;
  const preparedMessages = self._withWorkingStatePromptInsertions(
    compatibleMessages,
    self._lastRuntimePromptComponents.workingStatePrompt,
    { ...options, minimumAnchorTimestamp: latestCompactionTimestamp },
  );

  const finalEstimate = estimateContextTokens(preparedMessages, systemPrompt, { useProviderUsage: false });
  return {
    messages: preparedMessages,
    estimate: finalEstimate,
    budgetEstimate: pressureEstimate,
    source: "estimated",
    toolRawTokens: estimateToolResultTokens(preparedMessages),
  };
}

export function do__createTokenBreakdownForPrompt(
  self: AgentSession,
  messages: AgentMessage[],
  options: {
    totalOverride?: number;
    source?: "provider_usage" | "estimated";
    toolRawTokens?: number;
  } = {},
): TokenBreakdown {
  const components = self._lastRuntimePromptComponents;
  return createTokenBreakdown({
    source: options.source ?? "estimated",
    systemPrompt: components.baseSystemPrompt ?? self.systemPrompt,
    toolsPrompt: self._createToolPromptAccountingText(),
    memoryPrompt: components.memoryPrompt,
    rulesPrompt: components.rulesPrompt,
    repoMapPrompt: components.repoMapPrompt,
    checkpoint: [components.stateProtocolPrompt, components.workingStatePrompt]
      .filter((prompt): prompt is string => prompt !== undefined && prompt.length > 0)
      .join("\n\n"),
    retrievedPrompt: [components.subagentProfilesPrompt, components.subagentDigestPrompt]
      .filter((prompt): prompt is string => prompt !== undefined && prompt.length > 0)
      .join("\n\n"),
    recentMessages: messages,
    toolRawTokens: options.toolRawTokens,
    totalOverride: options.totalOverride,
  });
}

export function do_initProjectMemory(self: AgentSession): ProjectMemoryInitResult {
  return initProjectMemory(self._cwd);
}

export function do_searchProjectMemory(self: AgentSession, query: string): ProjectMemorySearchResult {
  return searchProjectMemory(self._cwd, query);
}

export function do_pinProjectMemory(self: AgentSession, text: string): ProjectMemoryPinResult {
  return pinProjectMemory(self._cwd, text);
}

export function do_forgetProjectMemory(self: AgentSession, id: string): ProjectMemoryForgetResult {
  return forgetProjectMemory(self._cwd, id);
}

export function do_lintProjectRules(self: AgentSession): RuleLintResult {
  return lintProjectRules(self._cwd);
}

export function do_explainProjectRules(self: AgentSession, query: string): RuleExplainResult {
  return explainProjectRules(self._cwd, query);
}

export function do_updateRepoMap(self: AgentSession): RepoMap {
  return updateRepoMap(self._cwd);
}

export function do_recordSubagentDigest(
  self: AgentSession,
  profile: SubagentName,
  query: string,
  summary: string,
  evidencePointers: string[] = [],
): SubagentDigest {
  const target = {
    sessionDir: self.sessionManager.getSessionDir(),
    sessionId: self.sessionManager.getSessionId(),
    isPersisted: self.sessionManager.isPersisted(),
  };
  return persistSubagentDigest(target, {
    profile,
    query,
    summary,
    evidencePointers,
    sessionId: self.sessionManager.getSessionId(),
    parentEntryId: self.sessionManager.getLeafId(),
  });
}

export function do_evaluateGuardrails(self: AgentSession, phase: ConstraintPhase = "final"): GuardrailReport {
  return evaluateGuardrails({
    cwd: self._cwd,
    phase,
    recentCommands: self._recentBashCommands,
  });
}
