import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@dst0/p-agent-core";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@dst0/p-ai";
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
});
