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

	it("renders QUEUED badge with elapsed seconds when queuedAt is set", () => {
		const queuedAt = Date.now() - 5500; // 5.5 seconds ago
		const footerData: ReadonlyFooterDataProvider = {
			...createFooterData(),
			getQueuedProgress: () => ({
				messages: 2,
				position: 2,
				queuedAhead: 1,
				source: "llm-orchestrator",
				queuedAt,
			}),
		};
		const footer = new FooterComponent(createSession("normal"), footerData);

		const output = footer.render(200).join("\n");
		expect(output).toContain("QUEUED");
		expect(output).toMatch(/\d+s/); // elapsed seconds like "5s"
		// Position info is not shown in status badge (already shown in queue column)
		const queuedLine = output.split("\n").find((line) => line.includes("QUEUED"));
		expect(queuedLine!).not.toContain("#");
		expect(queuedLine!).not.toContain("ahead");
	});

	it("renders QUEUED badge without elapsed seconds when queuedAt is not set", () => {
		const footerData: ReadonlyFooterDataProvider = {
			...createFooterData(),
			getQueuedProgress: () => ({
				messages: 2,
				position: 2,
				queuedAhead: 1,
				source: "llm-orchestrator",
			}),
		};
		const footer = new FooterComponent(createSession("normal"), footerData);

		const output = footer.render(200).join("\n");
		expect(output).toContain("QUEUED");
		// No position or elapsed info in status badge when queuedAt not set
		const queuedLine = output.split("\n").find((line) => line.includes("QUEUED"));
		expect(queuedLine!).not.toContain("#");
		expect(queuedLine!).not.toContain("ahead");
		expect(queuedLine!).not.toMatch(/\d+s/);
	});
});
