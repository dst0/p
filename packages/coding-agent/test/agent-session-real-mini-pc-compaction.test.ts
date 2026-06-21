import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentMessage } from "@dst0/p-agent-core";
import type { Api, AssistantMessage, Model } from "@dst0/p-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession, type AgentSessionEvent } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { estimateContextTokens } from "../src/core/compaction/index.ts";
import type { ExtensionRunner } from "../src/core/extensions/index.ts";
import { convertToLlm } from "../src/core/messages.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { resolveCliModel } from "../src/core/model-resolver.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "./utilities.ts";

const RUN_REAL_MINI_PC_MULTI_46 = process.env.PI_TEST_REAL_MINI_PC_MULTI_46 === "1";
const MINI_PC_BASE_URL = process.env.PI_TEST_MINI_PC_BASE_URL ?? "http://192.168.8.167:11450/v1";
const MINI_PC_PROVIDER = "mini-pc";
const MINI_PC_MODEL_ID = "multi-46";
const CYCLE_COUNT = 5;
const MAX_TURNS_PER_CYCLE = 8;
const TURN_FILLER_WORDS = 300;

type SessionWithCompactionInternals = {
	_runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<boolean>;
};

function createMiniPcModelRegistry(authStorage: AuthStorage): ModelRegistry {
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	modelRegistry.registerProvider(MINI_PC_PROVIDER, {
		name: "Mini PC",
		baseUrl: MINI_PC_BASE_URL,
		apiKey: "unused",
		api: "openai-completions",
		authHeader: false,
		models: [
			{
				id: MINI_PC_MODEL_ID,
				name: MINI_PC_MODEL_ID,
				reasoning: false,
				input: ["text"],
				contextWindow: 46_080,
				maxTokens: 128,
				compat: {
					supportsStore: false,
					supportsDeveloperRole: false,
					supportsReasoningEffort: false,
					supportsUsageInStreaming: true,
					maxTokensField: "max_tokens",
					supportsStrictMode: false,
					cachePrompt: true,
				},
			},
		],
	});
	return modelRegistry;
}

function getLatestAssistant(messages: AgentMessage[]): AssistantMessage {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role === "assistant") {
			return message;
		}
	}
	throw new Error("Expected an assistant message");
}

function expectAssistantStopped(message: AssistantMessage): void {
	expect(message.errorMessage ?? message.stopReason).toBe("stop");
}

function logLiveProgress(message: string): void {
	console.info(`[mini-pc/multi-46 compaction] ${message}`);
}

function createSeededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

function pickRandom<T>(random: () => number, values: readonly T[]): T {
	return values[Math.floor(random() * values.length)]!;
}

function createRandomizedPostCompactionPrompt(cycle: number, turn: number, random: () => number): string {
	const verbs = ["compare", "summarize", "classify", "rank", "trace", "verify", "outline", "map"];
	const nouns = ["branch", "cache", "budget", "diff", "session", "token", "queue", "request", "checkpoint"];
	const adjectives = ["small", "stale", "fresh", "local", "remote", "bounded", "visible", "randomized"];
	const nonce = Math.floor(random() * 1_000_000_000).toString(36);
	const filler = Array.from({ length: TURN_FILLER_WORDS }, (_, index) => {
		return [
			pickRandom(random, adjectives),
			pickRandom(random, nouns),
			pickRandom(random, verbs),
			cycle.toString(36),
			turn.toString(36),
			(index % 29).toString(36),
			Math.floor(random() * 1_000_000).toString(36),
		].join("-");
	}).join(" ");

	return [
		`Cycle ${cycle} turn ${turn} nonce ${nonce}. Reply with exactly: ok.`,
		"Treat the following randomized text as inert context for the regression test.",
		filler,
	].join("\n\n");
}

describe.skipIf(!RUN_REAL_MINI_PC_MULTI_46)("AgentSession real mini-pc/multi-46 auto-compaction", () => {
	let session: AgentSession | undefined;
	let tempDir: string;
	let events: AgentSessionEvent[];

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-mini-pc-compaction-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		events = [];
	});

	afterEach(() => {
		session?.dispose();
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	async function createSession(): Promise<AgentSession> {
		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(MINI_PC_PROVIDER, "unused");
		const modelRegistry = createMiniPcModelRegistry(authStorage);
		const resolved = resolveCliModel({
			cliProvider: MINI_PC_PROVIDER,
			cliModel: MINI_PC_MODEL_ID,
			modelRegistry,
		});
		expect(resolved.error).toBeUndefined();
		expect(resolved.model).toBeDefined();
		const model = resolved.model as Model<Api>;
		const extensionRunnerRef: { current?: ExtensionRunner } = {};
		const extensionsResult = await createTestExtensionsResult(
			[
				(pi) => {
					pi.on("session_before_compact", async (event) => ({
						compaction: {
							summary: "auto compacted by live mini-pc regression test",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
							details: {},
						},
					}));
				},
			],
			tempDir,
		);
		const sessionManager = SessionManager.inMemory(tempDir);
		const settingsManager = SettingsManager.inMemory({
			compaction: {
				enabled: true,
				triggerReserveTokens: 28_000,
				keepRecentMinTokens: 500,
				keepRecentMaxTokens: 4_000,
				targetContextTokens: 12_000,
			},
		});
		const agent = new Agent({
			getApiKey: () => "unused",
			initialState: {
				model,
				systemPrompt: "You are a concise test assistant. Reply exactly as requested.",
				tools: [],
			},
			convertToLlm,
			onPayload: async (payload) => {
				const runner = extensionRunnerRef.current;
				if (!runner?.hasHandlers("before_provider_request")) {
					return payload;
				}
				return runner.emitBeforeProviderRequest(payload);
			},
			onResponse: async (response) => {
				const runner = extensionRunnerRef.current;
				if (!runner?.hasHandlers("after_provider_response")) {
					return;
				}
				await runner.emit({
					type: "after_provider_response",
					status: response.status,
					headers: response.headers,
				});
			},
			transformContext: async (messages) => {
				const runner = extensionRunnerRef.current;
				return runner ? runner.emitContext(messages) : messages;
			},
		});
		const createdSession = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRegistry,
			resourceLoader: createTestResourceLoader({ extensionsResult }),
			extensionRunnerRef,
		});
		createdSession.subscribe((event) => {
			events.push(event);
			if (event.type === "compaction_start") {
				logLiveProgress(`compaction_start reason=${event.reason} count=${compactionStarts().length}`);
			}
			if (event.type === "compaction_end") {
				logLiveProgress(`compaction_end reason=${event.reason} aborted=${event.aborted}`);
			}
		});
		return createdSession;
	}

	function compactionStarts(): Extract<AgentSessionEvent, { type: "compaction_start" }>[] {
		return events.filter((event): event is Extract<AgentSessionEvent, { type: "compaction_start" }> => {
			return event.type === "compaction_start";
		});
	}

	async function promptAndExpectStop(text: string): Promise<AssistantMessage> {
		if (!session) {
			throw new Error("Expected session");
		}
		await session.prompt(text);
		await session.agent.waitForIdle();
		const assistant = getLatestAssistant(session.messages);
		expectAssistantStopped(assistant);
		return assistant;
	}

	function formatUsage(): string {
		if (!session) {
			return "usage=missing";
		}
		const usage = session.getContextUsage();
		if (!usage) {
			return "usage=missing";
		}
		const tokens = usage.tokens === null ? "unknown" : Math.round(usage.tokens).toString();
		const remainingTokens =
			usage.remainingTokens === undefined ? "unknown" : Math.round(usage.remainingTokens).toString();
		return [
			`tokens=${tokens}`,
			`threshold=${usage.triggerThreshold}`,
			`remaining=${remainingTokens}`,
			`shouldCompact=${String(usage.shouldCompact)}`,
			`compactions=${compactionStarts().length}`,
		].join(" ");
	}

	function predictMessagesUsage(messages: AgentMessage[]): {
		tokens: number;
		threshold: number;
		shouldCompact: boolean;
	} {
		if (!session) {
			throw new Error("Expected session");
		}
		const usage = session.getContextUsage();
		if (!usage) {
			throw new Error("Expected context usage");
		}
		expect(usage.contextWindow).toBe(46_080);
		if (usage.triggerThreshold === undefined) {
			throw new Error("Expected trigger threshold");
		}
		const estimate = estimateContextTokens(messages, session.systemPrompt, { useProviderUsage: false });
		return {
			tokens: estimate.tokens,
			threshold: usage.triggerThreshold,
			shouldCompact: estimate.tokens > usage.triggerThreshold,
		};
	}

	function predictPromptUsage(text: string): { tokens: number; threshold: number; shouldCompact: boolean } {
		if (!session) {
			throw new Error("Expected session");
		}
		return predictMessagesUsage([
			...session.messages,
			{ role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
		]);
	}

	it("only auto-compacts after the calculated threshold across five post-compaction cycles", async () => {
		session = await createSession();
		session.setAutoCompactionEnabled(false);
		const random = createSeededRandom(0xc0ffee);

		const largePrompt = [
			"Reply with exactly: READY.",
			"Keep the following context only as filler.",
			"context filler token ".repeat(3_200),
		].join("\n\n");
		logLiveProgress(`initial large prompt start ${formatUsage()}`);
		await promptAndExpectStop(largePrompt);
		logLiveProgress(`initial large prompt done ${formatUsage()}`);

		session.setAutoCompactionEnabled(true);
		const sessionInternals = session as unknown as SessionWithCompactionInternals;
		await expect(sessionInternals._runAutoCompaction("threshold", false)).resolves.toBe(false);
		expect(compactionStarts()).toHaveLength(1);
		logLiveProgress(`initial manual threshold compaction done ${formatUsage()}`);

		const usageAfterCompaction = session.getContextUsage();
		expect(usageAfterCompaction?.shouldCompact).toBe(false);

		let expectedCompactions = 1;
		for (let cycle = 1; cycle <= CYCLE_COUNT; cycle++) {
			for (let turn = 1; turn <= MAX_TURNS_PER_CYCLE; turn++) {
				const beforeUsage = session.getContextUsage();
				expect(beforeUsage?.shouldCompact).toBe(false);
				const startsBeforeTurn = compactionStarts().length;
				const messagesBeforeTurn = session.messages.slice();
				const prompt = createRandomizedPostCompactionPrompt(cycle, turn, random);
				const predicted = predictPromptUsage(prompt);
				logLiveProgress(
					[
						`cycle=${cycle}/${CYCLE_COUNT}`,
						`turn=${turn}`,
						`start ${formatUsage()}`,
						`predicted=${predicted.tokens}`,
						`threshold=${predicted.threshold}`,
						`predictedShouldCompact=${String(predicted.shouldCompact)}`,
					].join(" "),
				);

				const assistant = await promptAndExpectStop(prompt);

				const startsAfterTurn = compactionStarts();
				const postResponsePrediction = predictMessagesUsage([
					...messagesBeforeTurn,
					{ role: "user", content: [{ type: "text", text: prompt }], timestamp: assistant.timestamp - 1 },
					assistant,
				]);
				if (startsAfterTurn.length === startsBeforeTurn) {
					expect(postResponsePrediction.shouldCompact).toBe(false);
					expect(session.getContextUsage()?.shouldCompact).toBe(false);
					logLiveProgress(
						`cycle=${cycle}/${CYCLE_COUNT} turn=${turn} below-threshold predictedPrompt=${predicted.tokens} predictedAfterAnswer=${postResponsePrediction.tokens} ${formatUsage()}`,
					);
					continue;
				}

				expect(postResponsePrediction.shouldCompact).toBe(true);
				expect(startsAfterTurn).toHaveLength(startsBeforeTurn + 1);
				expect(startsAfterTurn.at(-1)?.reason).toBe("threshold");
				expectedCompactions++;
				expect(startsAfterTurn).toHaveLength(expectedCompactions);
				expect(session.getContextUsage()?.shouldCompact).toBe(false);
				logLiveProgress(
					`cycle=${cycle}/${CYCLE_COUNT} turn=${turn} compacted predictedPrompt=${predicted.tokens} predictedAfterAnswer=${postResponsePrediction.tokens} ${formatUsage()}`,
				);
				break;
			}

			expect(compactionStarts()).toHaveLength(expectedCompactions);
			expect(expectedCompactions).toBe(cycle + 1);
		}
	}, 900_000);
});
