import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@dst0/p-agent-core";
import {
	type AssistantMessage,
	type Context,
	fauxAssistantMessage,
	type Message,
	registerFauxProvider,
} from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../../../src/core/auth-storage.ts";
import {
	createInitialStructuredSessionState,
	STRUCTURED_SESSION_STATE_CUSTOM_TYPE,
} from "../../../src/core/compaction/index.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";
import type { ExtensionAPI } from "../../../src/index.ts";

interface CapturedPrompt {
	systemPrompt: string | undefined;
	roles: string[];
	texts: string[];
}

/**
 * Regression: working state must NOT be embedded in the system prompt.
 *
 * If the working state (which changes every turn) is inside the system prompt,
 * the entire prompt prefix changes on every turn. This breaks prefix-based KV
 * cache reuse (e.g. llama.cpp cache_prompt, Anthropic/OpenAI prompt caching)
 * because the cache can only reuse tokens from the start of the prompt that
 * match the previous request.
 *
 * The working state is injected as a custom message after the user message that
 * caused it, and that insertion is replayed on later turns. This preserves the
 * exact previous prompt prefix when the assistant response is appended to
 * history.
 */
describe("working state cache isolation", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

	function messageText(message: Message): string {
		if (message.role === "assistant") {
			return message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
		}
		if (message.role === "toolResult") {
			return message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
		}
		if (typeof message.content === "string") {
			return message.content;
		}
		return message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n");
	}

	function captureProviderPrompt(context: Context): CapturedPrompt {
		return {
			systemPrompt: context.systemPrompt,
			roles: context.messages.map((message) => message.role),
			texts: context.messages.map((message) => messageText(message)),
		};
	}

	function serializeCapturedPrompt(prompt: CapturedPrompt): string {
		const parts: string[] = [];
		if (prompt.systemPrompt) {
			parts.push(`system:${prompt.systemPrompt}`);
		}
		for (const [index, role] of prompt.roles.entries()) {
			parts.push(`${role}:${prompt.texts[index] ?? ""}`);
		}
		return parts.join("\n\n");
	}

	function promptTokenUsage(usage: AssistantMessage["usage"]): number {
		return usage.input + usage.cacheRead;
	}

	function assistantMessages(messages: readonly unknown[]): AssistantMessage[] {
		return messages.filter((message): message is AssistantMessage => {
			return typeof message === "object" && message !== null && "role" in message && message.role === "assistant";
		});
	}

	async function createRuntimeForTest(responses: string[]) {
		const tempDir = join(tmpdir(), `pi-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });

		const faux = registerFauxProvider({
			models: [{ id: "faux-1", reasoning: false }],
		});
		faux.setResponses(responses.map((response) => fauxAssistantMessage(response)));

		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				cwd,
				agentDir: tempDir,
				authStorage,
				resourceLoaderOptions: {
					extensionFactories: [
						(pi: ExtensionAPI) => {
							pi.registerProvider(faux.getModel().provider, {
								baseUrl: faux.getModel().baseUrl,
								apiKey: "faux-key",
								api: faux.api,
								models: faux.models.map((registeredModel) => ({
									id: registeredModel.id,
									name: registeredModel.name,
									api: registeredModel.api,
									reasoning: registeredModel.reasoning,
									input: registeredModel.input,
									cost: registeredModel.cost,
									contextWindow: registeredModel.contextWindow,
									maxTokens: registeredModel.maxTokens,
								})),
							});
						},
					],
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
				},
			});
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: faux.getModel(),
					completionMode: "implicit",
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};

		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.create(tempDir),
		});
		runtime.session.setActiveToolsByName([]);
		runtime.session.settingsManager.applyOverrides({ compaction: { enabled: true } });
		const state = createInitialStructuredSessionState(runtime.session.sessionId);
		state.canonicalRequest.current = "Preserve prompt cache reuse";
		state.progress.current = ["Keep working state outside the system prompt"];
		state.progress.next = ["Replay working state at stable user-message anchors"];
		runtime.session.sessionManager.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, state);

		cleanups.push(async () => {
			await runtime.dispose();
			faux.unregister();
			if (existsSync(tempDir)) {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});

		return { runtime, session: runtime.session, faux, createRuntime, tempDir };
	}

	it("excludes working state from system prompt", async () => {
		const { session } = await createRuntimeForTest(["done"]);

		// Trigger prompt preparation by sending a message
		await session.prompt("hello");

		// Wait for the model to respond
		await session.agent.waitForIdle();

		// The system prompt must not contain working state markers
		const sp = session.systemPrompt;
		expect(sp).toBeDefined();

		// Working state contains markers like "Goal:", "Plan:", "Next:", etc.
		// These should NOT appear in the system prompt
		expect(sp).not.toContain("Goal:");
		expect(sp).not.toContain("Plan:");
		expect(sp).not.toContain("Next:");
		expect(sp).not.toContain("Active constraints:");
		expect(sp).not.toContain("Touched files:");
	}, 30000);

	it("keeps system prompt stable across multiple turns", async () => {
		const { session } = await createRuntimeForTest(["r1", "r2", "r3"]);

		const systemPrompts: string[] = [];

		for (const msg of ["hello", "world", "final"]) {
			await session.prompt(msg);
			await session.agent.waitForIdle();
			systemPrompts.push(session.systemPrompt);
		}

		// All system prompts should be identical across turns
		expect(systemPrompts[0]).toBe(systemPrompts[1]);
		expect(systemPrompts[1]).toBe(systemPrompts[2]);

		// And they should not contain working state markers
		const sp = systemPrompts[0];
		expect(sp).not.toContain("Goal:");
		expect(sp).not.toContain("Plan:");
		expect(sp).not.toContain("Next:");
	}, 30000);

	it("replays prior working state at stable message anchors for full prefix cache reuse", async () => {
		const { session, faux } = await createRuntimeForTest([]);
		const prompts: Array<ReturnType<typeof captureProviderPrompt>> = [];
		faux.setResponses([
			(context) => {
				prompts.push(captureProviderPrompt(context));
				return fauxAssistantMessage("r1");
			},
			(context) => {
				prompts.push(captureProviderPrompt(context));
				return fauxAssistantMessage("r2");
			},
		]);

		await session.prompt("hello");
		await session.agent.waitForIdle();
		await session.prompt("world");
		await session.agent.waitForIdle();

		expect(prompts).toHaveLength(2);
		const firstPrompt = prompts[0];
		const secondPrompt = prompts[1];
		expect(firstPrompt?.roles).toEqual(["user", "user"]);
		expect(firstPrompt?.texts[0]).toBe("hello");
		expect(firstPrompt?.texts[1]).toContain("<working_state>");
		expect(secondPrompt?.systemPrompt).toBe(firstPrompt?.systemPrompt);
		expect(secondPrompt?.roles).toEqual(["user", "user", "assistant", "user", "user"]);
		expect(secondPrompt?.texts.slice(0, 2)).toEqual(firstPrompt?.texts);
		expect(secondPrompt?.texts[2]).toBe("r1");
		expect(secondPrompt?.texts[3]).toBe("world");
		expect(secondPrompt?.texts[4]).toContain("<working_state>");
		expect(
			firstPrompt && secondPrompt
				? serializeCapturedPrompt(secondPrompt).startsWith(serializeCapturedPrompt(firstPrompt))
				: false,
		).toBe(true);

		const assistants = assistantMessages(session.messages);
		expect(assistants).toHaveLength(2);
		expect(assistants[0]?.usage.cacheWrite).toBeGreaterThan(0);
		expect(assistants[1]?.usage.cacheRead).toBe(assistants[0]?.usage.cacheWrite);
		const workingStateMessages = session.messages.filter(
			(message): message is Extract<AgentMessage, { role: "custom" }> =>
				message.role === "custom" && message.customType === "working_state",
		);
		expect(workingStateMessages).toHaveLength(2);
		expect(workingStateMessages.every((message) => message.display === false)).toBe(true);
	}, 30000);

	it("replays prior working state after reopening a persisted session", async () => {
		const { session, faux, createRuntime, tempDir } = await createRuntimeForTest([]);
		const prompts: Array<ReturnType<typeof captureProviderPrompt>> = [];
		faux.setResponses([
			(context) => {
				prompts.push(captureProviderPrompt(context));
				return fauxAssistantMessage("r1");
			},
		]);

		await session.prompt("hello");
		await session.agent.waitForIdle();

		const sessionFile = session.sessionManager.getSessionFile();
		expect(sessionFile).toBeDefined();
		if (!sessionFile) throw new Error("Expected persisted session file");

		const reopenedRuntime = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.open(sessionFile, undefined, tempDir),
		});
		reopenedRuntime.session.setActiveToolsByName([]);
		reopenedRuntime.session.settingsManager.applyOverrides({ compaction: { enabled: true } });
		cleanups.push(async () => {
			await reopenedRuntime.dispose();
		});

		faux.setResponses([
			(context) => {
				prompts.push(captureProviderPrompt(context));
				return fauxAssistantMessage("r2");
			},
		]);

		await reopenedRuntime.session.prompt("world");
		await reopenedRuntime.session.agent.waitForIdle();

		expect(prompts).toHaveLength(2);
		const firstPrompt = prompts[0];
		const secondPrompt = prompts[1];
		expect(firstPrompt?.roles).toEqual(["user", "user"]);
		expect(firstPrompt?.texts[0]).toBe("hello");
		expect(firstPrompt?.texts[1]).toContain("<working_state>");
		expect(secondPrompt?.systemPrompt).toBe(firstPrompt?.systemPrompt);
		expect(secondPrompt?.roles).toEqual(["user", "user", "assistant", "user", "user"]);
		expect(secondPrompt?.texts.slice(0, 2)).toEqual(firstPrompt?.texts);
		expect(secondPrompt?.texts[2]).toBe("r1");
		expect(secondPrompt?.texts[3]).toBe("world");
		expect(secondPrompt?.texts[4]).toContain("<working_state>");
		expect(
			firstPrompt && secondPrompt
				? serializeCapturedPrompt(secondPrompt).startsWith(serializeCapturedPrompt(firstPrompt))
				: false,
		).toBe(true);
		const workingStateMessages = reopenedRuntime.session.messages.filter(
			(message): message is Extract<AgentMessage, { role: "custom" }> =>
				message.role === "custom" && message.customType === "working_state",
		);
		expect(workingStateMessages).toHaveLength(2);
		expect(workingStateMessages.every((message) => message.display === false)).toBe(true);
	}, 30000);

	it("keeps reopened runtime-context turns prefix-cache stable", async () => {
		const { runtime, session, faux, createRuntime, tempDir } = await createRuntimeForTest([]);
		const prompts: Array<ReturnType<typeof captureProviderPrompt>> = [];
		const promptStrings: string[] = [];
		const usageByTurn: AssistantMessage["usage"][] = [];
		let activeRuntime = runtime;

		const runTurn = async (turn: number) => {
			faux.setResponses([
				(context) => {
					const prompt = captureProviderPrompt(context);
					prompts.push(prompt);
					promptStrings.push(serializeCapturedPrompt(prompt));
					return fauxAssistantMessage(`turn ${turn} complete`);
				},
			]);

			await activeRuntime.session.prompt(`turn ${turn}: continue the cache-stability task`);
			await activeRuntime.session.agent.waitForIdle();

			const assistants = assistantMessages(activeRuntime.session.messages);
			const lastAssistant = assistants.at(-1);
			expect(lastAssistant).toBeDefined();
			usageByTurn.push(lastAssistant!.usage);
		};

		await runTurn(1);
		const sessionFile = session.sessionManager.getSessionFile();
		expect(sessionFile).toBeDefined();
		if (!sessionFile) throw new Error("Expected persisted session file");

		for (let turn = 2; turn <= 14; turn++) {
			const reopenedRuntime = await createAgentSessionRuntime(createRuntime, {
				cwd: tempDir,
				agentDir: tempDir,
				sessionManager: SessionManager.open(sessionFile, undefined, tempDir),
			});
			reopenedRuntime.session.setActiveToolsByName([]);
			reopenedRuntime.session.settingsManager.applyOverrides({ compaction: { enabled: true } });
			cleanups.push(async () => {
				await reopenedRuntime.dispose();
			});
			activeRuntime = reopenedRuntime;
			await runTurn(turn);
		}

		expect(prompts).toHaveLength(14);
		expect(prompts.some((prompt) => prompt.texts.some((text) => text.includes("<project_memory>")))).toBe(true);
		for (let index = 1; index < promptStrings.length; index++) {
			expect(promptStrings[index]?.startsWith(promptStrings[index - 1] ?? "")).toBe(true);
			expect(usageByTurn[index]?.cacheRead ?? 0).toBeGreaterThanOrEqual(promptTokenUsage(usageByTurn[index - 1]!));
		}
	}, 30000);

	it("keeps post-compaction provider prompts user-continuable", async () => {
		const { session, faux } = await createRuntimeForTest([]);
		const baseTimestamp = Date.now() - 20_000;
		const firstKeptEntryId = session.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "pre-compaction question" }],
			timestamp: baseTimestamp,
		});
		session.sessionManager.appendMessage({
			...fauxAssistantMessage("pre-compaction answer"),
			timestamp: baseTimestamp + 1,
		});
		session.sessionManager.appendCompaction("compacted summary", firstKeptEntryId, 2048, undefined, undefined, false);
		session.agent.state.messages = session.sessionManager.buildSessionContext().messages;

		const prompts: Array<ReturnType<typeof captureProviderPrompt>> = [];
		faux.setResponses([
			(context) => {
				prompts.push(captureProviderPrompt(context));
				return fauxAssistantMessage("after compaction answer");
			},
		]);

		await session.prompt("after compaction");
		await session.agent.waitForIdle();

		expect(prompts).toHaveLength(1);
		const prompt = prompts[0];
		expect(prompt?.roles).toEqual(["user", "assistant", "user", "user", "user"]);
		expect(prompt?.roles.at(-1)).toBe("user");
		expect(prompt?.texts[0]).toBe("pre-compaction question");
		expect(prompt?.texts[1]).toBe("pre-compaction answer");
		expect(prompt?.texts[2]).toContain("compacted summary");
		expect(prompt?.texts[3]).toBe("after compaction");
		expect(prompt?.texts[4]).toContain("<working_state>");
	}, 30000);
});
