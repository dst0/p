import { join } from "node:path";
import { registerFauxProvider } from "@dst0/p-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
} from "./project-instruction-delivery-fixture.ts";

const cleanupCallbacks: Array<() => void> = [];

afterEach(() => {
  while (cleanupCallbacks.length > 0) cleanupCallbacks.pop()?.();
  cleanupProjectInstructionModeWorkspaces();
});

describe("model switch project-instruction refresh failure", () => {
  it.each(["set", "cycle-scoped", "cycle-available"] as const)(
    "leaves model, persistence, prompt, and gate unchanged after %s refresh throws",
    async (method) => {
      const workspace = createProjectInstructionModeWorkspace();
      const faux = registerFauxProvider({
        models: [
          { id: "faux-1", name: "Faux One", reasoning: true, contextWindow: 100_000 },
          { id: "faux-2", name: "Faux Two", reasoning: true, contextWindow: 100_000 },
        ],
      });
      cleanupCallbacks.push(() => faux.unregister());
      const initialModel = faux.getModel("faux-1")!;
      const nextModel = faux.getModel("faux-2")!;
      const authStorage = AuthStorage.inMemory();
      authStorage.setRuntimeApiKey(initialModel.provider, "faux-key");
      const modelRegistry = ModelRegistry.inMemory(authStorage);
      modelRegistry.registerProvider(initialModel.provider, {
        baseUrl: initialModel.baseUrl,
        apiKey: "faux-key",
        api: faux.api,
        models: faux.models,
      });
      cleanupCallbacks.push(() => modelRegistry.unregisterProvider(initialModel.provider));
      const settingsManager = SettingsManager.inMemory();
      settingsManager.setDefaultModelAndProvider(initialModel.provider, initialModel.id);
      const sessionManager = SessionManager.inMemory(workspace.root);
      const { session } = await createAgentSession({
        cwd: workspace.root,
        agentDir: join(workspace.root, `.agent-model-failure-${method}`),
        model: initialModel,
        scopedModels: method === "cycle-scoped" ? [{ model: initialModel }, { model: nextModel }] : undefined,
        authStorage,
        modelRegistry,
        settingsManager,
        sessionManager,
        resourceLoader: workspace.resourceLoader,
        projectInstructionMode: "compiled",
        projectInstructionCompiler: workspace.compiler,
        projectInstructionCompilerIdentity: "model-switch-failure-test",
      });
      cleanupCallbacks.push(() => session.dispose());

      session._createRuntimeContextPrompts("edit security credential handling", session.systemPrompt);
      const originalGate = session._projectRuleGate;
      const originalInstructions = session._projectInstructions.state.current;
      const originalPrompt = session.systemPrompt;
      const originalThinkingLevel = session.thinkingLevel;
      const originalEntries = sessionManager.getEntries();
      vi.spyOn(session._projectInstructions, "refresh").mockRejectedValueOnce(new Error("compiler unavailable"));

      const switchModel = method === "set" ? session.setModel(nextModel) : session.cycleModel();
      await expect(switchModel).rejects.toThrow("compiler unavailable");

      expect(session.model).toBe(initialModel);
      expect(session.thinkingLevel).toBe(originalThinkingLevel);
      expect(session.systemPrompt).toBe(originalPrompt);
      expect(session._baseSystemPrompt).toBe(originalPrompt);
      expect(session._projectInstructions.state.current).toBe(originalInstructions);
      expect(session._projectRuleGate).toBe(originalGate);
      expect(sessionManager.getEntries()).toEqual(originalEntries);
      expect(settingsManager.getDefaultProvider()).toBe(initialModel.provider);
      expect(settingsManager.getDefaultModel()).toBe(initialModel.id);
    },
  );
});
