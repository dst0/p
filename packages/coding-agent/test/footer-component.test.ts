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
});
