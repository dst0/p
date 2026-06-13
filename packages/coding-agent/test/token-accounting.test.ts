import { describe, expect, it } from "vitest";
import { createTokenBreakdown, formatTokenBreakdown } from "../src/core/token-accounting.ts";

describe("token accounting", () => {
	it("reports prompt subsystems separately and labels estimates", () => {
		const breakdown = createTokenBreakdown({
			systemPrompt: "system ".repeat(20),
			toolsPrompt: "tool ".repeat(10),
			rulesPrompt: "rule ".repeat(8),
			memoryPrompt: "memory ".repeat(8),
			repoMapPrompt: "repo ".repeat(8),
			checkpoint: "checkpoint ".repeat(8),
			retrievedPrompt: "retrieved ".repeat(8),
			recentMessages: [{ role: "user", content: "hello", timestamp: 1 }],
			toolRawTokens: 1000,
			toolStubTokens: 50,
		});

		expect(breakdown.source).toBe("estimated");
		expect(breakdown.systemPrompt).toBeGreaterThan(0);
		expect(breakdown.tools).toBeGreaterThan(0);
		expect(breakdown.toolRaw).toBe(1000);
		expect(formatTokenBreakdown(breakdown)).toContain("repo_map:");
	});

	it("keeps provider totals authoritative when supplied", () => {
		const breakdown = createTokenBreakdown({
			source: "provider_usage",
			systemPrompt: "small",
			totalOverride: 42_000,
		});

		expect(breakdown.total).toBe(42_000);
		expect(breakdown.source).toBe("provider_usage");
	});
});
