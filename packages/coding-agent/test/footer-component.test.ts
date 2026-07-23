import { beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent } from "../src/modes/interactive/components/footer.ts";
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

describe("FooterComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("renders a plan badge while plan mode is active", () => {
		const footer = new FooterComponent(createSession("plan"), createFooterData());

		expect(footer.render(100).join("\n")).toContain("PLAN");
	});

	it("does not render a plan badge in normal mode", () => {
		const footer = new FooterComponent(createSession("normal"), createFooterData());

		expect(footer.render(100).join("\n")).not.toContain("PLAN");
	});

	it("renders live repository indexing progress", () => {
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

		expect(footer.render(100).join("\n")).toContain("🔎 42.0%");
	});

	it("shows disabled indexing and can hide indexing information", () => {
		const footer = new FooterComponent(createSession("normal"), {
			...createFooterData(),
			getIndexingStatus: () => ({ decision: "disabled", indexed: false, serviceRunning: true }),
		});

		expect(footer.render(100).join("\n")).toContain("🔎 OFF");
		footer.setShowIndexingInfo(false);
		expect(footer.render(100).join("\n")).not.toContain("🔎");
	});

	it("renders QUEUED badge with elapsed seconds when queuedAt is set", () => {
		const queuedAt = Date.now() - 5500; // 5.5 seconds ago
		const footerData: ReadonlyFooterDataProvider = {
			...createFooterData(),
			getQueuedProgress: () => ({
				position: 2,
				queuedAhead: 1,
				queue: "worker",
				source: "llm-orchestrator",
				queuedAt,
			}),
		};
		const footer = new FooterComponent(createSession("normal"), footerData);

		const output = footer.render(200).join("\n");
		expect(output).toContain("QUEUED");
		expect(output).toMatch(/\d+s/); // elapsed seconds like "5s"
		const queuedLine = output.split("\n").find((line) => line.includes("QUEUED"));
		expect(queuedLine!).toContain("#2, 1 ahead");
		expect(queuedLine!).toContain("5s");
	});

	it("renders QUEUED badge without elapsed seconds when queuedAt is not set", () => {
		const footerData: ReadonlyFooterDataProvider = {
			...createFooterData(),
			getQueuedProgress: () => ({
				position: 2,
				queuedAhead: 1,
				queue: "worker",
				source: "llm-orchestrator",
			}),
		};
		const footer = new FooterComponent(createSession("normal"), footerData);

		const output = footer.render(200).join("\n");
		expect(output).toContain("QUEUED");
		const queuedLine = output.split("\n").find((line) => line.includes("QUEUED"));
		expect(queuedLine!).toContain("#2, 1 ahead");
		expect(queuedLine!).not.toMatch(/\d+s/);
	});

	describe("showVersion", () => {
		it("does not render version by default", () => {
			const footer = new FooterComponent(createSession("normal"), createFooterData());

			const output = footer.render(100).join("\n");
			expect(output).not.toMatch(/v\d+\.\d+\.\d+/);
		});

		it("renders version when showVersion is enabled", () => {
			const footer = new FooterComponent(createSession("normal"), createFooterData());
			footer.setShowVersion(true, "0.4.9");

			const output = footer.render(100).join("\n");
			expect(output).toContain("v0.4.9");
		});

		it("renders version on first line before cwd", () => {
			const footer = new FooterComponent(createSession("normal"), createFooterData());
			footer.setShowVersion(true, "0.4.9");

			const lines = footer.render(100);
			expect(lines[0]).toContain("v0.4.9 /tmp/project");
		});

		it("removes version when showVersion is disabled", () => {
			const footer = new FooterComponent(createSession("normal"), createFooterData());
			footer.setShowVersion(true, "0.4.9");

			let output = footer.render(100).join("\n");
			expect(output).toContain("v0.4.9");

			footer.setShowVersion(false, "0.4.9");
			output = footer.render(100).join("\n");
			expect(output).not.toContain("v0.4.9");
		});

		it("updates version when version changes", () => {
			const footer = new FooterComponent(createSession("normal"), createFooterData());
			footer.setShowVersion(true, "0.4.9");

			let output = footer.render(100).join("\n");
			expect(output).toContain("v0.4.9");

			footer.setShowVersion(true, "1.0.0");
			output = footer.render(100).join("\n");
			expect(output).toContain("v1.0.0");
			expect(output).not.toContain("v0.4.9");
		});
	});
});
