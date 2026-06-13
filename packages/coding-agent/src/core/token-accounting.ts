import type { AgentMessage } from "@earendil-works/pi-agent-core";

export type TokenCountSource = "provider_usage" | "estimated";

export interface TokenBreakdown {
	source: TokenCountSource;
	total: number;
	systemPrompt: number;
	tools: number;
	rules: number;
	memory: number;
	repoMap: number;
	checkpoint: number;
	recentMessages: number;
	retrieved: number;
	toolRaw: number;
	toolStubs: number;
}

export interface TokenBreakdownInput {
	source?: TokenCountSource;
	systemPrompt?: string;
	toolsPrompt?: string;
	rulesPrompt?: string;
	memoryPrompt?: string;
	repoMapPrompt?: string;
	checkpoint?: string;
	recentMessages?: AgentMessage[];
	retrievedPrompt?: string;
	toolRawTokens?: number;
	toolStubTokens?: number;
	totalOverride?: number;
}

export function estimateTokenCount(text: string | undefined): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}

export function createTokenBreakdown(input: TokenBreakdownInput): TokenBreakdown {
	const systemPrompt = estimateTokenCount(input.systemPrompt);
	const tools = estimateTokenCount(input.toolsPrompt);
	const rules = estimateTokenCount(input.rulesPrompt);
	const memory = estimateTokenCount(input.memoryPrompt);
	const repoMap = estimateTokenCount(input.repoMapPrompt);
	const checkpoint = estimateTokenCount(input.checkpoint);
	const recentMessages = estimateMessages(input.recentMessages ?? []);
	const retrieved = estimateTokenCount(input.retrievedPrompt);
	const toolRaw = input.toolRawTokens ?? 0;
	const toolStubs = input.toolStubTokens ?? 0;
	const estimatedTotal = systemPrompt + tools + rules + memory + repoMap + checkpoint + recentMessages + retrieved;
	return {
		source: input.source ?? "estimated",
		total: input.totalOverride ?? estimatedTotal,
		systemPrompt,
		tools,
		rules,
		memory,
		repoMap,
		checkpoint,
		recentMessages,
		retrieved,
		toolRaw,
		toolStubs,
	};
}

export function formatTokenBreakdown(breakdown: TokenBreakdown): string {
	return [
		`source: ${breakdown.source}`,
		`total: ${breakdown.total}`,
		`system: ${breakdown.systemPrompt}`,
		`tools: ${breakdown.tools}`,
		`rules: ${breakdown.rules}`,
		`memory: ${breakdown.memory}`,
		`repo_map: ${breakdown.repoMap}`,
		`checkpoint: ${breakdown.checkpoint}`,
		`recent: ${breakdown.recentMessages}`,
		`retrieved: ${breakdown.retrieved}`,
		`tool_raw: ${breakdown.toolRaw}`,
		`tool_stubs: ${breakdown.toolStubs}`,
	].join("\n");
}

function estimateMessages(messages: AgentMessage[]): number {
	let total = 0;
	for (const message of messages) {
		total += estimateTokenCount(messageText(message));
	}
	return total;
}

function messageText(message: AgentMessage): string {
	switch (message.role) {
		case "user":
		case "custom":
			return typeof message.content === "string"
				? message.content
				: message.content
						.filter((part) => part.type === "text")
						.map((part) => part.text)
						.join("\n");
		case "assistant":
			return message.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n");
		case "toolResult":
			return message.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n");
		case "bashExecution":
			return `${message.command}\n${message.output}`;
		case "branchSummary":
		case "compactionSummary":
			return message.summary;
	}
}
