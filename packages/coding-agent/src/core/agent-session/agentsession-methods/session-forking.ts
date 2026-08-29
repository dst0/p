import type { AgentMessage } from "@dst0/p-agent-core";
import type { AssistantMessage } from "@dst0/p-ai";
import { getThemeByName, theme } from "../../../modes/interactive/theme/theme.ts";
import { createContextBudgetReport, estimateContextTokens } from "../../compaction/index.ts";
import { exportSessionToHtml, type ToolHtmlRenderer } from "../../export-html/index.ts";
import { createToolHtmlRenderer } from "../../export-html/tool-renderer.ts";
import type { ContextUsage } from "../../extensions/index.ts";
import { getLatestCompactionEntry } from "../../session-manager.ts";
import type { AgentSession } from "../agentsession.ts";
import { isInternalAgentMessage } from "../message-utils.ts";
import type { SessionStats } from "../session-types.ts";

export function do_getUserMessagesForForking(self: AgentSession): Array<{ entryId: string; text: string }> {
  const entries = self.sessionManager.getEntries();
  const result: Array<{ entryId: string; text: string }> = [];

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    if (entry.message.role !== "user" || isInternalAgentMessage(entry.message)) continue;

    const text = self._extractUserMessageText(entry.message.content);
    if (text) {
      result.push({ entryId: entry.id, text });
    }
  }

  return result;
}

export function do__extractUserMessageText(
  _self: AgentSession,
  content: string | Array<{ type: string; text?: string }>,
): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
  }
  return "";
}

export function do_getSessionStats(self: AgentSession): SessionStats {
  const messages = self.messages;
  const userMessages = messages.filter((m) => m.role === "user").length;
  const assistantMessages = messages.filter((m) => m.role === "assistant").length;
  const toolResults = messages.filter((m) => m.role === "toolResult").length;

  let toolCalls = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCost = 0;

  for (const message of messages) {
    if (message.role === "assistant") {
      const assistantMsg = message as AssistantMessage;
      toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
      totalInput += assistantMsg.usage.input;
      totalOutput += assistantMsg.usage.output;
      totalCacheRead += assistantMsg.usage.cacheRead;
      totalCacheWrite += assistantMsg.usage.cacheWrite;
      totalCost += assistantMsg.usage.cost.total;
    }
  }

  return {
    sessionFile: self.sessionFile,
    sessionId: self.sessionId,
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    totalMessages: messages.length,
    tokens: {
      input: totalInput,
      output: totalOutput,
      cacheRead: totalCacheRead,
      cacheWrite: totalCacheWrite,
      total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
    },
    cost: totalCost,
    contextUsage: self.getContextUsage(),
  };
}

export function do__getEffectiveCompactedMessages(self: AgentSession): AgentMessage[] {
  return self.agent.state.messages;
}

export function do__getLatestCompactionTimestamp(self: AgentSession): number | undefined {
  const compactionEntry = getLatestCompactionEntry(self.sessionManager.getBranch());
  return compactionEntry ? new Date(compactionEntry.timestamp).getTime() : undefined;
}

export function do_getContextUsage(self: AgentSession): ContextUsage | undefined {
  const model = self.model;
  if (!model) return undefined;

  const contextWindow = model.contextWindow ?? 0;
  if (contextWindow <= 0) return undefined;

  const settings = self.settingsManager.getCompactionSettings();
  const effectiveMessages = self._getEffectiveCompactedMessages();
  const promptContext = self._preparePromptContext(effectiveMessages);
  const providerEstimate = estimateContextTokens(promptContext.messages, self.systemPrompt, {
    sinceTimestamp: self._getLatestCompactionTimestamp(),
  });
  const estimate = providerEstimate.lastUsageIndex === null ? promptContext.budgetEstimate : providerEstimate;
  const source = providerEstimate.lastUsageIndex === null ? promptContext.source : "provider_usage";
  const budget = createContextBudgetReport(promptContext.budgetEstimate.tokens, contextWindow, settings);
  const contextTokens =
    estimate.lastUsageIndex === null
      ? Math.max(0, estimate.tokens - estimate.staticTokens)
      : estimate.usageTokens + estimate.trailingTokens;
  const percent = (contextTokens / contextWindow) * 100;
  const tokenBreakdown = self._createTokenBreakdownForPrompt(promptContext.messages, {
    source,
    totalOverride: estimate.tokens,
    toolRawTokens: promptContext.toolRawTokens,
  });
  self._lastTokenBreakdown = tokenBreakdown;

  return {
    tokens: contextTokens,
    contextWindow,
    percent,
    staticTokens: estimate.staticTokens,
    triggerThreshold: budget.triggerThreshold,
    triggerReserveTokens: budget.triggerReserveTokens,
    triggerRatio: budget.triggerRatio,
    targetContextTokens: budget.targetContextTokens,
    remainingTokens: budget.remainingTokens,
    shouldCompact: budget.shouldCompact,
    toolRawTokens: promptContext.toolRawTokens,
    tokenBreakdown,
  };
}

export async function do_exportToHtml(self: AgentSession, outputPath?: string): Promise<string> {
  const configuredThemeName = self.settingsManager.getTheme();
  const themeName = configuredThemeName && getThemeByName(configuredThemeName) ? configuredThemeName : undefined;

  // Create tool renderer if we have an extension runner (for custom tool HTML rendering)
  const toolRenderer: ToolHtmlRenderer = createToolHtmlRenderer({
    getToolDefinition: (name) => self.getToolDefinition(name),
    theme,
    cwd: self.sessionManager.getCwd(),
  });

  return await exportSessionToHtml(self.sessionManager, self.state, {
    outputPath,
    themeName,
    toolRenderer,
  });
}
