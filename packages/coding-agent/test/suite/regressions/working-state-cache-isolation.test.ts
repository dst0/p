import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../../../src/core/auth-storage.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";
import type { ExtensionAPI } from "../../../src/index.ts";

/**
 * Regression: working state must NOT be embedded in the system prompt.
 *
 * If the working state (which changes every turn) is inside the system prompt,
 * the entire prompt prefix changes on every turn. This breaks prefix-based KV
 * cache reuse (e.g. llama.cpp cache_prompt, Anthropic/OpenAI prompt caching)
 * because the cache can only reuse tokens from the start of the prompt that
 * match the previous request.
 *
 * The working state is injected as a custom message at the END of the messages,
 * so the large, stable prefix (system prompt + conversation) stays cacheable.
 */
describe("working state cache isolation", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

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

		cleanups.push(async () => {
			await runtime.dispose();
			faux.unregister();
			if (existsSync(tempDir)) {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});

		return { runtime, session: runtime.session, faux };
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
});
