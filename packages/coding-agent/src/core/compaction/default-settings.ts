export const DEFAULT_COMPACTION_SETTINGS = {
	enabled: true,
	triggerReserveTokens: 2000,
	triggerRatio: 1.0,
	keepRecentMinTokens: 1200,
	keepRecentMaxTokens: 4000,
	summaryMaxTokens: 1200,
	renderedStateMaxTokens: 1000,
	targetContextTokens: 8000,
} as const;
