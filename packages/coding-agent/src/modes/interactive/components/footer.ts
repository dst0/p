import { isAbsolute, relative, resolve, sep } from "node:path";
import { type Component, truncateToWidth, visibleWidth } from "@dst0/p-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { theme } from "../theme/theme.ts";

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	// Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Format token counts for compact footer display.
 */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/**
 * Render a compact visual progress bar.
 * Uses block characters for filled/empty portions.
 */
function renderProgressBar(percent: number, barWidth: number): string {
	const filled = Math.round((percent / 100) * barWidth);
	const clampedFilled = Math.max(0, Math.min(barWidth, filled));
	const empty = barWidth - clampedFilled;
	return "▓".repeat(clampedFilled) + "░".repeat(empty);
}

/**
 * Compute a trend indicator for generation speed.
 * Returns ↑ if speed increased, ↓ if decreased, → if stable, or ▸ for first reading.
 */
function computeGenTrend(currentRate: number, previousRate: number | undefined): string {
	if (previousRate === undefined) return "▸";
	const diff = currentRate - previousRate;
	if (diff > 5) return "↑";
	if (diff < -5) return "↓";
	return "→";
}

function formatQueuedProgress(queued: { messages: number; position?: number; queuedAhead?: number }): string {
	if (queued.position !== undefined) {
		if (queued.position <= 1) {
			return "next";
		}
		const queuedAhead = queued.queuedAhead ?? queued.position - 1;
		const aheadText = queuedAhead === 1 ? "1 ahead" : `${queuedAhead} ahead`;
		return `#${queued.position}, ${aheadText}`;
	}
	return queued.messages.toString();
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
	private autoCompactEnabled = true;
	private showTokenProgress = true;
	private showTokenStats = true;
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

	/**
	 * No-op: git branch caching now handled by provider.
	 * Kept for compatibility with existing call sites in interactive-mode.
	 */
	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

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

		// Build stats line
		const statsParts = [];
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
				statsParts.push(theme.fg("accent", `${theme.bold("QUEUED")} ${formatQueuedProgress(queued)}`));
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

		let statsLeft = statsParts.join(" ");

		// Add model name on the right side, plus thinking level if model supports it
		const modelName = state.model?.id || "no-model";

		let statsLeftWidth = visibleWidth(statsLeft);

		// If statsLeft is too wide, truncate it
		if (statsLeftWidth > width) {
			statsLeft = truncateToWidth(statsLeft, width, "...");
			statsLeftWidth = visibleWidth(statsLeft);
		}

		// Calculate available space for padding (minimum 2 spaces between stats and model)
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
		if (this.footerData.getAvailableProviderCount() > 1 && state.model) {
			rightSide = `(${state.model!.provider}) ${rightSideWithoutProvider}`;
			if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width) {
				// Too wide, fall back
				rightSide = rightSideWithoutProvider;
			}
		}

		const rightSideWidth = visibleWidth(rightSide);
		const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

		let statsLine: string;
		if (totalNeeded <= width) {
			// Both fit - add padding to right-align model
			const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
			statsLine = statsLeft + padding + rightSide;
		} else {
			// Need to truncate right side
			const availableForRight = width - statsLeftWidth - minPadding;
			if (availableForRight > 0) {
				const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
				const truncatedRightWidth = visibleWidth(truncatedRight);
				const padding = " ".repeat(Math.max(0, width - statsLeftWidth - truncatedRightWidth));
				statsLine = statsLeft + padding + truncatedRight;
			} else {
				// Not enough space for right side at all
				statsLine = statsLeft;
			}
		}

		// Apply dim to each part separately. statsLeft may contain color codes (for context %)
		// that end with a reset, which would clear an outer dim wrapper. So we dim the parts
		// before and after the colored section independently.
		const dimStatsLeft = theme.fg("dim", statsLeft);
		const remainder = statsLine.slice(statsLeft.length); // padding + rightSide
		const dimRemainder = theme.fg("dim", remainder);

		const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));
		const lines = [pwdLine, dimStatsLeft + dimRemainder];

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
