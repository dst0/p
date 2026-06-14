import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, getModel, type Usage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createTestResourceLoader } from "./utilities.ts";

const model = getModel("anthropic", "claude-sonnet-4-5")!;

// Base time well in the past so pre-compaction messages have timestamps < appendCompaction's Date.now()
const BASE_TIME = Date.now() - 60_000;

function createUsage(totalTokens: number): Usage {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};
}

function createAssistantMessage(text: string, totalTokens: number, offsetMs: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: createUsage(totalTokens),
		stopReason: "stop",
		timestamp: BASE_TIME + offsetMs,
	};
}

function createUserMessage(text: string, offsetMs: number) {
	return {
		role: "user" as const,
		content: text,
		timestamp: BASE_TIME + offsetMs,
	};
}

function createSession() {
	const settingsManager = SettingsManager.inMemory();
	const sessionManager = SessionManager.inMemory();
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey("anthropic", "test-key");
	const session = new AgentSession({
		agent: new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: "You are a helpful assistant.",
				tools: [],
				thinkingLevel: "high",
			},
		}),
		sessionManager,
		settingsManager,
		cwd: process.cwd(),
		modelRegistry: ModelRegistry.inMemory(authStorage),
		resourceLoader: createTestResourceLoader(),
	});

	return { session, sessionManager };
}

function syncAgentMessages(session: AgentSession, sessionManager: SessionManager): void {
	session.agent.state.messages = sessionManager.buildSessionContext().messages;
}

describe("AgentSession.getSessionStats", () => {
	it("exposes the current context usage alongside token totals", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("hello", 0));
			sessionManager.appendMessage(createAssistantMessage("hi", 200, 100));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.contextUsage).toEqual(session.getContextUsage());
			expect(stats.contextUsage?.tokens).toBe(200);
			expect(stats.contextUsage?.contextWindow).toBe(model.contextWindow);
			expect(stats.contextUsage?.percent).toBe((200 / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});

	it("reports unknown current context usage immediately after compaction", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 0));
			sessionManager.appendMessage(createAssistantMessage("response1", 180_000, 100));
			const keptUserId = sessionManager.appendMessage(createUserMessage("second", 200));
			sessionManager.appendMessage(createAssistantMessage("response2", 195_000, 300));
			// appendCompaction uses Date.now() internally, which is > BASE_TIME + 300
			sessionManager.appendCompaction("summary", keptUserId, 195_000);
			sessionManager.appendMessage(createUserMessage("third", 400));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.tokens.input).toBe(195_000);
			expect(stats.contextUsage).toBeDefined();
			expect(stats.contextUsage?.tokens).toBe(9);
			expect(stats.contextUsage?.percent).toBe((9 / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});

	it("uses post-compaction usage for current context instead of stale kept usage", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 0));
			sessionManager.appendMessage(createAssistantMessage("response1", 180_000, 100));
			const keptUserId = sessionManager.appendMessage(createUserMessage("second", 200));
			sessionManager.appendMessage(createAssistantMessage("response2", 195_000, 300));
			// appendCompaction uses Date.now() internally
			sessionManager.appendCompaction("summary", keptUserId, 195_000);
			sessionManager.appendMessage(createUserMessage("third", 400));
			// response3 timestamp must be after the compaction entry's Date.now()
			sessionManager.appendMessage(createAssistantMessage("response3", 25_000, Date.now() - BASE_TIME + 1_000));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.tokens.input).toBe(220_000);
			expect(stats.contextUsage).toBeDefined();
			expect(stats.contextUsage?.tokens).toBe(25_000);
			expect(stats.contextUsage?.percent).toBe((25_000 / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});

	it("reports prompt-projected tool stubs instead of raw trailing tool output", () => {
		const { session, sessionManager } = createSession();

		try {
			const longReadOutput = Array.from(
				{ length: 800 },
				(_, index) => `doc-line-${index.toString().padStart(4, "0")} ${"x".repeat(80)}`,
			).join("\n");
			const toolResult: AgentMessage = {
				role: "toolResult",
				toolCallId: "call-read-doc",
				toolName: "read",
				content: [{ type: "text", text: longReadOutput }],
				isError: false,
				timestamp: BASE_TIME + 200,
			};

			sessionManager.appendMessage(createUserMessage("inspect docs", 0));
			sessionManager.appendMessage(createAssistantMessage("reading docs", 5_000, 100));
			sessionManager.appendMessage(toolResult);
			syncAgentMessages(session, sessionManager);

			const usage = session.getContextUsage();
			expect(usage).toBeDefined();
			expect(usage?.stubbedToolResults).toContain("tool-result:call-read-doc");
			expect(usage?.toolStubSavings).toBeGreaterThan(0);
			expect(usage?.tokens).toBeLessThan(8_000);
			expect(usage?.tokens).toBeGreaterThanOrEqual(5_000);
		} finally {
			session.dispose();
		}
	});

	it("shows percent when agent state has post-compaction response before sessionManager persists it", () => {
		// Reproduces the timing race: getContextUsage is called from a message_end listener
		// (e.g. footer re-render) before sessionManager.appendMessage runs. agent.state.messages
		// already has the new assistant message; sessionManager does not.
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 0));
			sessionManager.appendMessage(createAssistantMessage("response1", 180_000, 100));
			const keptUserId = sessionManager.appendMessage(createUserMessage("second", 200));
			sessionManager.appendMessage(createAssistantMessage("response2", 195_000, 300));
			// appendCompaction uses Date.now() internally
			sessionManager.appendCompaction("summary", keptUserId, 195_000);
			sessionManager.appendMessage(createUserMessage("third", 400));
			// Simulate the state at message_end time: agent.state.messages is up-to-date
			// but sessionManager does NOT yet have the post-compaction assistant entry.
			// response3 timestamp must be after the compaction entry's Date.now().
			const postCompactionAssistant = createAssistantMessage("response3", 25_000, Date.now() - BASE_TIME + 1_000);
			const agentMessages = sessionManager.buildSessionContext().messages;
			agentMessages.push(postCompactionAssistant);
			session.agent.state.messages = agentMessages;
			// sessionManager intentionally does NOT have response3 yet (pre-appendMessage state)

			const usage = session.getContextUsage();
			expect(usage).toBeDefined();
			expect(usage?.tokens).toBe(25_000);
			expect(usage?.percent).toBe((25_000 / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});
});
