import { visibleWidth } from "@dst0/p-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type {
	GenerationProgress,
	PrefillProgress,
	QueuedProgress,
	ReadonlyFooterDataProvider,
	SendingProgress,
} from "../src/core/footer-data-provider.ts";
import { FooterComponent, formatCwdForFooter } from "../src/modes/interactive/components/footer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type AssistantUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
};

function createSession(options: {
	sessionName: string;
	modelId?: string;
	provider?: string;
	reasoning?: boolean;
	thinkingLevel?: string;
	usage?: AssistantUsage;
}): AgentSession {
	const usage = options.usage;
	const entries =
		usage === undefined
			? []
			: [
					{
						type: "message",
						message: {
							role: "assistant",
							usage,
						},
					},
				];

	const session = {
		state: {
			model: {
				id: options.modelId ?? "test-model",
				provider: options.provider ?? "test",
				contextWindow: 200_000,
				reasoning: options.reasoning ?? false,
			},
			thinkingLevel: options.thinkingLevel ?? "off",
		},
		sessionManager: {
			getEntries: () => entries,
			getSessionName: () => options.sessionName,
			getCwd: () => "/tmp/project",
		},
		getContextUsage: () => ({ contextWindow: 200_000, percent: 12.3 }),
		modelRegistry: {
			isUsingOAuth: () => false,
		},
	};

	return session as unknown as AgentSession;
}

function createFooterData(
	providerCount: number,
	progress: {
		prefill?: PrefillProgress;
		gen?: GenerationProgress;
		queued?: QueuedProgress;
		sending?: SendingProgress;
	} = {},
): ReadonlyFooterDataProvider {
	const provider = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map<string, string>(),
		getAvailableProviderCount: () => providerCount,
		getPrefillProgress: () => progress.prefill,
		getGenProgress: () => progress.gen,
		getQueuedProgress: () => progress.queued,
		getSendingProgress: () => progress.sending,
		getModelSwitchProgress: () => undefined,
		getLoadingProgress: () => undefined,
		getIndexingStatus: () => ({ decision: "unknown" as const, indexed: false, serviceRunning: false }),
		onBranchChange: (callback: () => void) => {
			void callback;
			return () => {};
		},
		onProgressChange: (callback: () => void) => {
			void callback;
			return () => {};
		},
	};

	return provider;
}

describe("formatCwdForFooter", () => {
	it("does not abbreviate sibling paths that share the home prefix", () => {
		expect(formatCwdForFooter("/home/user2", "/home/user")).toBe("/home/user2");
	});

	it("abbreviates the home directory and descendants", () => {
		expect(formatCwdForFooter("/home/user", "/home/user")).toBe("~");
		expect(formatCwdForFooter("/home/user/project", "/home/user")).toBe("~/project");
	});
});

describe("FooterComponent width handling", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("keeps all lines within width for wide session names", () => {
		const width = 93;
		const session = createSession({ sessionName: "한글".repeat(30) });
		const footer = new FooterComponent(session, createFooterData(1));

		const lines = footer.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("keeps stats line within width for wide model and provider names", () => {
		const width = 60;
		const session = createSession({
			sessionName: "",
			modelId: "模".repeat(30),
			provider: "공급자",
			reasoning: true,
			thinkingLevel: "high",
			usage: {
				input: 12_345,
				output: 6_789,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(2));

		const lines = footer.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("shows the latest cache hit rate when cache usage is present", () => {
		const session = createSession({
			sessionName: "",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 50,
				cacheWrite: 50,
				cost: { total: 0.001 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const statsLine = stripAnsi(footer.render(120)[1]);
		expect(statsLine).toContain("CH25.0%");
	});

	it("shows compact queued progress before stream progress", () => {
		const session = createSession({ sessionName: "" });
		const footer = new FooterComponent(
			session,
			createFooterData(1, {
				queued: { position: 2, queuedAhead: 1, queue: "worker", source: "llm-orchestrator" },
				prefill: { percent: 42, elapsedMs: 1000 },
				gen: { tokens: 12, tokensPerSecond: 6 },
			}),
		);

		const statsLine = stripAnsi(footer.render(120)[1]);
		expect(statsLine).toContain("PREFILL");
		expect(statsLine).toContain("42%");
		expect(statsLine).not.toContain("QUEUED 2");
		expect(statsLine).not.toContain("GEN");
	});

	it("shows orchestrator queue position", () => {
		const session = createSession({ sessionName: "" });
		const footer = new FooterComponent(
			session,
			createFooterData(1, {
				queued: { position: 2, queuedAhead: 1, queue: "worker", source: "llm-orchestrator" },
			}),
		);

		const statsLine = stripAnsi(footer.render(120)[1]);
		expect(statsLine).toContain("QUEUED");
		// expect(statsLine).toContain("#2, 1 ahead");
		expect(statsLine).not.toContain("QUEUED 2");
	});

	it("animates queued progress with a one-character spinner", () => {
		vi.useFakeTimers();
		try {
			const session = createSession({ sessionName: "" });
			const footer = new FooterComponent(
				session,
				createFooterData(1, {
					queued: { position: 2, queuedAhead: 1, queue: "worker", source: "llm-orchestrator" },
				}),
			);

			vi.setSystemTime(0);
			const firstStatsLine = stripAnsi(footer.render(120)[1]);
			vi.setSystemTime(250);
			const secondStatsLine = stripAnsi(footer.render(120)[1]);

			expect(firstStatsLine).toContain("QUEUED |");
			expect(secondStatsLine).toContain("QUEUED /");
		} finally {
			vi.useRealTimers();
		}
	});

	it("shows sending progress until provider progress arrives", () => {
		const session = createSession({ sessionName: "" });
		const footer = new FooterComponent(
			session,
			createFooterData(1, {
				sending: { model: "local/model-a" },
			}),
		);

		const statsLine = stripAnsi(footer.render(120)[1]);
		expect(statsLine).toContain("SENDING local/model-a");
	});

	it("shows orchestrator queue progress before sending progress", () => {
		const session = createSession({ sessionName: "" });
		const footer = new FooterComponent(
			session,
			createFooterData(1, {
				queued: { position: 3, queuedAhead: 2, queue: "worker", source: "llm-orchestrator" },
				sending: { model: "local/model-a" },
			}),
		);

		const statsLine = stripAnsi(footer.render(120)[1]);
		expect(statsLine).toContain("QUEUED");
		// expect(statsLine).toContain("#3, 2 ahead");
		expect(statsLine).not.toContain("SENDING");
	});

	it("shows compact prefill progress", () => {
		const session = createSession({ sessionName: "" });
		const footer = new FooterComponent(session, createFooterData(1, { prefill: { percent: 42, elapsedMs: 1000 } }));

		const statsLine = stripAnsi(footer.render(120)[1]);
		expect(statsLine).toContain("PREFILL");
		expect(statsLine).toContain("42%");
	});

	it("shows context usage before prefill progress", () => {
		const session = createSession({ sessionName: "" });
		const footer = new FooterComponent(session, createFooterData(1, { prefill: { percent: 42, elapsedMs: 1000 } }));

		const statsLine = stripAnsi(footer.render(120)[1]);
		expect(statsLine.indexOf("12.3%/200k (auto)")).toBeLessThan(statsLine.indexOf("PREFILL"));
	});

	it("shows compact generation progress", () => {
		const session = createSession({ sessionName: "" });
		const footer = new FooterComponent(session, createFooterData(1, { gen: { tokens: 1234, tokensPerSecond: 56 } }));

		const statsLine = stripAnsi(footer.render(120)[1]);
		expect(statsLine).toContain("GEN");
		expect(statsLine).toContain("1.2k tok 56 t/s");
	});

	it("hides token progress when disabled", () => {
		const session = createSession({ sessionName: "" });
		const footer = new FooterComponent(session, createFooterData(1, { gen: { tokens: 12, tokensPerSecond: 6 } }));
		footer.setShowTokenProgress(false);

		const statsLine = stripAnsi(footer.render(120)[1]);
		expect(statsLine).not.toContain("GEN");
	});

	it("shows token stats by default", () => {
		const session = createSession({
			sessionName: "",
			usage: {
				input: 1000,
				output: 500,
				cacheRead: 200,
				cacheWrite: 100,
				cost: { total: 0.01 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const statsLine = stripAnsi(footer.render(120)[1]);
		expect(statsLine).toContain("↑");
		expect(statsLine).toContain("↓");
		expect(statsLine).toContain("R");
		expect(statsLine).toContain("CH");
	});

	it("hides token stats when disabled", () => {
		const session = createSession({
			sessionName: "",
			usage: {
				input: 1000,
				output: 500,
				cacheRead: 200,
				cacheWrite: 100,
				cost: { total: 0.01 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));
		footer.setShowTokenStats(false);

		const statsLine = stripAnsi(footer.render(120)[1]);
		expect(statsLine).not.toContain("↑");
		expect(statsLine).not.toContain("↓");
		expect(statsLine).not.toContain("CH");
	});
});
