import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, AgentTool } from "@dst0/p-agent-core";
import { fauxAssistantMessage, fauxToolCall, type Message, registerFauxProvider, type TextContent } from "@dst0/p-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createTestResourceLoader } from "./utilities.ts";

describe("createAgentSession model switching", () => {
	let tempDir: string | undefined;
	const cleanupFns: Array<() => void> = [];

	afterEach(() => {
		while (cleanupFns.length > 0) {
			cleanupFns.pop()?.();
		}
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
			tempDir = undefined;
		}
	});

	it("uses a model selected during the current request on the next internal turn", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-sdk-model-switch-"));
		const faux = registerFauxProvider({
			models: [
				{ id: "faux-1", name: "Faux One", reasoning: true },
				{ id: "faux-2", name: "Faux Two", reasoning: true },
			],
		});
		cleanupFns.push(() => faux.unregister());

		const initialModel = faux.getModel("faux-1")!;
		const nextModel = faux.getModel("faux-2")!;
		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(initialModel.provider, "faux-key");
		const modelRegistry = ModelRegistry.inMemory(authStorage);
		modelRegistry.registerProvider(initialModel.provider, {
			baseUrl: initialModel.baseUrl,
			apiKey: "faux-key",
			api: faux.api,
			models: faux.models.map((model) => ({
				id: model.id,
				name: model.name,
				api: model.api,
				reasoning: model.reasoning,
				input: model.input,
				cost: model.cost,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				baseUrl: model.baseUrl,
			})),
		});
		cleanupFns.push(() => modelRegistry.unregisterProvider(initialModel.provider));

		const noopTool: AgentTool = {
			name: "noop",
			label: "Noop",
			description: "No-op tool",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
		};

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			model: initialModel,
			thinkingLevel: "high",
			authStorage,
			modelRegistry,
			settingsManager: SettingsManager.inMemory(),
			sessionManager: SessionManager.inMemory(tempDir),
			resourceLoader: createTestResourceLoader(),
			customTools: [noopTool],
			completionMode: "implicit",
		});
		cleanupFns.push(() => session.dispose());

		const requestedModels: string[] = [];
		faux.setResponses([
			async (_context, _options, _state, model) => {
				requestedModels.push(model.id);
				await session.setModel(nextModel);
				return fauxAssistantMessage(fauxToolCall("noop", {}), { stopReason: "toolUse" });
			},
			(_context, _options, _state, model) => {
				requestedModels.push(model.id);
				return fauxAssistantMessage("done");
			},
		]);

		await session.prompt("start");

		expect(requestedModels).toEqual(["faux-1", "faux-2"]);
		expect(session.model?.id).toBe("faux-2");
		expect(session.thinkingLevel).toBe("high");
	});

	it("keeps raw tool results in the SDK provider context before compaction", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-sdk-raw-tool-context-"));
		const faux = registerFauxProvider({
			models: [{ id: "faux-raw", name: "Faux Raw", reasoning: true, contextWindow: 100_000 }],
		});
		cleanupFns.push(() => faux.unregister());
		const model = faux.getModel("faux-raw")!;
		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(model.provider, "faux-key");
		const modelRegistry = ModelRegistry.inMemory(authStorage);
		modelRegistry.registerProvider(model.provider, {
			baseUrl: model.baseUrl,
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
				baseUrl: registeredModel.baseUrl,
			})),
		});
		cleanupFns.push(() => modelRegistry.unregisterProvider(model.provider));
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			model,
			authStorage,
			modelRegistry,
			settingsManager: SettingsManager.inMemory(),
			sessionManager: SessionManager.inMemory(tempDir),
			resourceLoader: createTestResourceLoader(),
			noTools: "all",
			completionMode: "implicit",
		});
		cleanupFns.push(() => session.dispose());
		const longOutput = Array.from(
			{ length: 360 },
			(_, index) => `sdk-raw-line-${index.toString().padStart(4, "0")} ${"x".repeat(80)}`,
		).join("\n");
		const rawToolResult: AgentMessage = {
			role: "toolResult",
			toolCallId: "call-sdk-read",
			toolName: "read",
			content: [{ type: "text", text: longOutput }],
			isError: false,
			timestamp: Date.now() - 500,
		};
		session.agent.state.messages = [
			{
				role: "user",
				content: [{ type: "text", text: "inspect the SDK tool output" }],
				timestamp: Date.now() - 1000,
			},
			rawToolResult,
		];
		let providerPromptText = "";
		faux.setResponses([
			(context: { messages: Message[] }) => {
				providerPromptText = context.messages
					.map((message) => {
						const content = message.content;
						if (typeof content === "string") return content;
						return content
							.filter((part): part is TextContent => part.type === "text")
							.map((part) => part.text)
							.join("\n");
					})
					.join("\n");
				return fauxAssistantMessage("ok");
			},
		]);

		await session.prompt("continue");

		expect(providerPromptText).not.toContain("[Tool result stubbed");
		expect(providerPromptText).not.toContain('session_recall("tool-result:call-sdk-read"');
		expect(providerPromptText).toContain("sdk-raw-line-0100");
	});
});
