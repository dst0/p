import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentMessage } from "@dst0/p-agent-core";
import { type Api, type Context, type Model, type SimpleStreamOptions, streamSimple } from "@dst0/p-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession, type AgentSessionEvent } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import {
	createInitialStructuredSessionState,
	getLatestStructuredSessionState,
	STRUCTURED_SESSION_STATE_CUSTOM_TYPE,
	type StructuredSessionState,
} from "../src/core/compaction/index.ts";
import type { ExtensionRunner } from "../src/core/extensions/index.ts";
import { convertToLlm } from "../src/core/messages.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createTestResourceLoader } from "./utilities.ts";

const RUN_REAL_SESSION_STATE = process.env.PI_TEST_REAL_SESSION_STATE === "1";
const WRITE_REAL_SESSION_STATE_LOGS = process.env.PI_TEST_REAL_SESSION_STATE_LOGS === "1";
const REAL_BASE_URL = process.env.PI_TEST_REAL_SESSION_STATE_BASE_URL ?? "http://192.168.8.167:11450/v1";
const REAL_PROVIDER = process.env.PI_TEST_REAL_SESSION_STATE_PROVIDER ?? "mini-pc-state";
const REAL_MODEL_ID = process.env.PI_TEST_REAL_SESSION_STATE_MODEL ?? "mini-pc/high-64";
const REAL_LOG_DIR = process.env.PI_TEST_REAL_SESSION_STATE_LOG_DIR ?? join(tmpdir(), "pi-real-session-state-logs");
const PRIMARY_GOAL =
	process.env.PI_TEST_REAL_SESSION_STATE_GOAL ?? "preserve primary session state across completed follow-up turns";

interface CapturedPrompt {
	systemPrompt: string;
	messages: AgentMessage[];
	texts: string[];
}

function messageText(message: AgentMessage): string {
	switch (message.role) {
		case "user":
		case "custom":
			return typeof message.content === "string"
				? message.content
				: message.content
						.filter((block) => block.type === "text")
						.map((block) => block.text)
						.join("\n");
		case "assistant":
		case "toolResult":
			return message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
		case "bashExecution":
			return `${message.command}\n${message.output}`;
		case "branchSummary":
		case "compactionSummary":
			return message.summary;
	}
}

function capturedTexts(messages: AgentMessage[]): string[] {
	return messages.map(messageText).filter((text) => text.length > 0);
}

function latestState(session: AgentSession): StructuredSessionState {
	const state = getLatestStructuredSessionState(session.sessionManager.getEntries());
	if (!state) {
		throw new Error("Expected a persisted structured session state entry");
	}
	return state;
}

function stateEntryCount(session: AgentSession): number {
	return session.sessionManager
		.getEntries()
		.filter((entry) => entry.type === "custom" && entry.customType === STRUCTURED_SESSION_STATE_CUSTOM_TYPE).length;
}

function latestWorkingStatePrompt(prompts: CapturedPrompt[]): string {
	for (let index = prompts.length - 1; index >= 0; index--) {
		const prompt = prompts[index];
		for (let textIndex = prompt.texts.length - 1; textIndex >= 0; textIndex--) {
			const workingState = prompt.texts[textIndex];
			if (workingState?.includes("<working_state>")) return workingState;
		}
	}
	throw new Error("Expected a provider prompt containing <working_state>");
}

function truncateText(text: string, maxLength: number | undefined): string {
	if (!maxLength || text.length <= maxLength) return text;
	return `${text.slice(0, maxLength)}...<truncated ${text.length - maxLength} chars>`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentMessage(value: unknown): value is AgentMessage {
	return isRecord(value) && typeof value.role === "string";
}

function toolNames(message: AgentMessage): string[] | undefined {
	if (message.role !== "assistant") return undefined;
	return message.content.filter((block) => block.type === "toolCall").map((block) => block.name);
}

function summarizeMessage(message: AgentMessage, maxTextLength: number | undefined): Record<string, unknown> {
	const summary: Record<string, unknown> = {
		role: message.role,
		text: truncateText(messageText(message), maxTextLength),
	};
	if (message.role === "assistant") {
		summary.stopReason = message.stopReason;
		summary.toolCalls = message.content
			.filter((block) => block.type === "toolCall")
			.map((block) => ({
				id: block.id,
				name: block.name,
				arguments: block.arguments,
			}));
	}
	if (message.role === "toolResult") {
		summary.toolName = message.toolName;
		summary.isError = message.isError;
	}
	if (message.role === "custom") {
		summary.customType = message.customType;
		summary.display = message.display;
	}
	return summary;
}

function summarizeEvent(event: AgentSessionEvent, maxTextLength: number | undefined): Record<string, unknown> {
	const record = event as unknown as Record<string, unknown>;
	const summary: Record<string, unknown> = { type: event.type };
	if (typeof record.event === "string") {
		summary.event = record.event;
	}
	if (typeof record.willRetry === "boolean") {
		summary.willRetry = record.willRetry;
	}
	if (typeof record.errorMessage === "string") {
		summary.errorMessage = record.errorMessage;
	}
	if (isAgentMessage(record.message)) {
		summary.message = summarizeMessage(record.message, maxTextLength);
	}
	if (Array.isArray(record.messages)) {
		summary.messageCount = record.messages.length;
		summary.lastMessage = record.messages.slice().reverse().find(isAgentMessage);
		if (isAgentMessage(summary.lastMessage)) {
			summary.lastMessage = summarizeMessage(summary.lastMessage, maxTextLength);
		}
	}
	return summary;
}

function createDiagnosticSnapshot(
	label: string,
	session: AgentSession,
	events: AgentSessionEvent[],
	prompts: CapturedPrompt[],
	maxTextLength?: number,
): Record<string, unknown> {
	const entries = session.sessionManager.getEntries().map((entry) => {
		if (entry.type === "message") {
			const message = entry.message;
			return {
				type: "message",
				id: entry.id,
				parentId: entry.parentId,
				role: message.role,
				text: truncateText(messageText(message), maxTextLength),
				contentTypes:
					message.role === "assistant" || message.role === "user" || message.role === "toolResult"
						? Array.isArray(message.content)
							? message.content.map((block) => block.type)
							: ["string"]
						: undefined,
				stopReason: message.role === "assistant" ? message.stopReason : undefined,
				toolNames: toolNames(message),
			};
		}
		if (entry.type === "custom") {
			return {
				type: "custom",
				id: entry.id,
				parentId: entry.parentId,
				customType: entry.customType,
				data: entry.data,
			};
		}
		if (entry.type === "custom_message") {
			return {
				type: "custom_message",
				id: entry.id,
				parentId: entry.parentId,
				customType: entry.customType,
				display: entry.display,
				content: typeof entry.content === "string" ? truncateText(entry.content, maxTextLength) : entry.content,
			};
		}
		return { type: entry.type, id: entry.id, parentId: entry.parentId };
	});
	const eventSummaries = events.map((event) => summarizeEvent(event, maxTextLength));
	const promptSummaries = prompts.map((prompt) => ({
		systemPromptIncludesStateProtocol: prompt.systemPrompt.includes("<session_state_protocol>"),
		systemPrompt: truncateText(prompt.systemPrompt, maxTextLength),
		texts: prompt.texts.map((text) => truncateText(text, maxTextLength)),
		workingStateTexts: prompt.texts
			.filter((text) => text.includes("<working_state>"))
			.map((text) => truncateText(text, maxTextLength)),
	}));
	const cappedEntries = maxTextLength ? entries.slice(-24) : entries;
	const cappedEvents = maxTextLength ? eventSummaries.slice(-40) : eventSummaries;
	const cappedPrompts = maxTextLength ? promptSummaries.slice(-8) : promptSummaries;
	return {
		label,
		generatedAt: new Date().toISOString(),
		realConfig: {
			baseUrl: REAL_BASE_URL,
			provider: REAL_PROVIDER,
			model: REAL_MODEL_ID,
		},
		stateEntryCount: stateEntryCount(session),
		latestStructuredState: getLatestStructuredSessionState(session.sessionManager.getEntries()),
		snapshotState: session.getSessionStateSnapshot().state,
		eventCount: events.length,
		events: cappedEvents,
		entryCount: entries.length,
		entries: cappedEntries,
		agentMessages: session.messages.map((message) => summarizeMessage(message, maxTextLength)),
		promptCount: prompts.length,
		prompts: cappedPrompts,
	};
}

function writeDiagnosticLog(
	label: string,
	session: AgentSession,
	events: AgentSessionEvent[],
	prompts: CapturedPrompt[],
): string {
	mkdirSync(REAL_LOG_DIR, { recursive: true });
	const safeLabel = label.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "session-state";
	const path = join(REAL_LOG_DIR, `${Date.now()}-${safeLabel}.json`);
	writeFileSync(path, JSON.stringify(createDiagnosticSnapshot(label, session, events, prompts), undefined, 2));
	return path;
}

function logDiagnosticIfEnabled(
	label: string,
	session: AgentSession,
	events: AgentSessionEvent[],
	prompts: CapturedPrompt[],
): void {
	if (!WRITE_REAL_SESSION_STATE_LOGS) return;
	const path = writeDiagnosticLog(label, session, events, prompts);
	console.info(`[real-session-state-log] ${path}`);
}

function summarizeSessionForFailure(
	session: AgentSession,
	events: AgentSessionEvent[],
	prompts: CapturedPrompt[],
): string {
	return JSON.stringify(createDiagnosticSnapshot("failure", session, events, prompts, 1000), undefined, 2);
}

function failWithDiagnostics(
	label: string,
	message: string,
	session: AgentSession,
	events: AgentSessionEvent[],
	prompts: CapturedPrompt[],
): never {
	const path = writeDiagnosticLog(label, session, events, prompts);
	throw new Error(`${message}\nDiagnostic log: ${path}\n${summarizeSessionForFailure(session, events, prompts)}`);
}

function expectPersistedState(session: AgentSession, events: AgentSessionEvent[], prompts: CapturedPrompt[]): void {
	const count = stateEntryCount(session);
	if (count === 0) {
		failWithDiagnostics(
			"hidden-state-update-missing",
			"Expected at least one persisted structured session state entry.",
			session,
			events,
			prompts,
		);
	}
	expect(count).toBeGreaterThan(0);
}

function createRealModelRegistry(authStorage: AuthStorage): ModelRegistry {
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	modelRegistry.registerProvider(REAL_PROVIDER, {
		name: "Real Session State Test",
		baseUrl: REAL_BASE_URL,
		apiKey: "unused",
		api: "openai-completions",
		authHeader: false,
		models: [
			{
				id: REAL_MODEL_ID,
				name: REAL_MODEL_ID,
				reasoning: false,
				input: ["text"],
				contextWindow: 55_000,
				maxTokens: 1_024,
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

function finishWorkInstruction(summary: string): string {
	const payload = JSON.stringify({
		name: "finish_work",
		arguments: {
			status: "success",
			summary,
			tests_run: ["real session-state LLM regression"],
		},
	});
	return [
		"When the requested task is complete, terminate by calling the finish_work tool.",
		"If native tool calling is unavailable, emit this exact XML tool call outside markdown fences:",
		`<tool_call>${payload}</tool_call>`,
	].join("\n");
}

function statePatchInstruction(goal: string, nextAction: string): string {
	return [
		"Your next assistant response must contain only this exact hidden state update text block:",
		`<session_state_update>{"type":"patch","goal":${JSON.stringify(goal)},"plan":[{"text":"Seed primary session state","status":"done"},{"text":${JSON.stringify(nextAction)},"status":"in_progress"}],"progress":{"current":[${JSON.stringify(nextAction)}],"next":["Keep the primary goal stable across later user messages"]},"decisions":[{"decision":"Use persisted structured session state as the task checkpoint","rationale":"The regression must prove state survives a completed agent turn."}]}</session_state_update>`,
		"Do not wrap the hidden state update in markdown.",
		"Do not call finish_work in that same assistant response. After the state block is persisted, follow the completion protocol repair prompt and call finish_work.",
	].join("\n");
}

function zeroUsage(): Extract<AgentMessage, { role: "assistant" }>["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

async function delay(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!RUN_REAL_SESSION_STATE)("AgentSession real LLM structured session state", () => {
	let session: AgentSession | undefined;
	let tempDir: string;
	let prompts: CapturedPrompt[];
	let events: AgentSessionEvent[];

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-real-state-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		prompts = [];
		events = [];
	});

	afterEach(async () => {
		if (session?.isStreaming) {
			await session.abort();
		}
		session?.dispose();
		if (existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function createSession(): AgentSession {
		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(REAL_PROVIDER, "unused");
		const modelRegistry = createRealModelRegistry(authStorage);
		const model = modelRegistry.find(REAL_PROVIDER, REAL_MODEL_ID) as Model<Api> | undefined;
		if (!model) {
			throw new Error(`Could not resolve real test model ${REAL_PROVIDER}/${REAL_MODEL_ID}`);
		}
		const extensionRunnerRef: { current?: ExtensionRunner } = {};
		const sessionManager = SessionManager.create(tempDir);
		const settingsManager = SettingsManager.inMemory({
			compaction: { enabled: false },
			completionLimits: {
				maxTurns: 4,
				maxNoProgressTurns: 3,
				maxMissingFinishRetries: 3,
				maxMalformedToolRetries: 3,
			},
		});
		const agent = new Agent({
			getApiKey: () => "unused",
			completionMode: "explicit_finish",
			initialState: {
				model,
				systemPrompt: [
					"You are running a live regression test for P's session-state protocol.",
					"Follow the user's requested hidden <session_state_update> block exactly.",
					"Do not reveal or explain hidden state updates to the user.",
					"Complete each successful task by calling finish_work.",
				].join("\n"),
				tools: [],
			},
			convertToLlm,
			streamFn: (streamModel: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
				prompts.push({
					systemPrompt: context.systemPrompt ?? "",
					messages: context.messages.slice(),
					texts: capturedTexts(context.messages),
				});
				return streamSimple(streamModel, context, {
					...options,
					temperature: options?.temperature ?? 0,
					maxTokens: options?.maxTokens ?? 1_024,
					maxRetryDelayMs: 30_000,
					timeoutMs: 120_000,
				});
			},
			transformContext: async (messages: AgentMessage[]) => {
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
			resourceLoader: createTestResourceLoader(),
			extensionRunnerRef,
			completionMode: "explicit_finish",
			initialActiveToolNames: ["finish_work"],
		});
		createdSession.subscribe((event) => {
			events.push(event);
		});
		return createdSession;
	}

	function seedStructuredState(activeSession: AgentSession, goal: string, currentAction: string): void {
		const state = createInitialStructuredSessionState(activeSession.sessionId);
		state.canonicalRequest.current = goal;
		state.plan.push(
			{
				id: "seed-primary-goal",
				text: "Seed primary session state",
				status: "done",
				evidenceEntryIds: [],
			},
			{
				id: "seed-current-action",
				text: currentAction,
				status: "in_progress",
				evidenceEntryIds: [],
			},
		);
		activeSession.sessionManager.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, state);
	}

	function appendSyntheticFinishedTurn(activeSession: AgentSession, goal: string): void {
		const toolCallId = `synthetic-finish-work-${Date.now().toString(36)}`;
		const timestamp = Date.now();
		const userMessage: AgentMessage = {
			role: "user",
			content: [{ type: "text", text: `Primary task completed before later command: ${goal}` }],
			timestamp,
		};
		const assistantMessage: AgentMessage = {
			role: "assistant",
			api: "openai-completions",
			provider: REAL_PROVIDER,
			model: REAL_MODEL_ID,
			content: [
				{
					type: "toolCall",
					id: toolCallId,
					name: "finish_work",
					arguments: {
						status: "success",
						summary: "synthetic completed checkpoint for live session-state regression",
						tests_run: ["real session-state LLM regression setup"],
					},
				},
			],
			usage: zeroUsage(),
			stopReason: "toolUse",
			timestamp: timestamp + 1,
		};
		const toolResultMessage: AgentMessage = {
			role: "toolResult",
			toolCallId,
			toolName: "finish_work",
			content: [{ type: "text", text: "synthetic completed checkpoint for live session-state regression" }],
			details: {
				status: "success",
				summary: "synthetic completed checkpoint for live session-state regression",
				tests_run: ["real session-state LLM regression setup"],
			},
			isError: false,
			timestamp: timestamp + 2,
		};
		for (const message of [userMessage, assistantMessage, toolResultMessage]) {
			activeSession.sessionManager.appendMessage(message);
			activeSession.agent.state.messages.push(message);
		}
	}

	function expectFinishWorkCalled(label: string, activeSession: AgentSession): void {
		if (events.some((event) => event.type === "completion_protocol" && event.event === "finish_work_called")) {
			return;
		}
		failWithDiagnostics(label, "Expected the real model to call finish_work.", activeSession, events, prompts);
	}

	it("persists a hidden session_state_update emitted by a real LLM before finish_work", async () => {
		session = createSession();
		const primaryGoal = `${PRIMARY_GOAL} (${Date.now().toString(36)})`;

		await session.prompt(
			[
				`Primary task: ${primaryGoal}.`,
				statePatchInstruction(primaryGoal, "Wait for a later independent user command"),
			].join("\n\n"),
		);
		await session.agent.waitForIdle();

		logDiagnosticIfEnabled("hidden-state-update", session, events, prompts);
		expectPersistedState(session, events, prompts);
		expect(latestState(session).canonicalRequest.current).toContain(primaryGoal);
		expectFinishWorkCalled("hidden-state-update-finish-work-missing", session);
	}, 300_000);

	it("keeps the seeded primary goal in working_state for a separate user command after finish_work", async () => {
		session = createSession();
		const primaryGoal = `${PRIMARY_GOAL} after finish (${Date.now().toString(36)})`;
		seedStructuredState(session, primaryGoal, "Wait for a later independent user command");
		appendSyntheticFinishedTurn(session, primaryGoal);

		await delay(10_000);

		const followUpCommand =
			"Separate follow-up command: inspect whether a completed agent session keeps its original goal. Treat this as a current instruction, not a replacement goal.";
		const promptsBeforeFollowUp = prompts.length;
		await session.prompt(
			[followUpCommand, finishWorkInstruction("completed-session follow-up inspected")].join("\n\n"),
		);
		await session.agent.waitForIdle();
		logDiagnosticIfEnabled("completed-follow-up", session, events, prompts);

		const followUpPrompt = latestWorkingStatePrompt(prompts.slice(promptsBeforeFollowUp));
		if (!followUpPrompt.includes(primaryGoal)) {
			failWithDiagnostics(
				"completed-follow-up-primary-goal-missing",
				"Expected completed-session follow-up working_state to retain the seeded primary goal.",
				session,
				events,
				prompts,
			);
		}
		if (followUpPrompt.includes("Separate follow-up command:")) {
			failWithDiagnostics(
				"completed-follow-up-goal-overwritten",
				"Expected completed-session follow-up working_state not to promote the new user message into the primary goal.",
				session,
				events,
				prompts,
			);
		}
		expect(latestState(session).canonicalRequest.current).toContain(primaryGoal);
	}, 300_000);

	it("keeps the seeded primary goal in working_state when a later user command is interrupted", async () => {
		session = createSession();
		const primaryGoal = `${PRIMARY_GOAL} before interrupt (${Date.now().toString(36)})`;
		seedStructuredState(session, primaryGoal, "Wait for a later interrupted user command");
		appendSyntheticFinishedTurn(session, primaryGoal);

		const interruptedCommand =
			"Interrupt scenario command: start a long explanation so the test can abort; this must not replace the primary goal.";
		const promptsBeforeInterrupt = prompts.length;
		const sawAssistantUpdate = new Promise<void>((resolve, reject) => {
			let unsubscribe = (): void => {};
			const timer = setTimeout(() => {
				unsubscribe();
				reject(
					new Error("Timed out waiting for a streaming assistant update before aborting the interrupted turn."),
				);
			}, 60_000);
			unsubscribe = session!.subscribe((event) => {
				if (event.type === "message_update") {
					clearTimeout(timer);
					unsubscribe();
					resolve();
				}
			});
		});
		const interruptedPrompt = session.prompt(
			[
				interruptedCommand,
				"Write at least 1200 words first. Do not call finish_work until after the long paragraph is complete.",
			].join("\n\n"),
		);
		try {
			await sawAssistantUpdate;
		} catch (error) {
			failWithDiagnostics(
				"interrupt-no-message-update",
				error instanceof Error ? error.message : String(error),
				session,
				events,
				prompts,
			);
		}
		await session.abort();
		await interruptedPrompt.catch(() => undefined);
		logDiagnosticIfEnabled("interrupted-follow-up", session, events, prompts);

		const interruptPrompt = latestWorkingStatePrompt(prompts.slice(promptsBeforeInterrupt));
		if (!interruptPrompt.includes(primaryGoal)) {
			failWithDiagnostics(
				"interrupt-primary-goal-missing",
				"Expected interrupted-turn working_state to retain the seeded primary goal.",
				session,
				events,
				prompts,
			);
		}
		if (interruptPrompt.includes("Interrupt scenario command:")) {
			failWithDiagnostics(
				"interrupt-goal-overwritten",
				"Expected interrupted-turn working_state not to promote the new user message into the primary goal.",
				session,
				events,
				prompts,
			);
		}
		expect(latestState(session).canonicalRequest.current).toContain(primaryGoal);
	}, 300_000);
});
