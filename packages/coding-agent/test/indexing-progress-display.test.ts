import { beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent, formatIndexingStatus } from "../src/modes/interactive/components/footer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function createFooterData(): ReadonlyFooterDataProvider {
	return {
		getGitBranch: () => null,
		getExtensionStatuses: () => new Map(),
		getPrefillProgress: () => undefined,
		getGenProgress: () => undefined,
		getQueuedProgress: () => undefined,
		getSendingProgress: () => undefined,
		getModelSwitchProgress: () => undefined,
		getLoadingProgress: () => undefined,
		getIndexingStatus: () => ({ decision: "unknown", indexed: false, serviceRunning: false }),
		getAvailableProviderCount: () => 1,
		onBranchChange: () => () => {},
		onProgressChange: () => () => {},
	};
}

function createSession(interactionMode: "normal" | "plan"): AgentSession {
	return {
		state: {
			model: undefined,
			thinkingLevel: "off",
		},
		interactionMode,
		sessionManager: {
			getEntries: () => [],
			getCwd: () => "/tmp/project",
			getSessionName: () => undefined,
		},
		modelRegistry: {
			isUsingOAuth: () => false,
		},
		getContextUsage: () => undefined,
	} as unknown as AgentSession;
}

describe("formatIndexingStatus", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("shows percentage for queued state with progress", () => {
		expect(
			formatIndexingStatus({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "queued",
				progress: { phase: "scanning", percent: 42 },
			}),
		).toContain("🔎 42%");
	});

	it("shows 0% for queued state with zero progress", () => {
		expect(
			formatIndexingStatus({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "queued",
				progress: { phase: "scanning", percent: 0 },
			}),
		).toContain("🔎 0%");
	});

	it("shows queued text when no progress is available", () => {
		expect(
			formatIndexingStatus({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "queued",
			}),
		).toBe("🔎 queued");
	});

	it("shows percentage for updating state with progress", () => {
		expect(
			formatIndexingStatus({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "updating",
				progress: { phase: "indexing", percent: 75 },
			}),
		).toContain("🔎 75%");
	});

	it("shows 0% for updating state with zero progress", () => {
		expect(
			formatIndexingStatus({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "updating",
				progress: { phase: "indexing", percent: 0 },
			}),
		).toContain("🔎 0%");
	});

	it("shows init text when initializing without progress", () => {
		expect(
			formatIndexingStatus({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "initializing",
			}),
		).toBe("🔎 init");
	});

	it("shows percentage for initializing state with progress", () => {
		expect(
			formatIndexingStatus({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "initializing",
				progress: { phase: "scanning", percent: 12 },
			}),
		).toContain("🔎 12%");
	});

	it("shows OFF when indexing is disabled", () => {
		expect(
			formatIndexingStatus({
				decision: "disabled",
				indexed: false,
				serviceRunning: false,
			}),
		).toBe("🔎 OFF");
	});

	it("shows ready state with checkmark", () => {
		expect(
			formatIndexingStatus({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "ready",
			}),
		).toContain("✅");
	});

	it("shows ON when service is not running", () => {
		expect(
			formatIndexingStatus({
				decision: "enabled",
				indexed: true,
				serviceRunning: false,
				ragState: "queued",
			}),
		).toBe("🔎 ON!");
	});

	it("shows ETA when startedAt is provided and percent > 0", () => {
		const startedAt = new Date(Date.now() - 30_000).toISOString();
		expect(
			formatIndexingStatus({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "updating",
				progress: { phase: "indexing", percent: 50, startedAt },
			}),
		).toMatch(/🔎 50%\s+\(ETA: 30s\)/);
	});

	it("shows decimal minutes ETA for longer runs", () => {
		const startedAt = new Date(Date.now() - 120_000).toISOString();
		expect(
			formatIndexingStatus({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "updating",
				progress: { phase: "indexing", percent: 20, startedAt },
			}),
		).toMatch(/🔎 20%\s+\(ETA: 8\.0m\)/);
	});

	it("shows decimal minutes with fractional part", () => {
		const startedAt = new Date(Date.now() - 125_000).toISOString();
		expect(
			formatIndexingStatus({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "updating",
				progress: { phase: "indexing", percent: 20, startedAt },
			}),
		).toMatch(/🔎 20%\s+\(ETA: 8\.3m\)/);
	});

	it("omits ETA when percent is 0", () => {
		const startedAt = new Date(Date.now() - 10_000).toISOString();
		expect(
			formatIndexingStatus({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "updating",
				progress: { phase: "indexing", percent: 0, startedAt },
			}),
		).toBe("🔎 0%");
	});

	it("omits ETA when startedAt is not provided", () => {
		expect(
			formatIndexingStatus({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "updating",
				progress: { phase: "indexing", percent: 50 },
			}),
		).toBe("🔎 50%");
	});

	it("omits ETA when eta exceeds 1 hour", () => {
		const startedAt = new Date(Date.now() - 120_000).toISOString();
		expect(
			formatIndexingStatus({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "updating",
				progress: { phase: "indexing", percent: 1, startedAt },
			}),
		).toBe("🔎 1%");
	});

	it("uses explicit etaSeconds from progress when present", () => {
		expect(
			formatIndexingStatus({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "updating",
				progress: { phase: "indexing", percent: 50, etaSeconds: 90 },
			}),
		).toBe("🔎 50% (ETA: 90s)");
	});
});

describe("FooterComponent indexing progress display", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("renders 0% for queued indexing with progress available", () => {
		const footer = new FooterComponent(createSession("normal"), {
			...createFooterData(),
			getIndexingStatus: () => ({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "queued",
				progress: { phase: "scanning", percent: 0 },
			}),
		});

		expect(footer.render(100).join("\n")).toContain("🔎 0%");
	});

	it("renders percentage for updating indexing in progress", () => {
		const footer = new FooterComponent(createSession("normal"), {
			...createFooterData(),
			getIndexingStatus: () => ({
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "updating",
				progress: { phase: "indexing", percent: 42 },
			}),
		});

		expect(footer.render(100).join("\n")).toContain("🔎 42%");
	});
});
