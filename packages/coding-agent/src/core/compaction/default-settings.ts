export const DEFAULT_COMPACTION_SETTINGS = {
	enabled: true,
	triggerReserveTokens: 2000,
	triggerRatio: 1.0,
	keepRecentMinTokens: 2000,
	keepRecentMaxTokens: 8000,
	summaryMaxTokens: 1200,
	renderedStateMaxTokens: 1500,
	targetContextTokens: 12000,
	toolResultClearThresholdTokens: 24000,
	toolResultKeepRecentCount: 3,
	toolResultPromptBudgetTokens: 8000,
} as const;
