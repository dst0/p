import { type Component, truncateToWidth, visibleWidth } from "@dst0/p-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { theme } from "../theme/theme.ts";
import { formatEta, formatIndexingStatus, formatTokens } from "./footer-indexing-status.ts";
import {
  computeGenTrend,
  formatCwdForFooter,
  formatQueuedProgress,
  formatQueuedSpinner,
  QUEUED_FOOTER_ANIMATION_MS,
  renderProgressBar,
  sanitizeStatusText,
} from "./footer-progress.ts";

export { formatCwdForFooter, formatEta, formatIndexingStatus, formatTokens, QUEUED_FOOTER_ANIMATION_MS };

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
  private autoCompactEnabled = true;
  private showTokenProgress = true;
  private showTokenStats = true;
  private showIndexingInfo = true;
  private showVersion = false;
  private version: string | undefined;
  private session: AgentSession;
  private footerData: ReadonlyFooterDataProvider;
  private lastGenRate: number | undefined;

  constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider) {
    this.session = session;
    this.footerData = footerData;
  }

  setSession(session: AgentSession): void {
    this.session = session;
  }

  setAutoCompactEnabled(enabled: boolean): void {
    this.autoCompactEnabled = enabled;
  }

  setShowTokenProgress(enabled: boolean): void {
    this.showTokenProgress = enabled;
  }

  setShowTokenStats(enabled: boolean): void {
    this.showTokenStats = enabled;
  }

  setShowIndexingInfo(enabled: boolean): void {
    this.showIndexingInfo = enabled;
  }

  setShowVersion(enabled: boolean, version: string | undefined): void {
    this.showVersion = enabled;
    this.version = version;
  }

  invalidate(): void {}

  dispose(): void {}

  render(width: number): string[] {
    const state = this.session.state;

    // Calculate cumulative usage from ALL session entries (not just post-compaction messages)
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;
    let latestCacheHitRate: number | undefined;

    for (const entry of this.session.sessionManager.getEntries()) {
      if (entry.type === "message" && entry.message.role === "assistant") {
        totalInput += entry.message.usage.input;
        totalOutput += entry.message.usage.output;
        totalCacheRead += entry.message.usage.cacheRead;
        totalCacheWrite += entry.message.usage.cacheWrite;
        totalCost += entry.message.usage.cost.total;

        const latestPromptTokens =
          entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite;
        latestCacheHitRate =
          latestPromptTokens > 0 ? (entry.message.usage.cacheRead / latestPromptTokens) * 100 : undefined;
      }
    }

    // Calculate context usage from session (handles compaction correctly).
    // After compaction, tokens are unknown until the next LLM response.
    const contextUsage = this.session.getContextUsage();
    const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
    const contextPercentValue = contextUsage?.percent ?? 0;
    const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

    // Replace home directory with ~
    let pwd = formatCwdForFooter(this.session.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);

    // Add git branch if available
    const branch = this.footerData.getGitBranch();
    if (branch) {
      pwd = `${pwd} (${branch})`;
    }

    // Add session name if set
    const sessionName = this.session.sessionManager.getSessionName();
    if (sessionName) {
      pwd = `${pwd} • ${sessionName}`;
    }

    if (this.showVersion && this.version) {
      pwd = `v${this.version} ${pwd}`;
    }

    // Build stats line
    const statsParts: string[] = [];
    if (this.showIndexingInfo) statsParts.push(formatIndexingStatus(this.footerData.getIndexingStatus()));
    if (this.showTokenStats) {
      if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
      if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
      if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
      if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);
      if ((totalCacheRead > 0 || totalCacheWrite > 0) && latestCacheHitRate !== undefined) {
        statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
      }
    }

    // Show cost with "(sub)" indicator if using OAuth subscription
    const usingSubscription = state.model ? this.session.modelRegistry.isUsingOAuth(state.model) : false;
    if (totalCost || usingSubscription) {
      const costStr = `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
      statsParts.push(costStr);
    }

    // Colorize context percentage based on usage
    let contextPercentStr: string;
    const autoIndicator = this.autoCompactEnabled ? " (auto)" : "";

    const staticTokensValue = contextUsage?.staticTokens ?? 0;
    const staticCtxDisplay = staticTokensValue > 0 ? `${(staticTokensValue / 1000).toFixed(1)}K|` : "";

    const contextPercentDisplay =
      contextPercent === "?"
        ? `${staticCtxDisplay}?/${formatTokens(contextWindow)}${autoIndicator}`
        : `${staticCtxDisplay}${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
    if (contextPercentValue > 90) {
      contextPercentStr = theme.fg("error", contextPercentDisplay);
    } else if (contextPercentValue > 70) {
      contextPercentStr = theme.fg("warning", contextPercentDisplay);
    } else {
      contextPercentStr = contextPercentDisplay;
    }
    statsParts.push(contextPercentStr);

    if (this.session.interactionMode === "plan") {
      statsParts.push(theme.fg("accent", theme.bold("PLAN")));
    }

    if (this.showTokenProgress) {
      const queued = this.footerData.getQueuedProgress();
      const sending = this.footerData.getSendingProgress();
      const prefill = this.footerData.getPrefillProgress();
      const gen = this.footerData.getGenProgress();
      if (prefill) {
        const percent = Math.max(0, Math.min(100, Math.round(prefill.percent)));
        const rate =
          prefill.tokensPerSecond === undefined ? "" : ` ${Math.max(0, Math.round(prefill.tokensPerSecond))} t/s`;
        // Adaptive bar width: estimate available space from terminal width minus known stats
        const estimatedUsed = visibleWidth(`${statsParts.join(" ")} PREFILL ▓▓▓▓▓▓▓▓▓▓ 100% 9999 t/s `);
        const availableBarSpace = Math.max(0, width - estimatedUsed);
        const barWidth = Math.max(8, Math.min(24, availableBarSpace));
        const bar = renderProgressBar(percent, barWidth);
        statsParts.push(theme.fg("accent", `${theme.bold("PREFILL")} ${bar} ${percent}%${rate}`));
        this.lastGenRate = undefined;
      } else if (gen) {
        const trend = computeGenTrend(gen.tokensPerSecond, this.lastGenRate);
        statsParts.push(
          theme.fg(
            "accent",
            `${theme.bold("GEN")} ${trend} ${formatTokens(gen.tokens)} tok ${gen.tokensPerSecond.toFixed(0)} t/s`,
          ),
        );
        this.lastGenRate = gen.tokensPerSecond;
      }
      if (!prefill && !gen && queued) {
        statsParts.push(
          theme.fg("accent", `${theme.bold("QUEUED")} ${formatQueuedSpinner()} ${formatQueuedProgress(queued)}`),
        );
      }
      if (!prefill && !gen && !queued && sending) {
        statsParts.push(theme.fg("accent", `${theme.bold("SENDING")} ${sending.model}`));
      }
      const modelSwitch = this.footerData.getModelSwitchProgress();
      if (modelSwitch) {
        statsParts.push(
          theme.fg("warning", `${theme.bold("SWITCHING")} ${modelSwitch.fromModel} → ${modelSwitch.toModel}`),
        );
      }
      const loading = this.footerData.getLoadingProgress();
      if (loading) {
        statsParts.push(theme.fg("warning", `${theme.bold("LOADING")} ${loading.model}`));
      }
    }

    let statsLeft = statsParts.join(" ");

    // Add model name on the right side, plus thinking level if model supports it
    const sendingModel = this.footerData.getSendingProgress()?.model;
    const loadingModel = this.footerData.getLoadingProgress()?.model;
    const switchModel = this.footerData.getModelSwitchProgress()?.toModel;
    const fallbackProgressModel = sendingModel || loadingModel || switchModel;

    const modelName = state.model?.id || fallbackProgressModel || "no-model";

    const minPadding = 2;

    // Add thinking level indicator if model supports reasoning
    let rightSideWithoutProvider = modelName;
    if (state.model?.reasoning) {
      const thinkingLevel = state.thinkingLevel || "off";
      rightSideWithoutProvider =
        thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
    }

    // Prepend the provider in parentheses if there are multiple providers and there's enough room
    let rightSide = rightSideWithoutProvider;
    if (this.footerData.getAvailableProviderCount() > 1 && (state.model || fallbackProgressModel)) {
      const provider = state.model?.provider;
      const withProvider = provider ? `(${provider}) ${rightSideWithoutProvider}` : rightSideWithoutProvider;
      if (visibleWidth(statsLeft) + minPadding + visibleWidth(withProvider) <= width) {
        rightSide = withProvider;
      }
    }

    let rightSideWidth = visibleWidth(rightSide);
    if (rightSideWidth > width) {
      rightSide = truncateToWidth(rightSide, width, "");
      rightSideWidth = visibleWidth(rightSide);
    }

    // Prioritize model name visibility on the right side over statsLeft length
    let statsLeftWidth = visibleWidth(statsLeft);
    const maxAvailableForLeft = width - rightSideWidth - minPadding;

    let paddingStr = "";
    if (maxAvailableForLeft > 0) {
      if (statsLeftWidth > maxAvailableForLeft) {
        statsLeft = truncateToWidth(statsLeft, maxAvailableForLeft, "...");
        statsLeftWidth = visibleWidth(statsLeft);
      }
      paddingStr = " ".repeat(Math.max(0, width - statsLeftWidth - rightSideWidth));
    } else {
      // Extremely narrow terminal: prioritize showing model name right-aligned
      paddingStr = " ".repeat(Math.max(0, width - rightSideWidth));
      statsLeft = "";
      statsLeftWidth = 0;
    }

    const dimStatsLeft = theme.fg("dim", statsLeft);
    const formattedRightSide = theme.fg("muted", rightSide);

    const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));
    const lines = [pwdLine, dimStatsLeft + paddingStr + formattedRightSide];

    // Add extension statuses on a single line, sorted by key alphabetically
    const extensionStatuses = this.footerData.getExtensionStatuses();
    if (extensionStatuses.size > 0) {
      const sortedStatuses = Array.from(extensionStatuses.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, text]) => sanitizeStatusText(text));
      const statusLine = sortedStatuses.join(" ");
      // Truncate to terminal width with dim ellipsis for consistency with footer style
      lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
    }

    return lines;
  }
}
