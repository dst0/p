import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AfterToolCallContext } from "@dst0/p-agent-core";
import type { Message } from "@dst0/p-ai";
import { fauxAssistantMessage, registerFauxProvider } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
  executeProjectInstructionReadRules,
  projectInstructionToolHookInput,
} from "./project-instruction-delivery-fixture.ts";
import { createTestResourceLoader } from "./utilities.ts";

interface CompilerModulePayload {
  id: string;
  constraints: Array<[string, string, string[], string]>;
}

interface CompilerPayload {
  modules: CompilerModulePayload[];
}

const cleanupCallbacks: Array<() => void> = [];
const extensionContext = {} as ExtensionContext;

afterEach(() => {
  while (cleanupCallbacks.length > 0) cleanupCallbacks.pop()?.();
});

describe("model-keyed project instruction compilation", () => {
  it.each(["set", "cycle-scoped", "cycle-available"] as const)(
    "refreshes instructions and the gate after a %s model switch",
    async (method) => {
      const workspace = mkdtempSync(join(tmpdir(), "p-project-model-switch-"));
      cleanupCallbacks.push(() => rmSync(workspace, { recursive: true, force: true }));
      mkdirSync(join(workspace, ".git"));
      writeFileSync(join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n");
      const agentsPath = join(workspace, "AGENTS.md");
      const agentsContent = Array.from(
        { length: 80 },
        (_, index) =>
          `## Model switch area ${index}\n\nWhen editing switch area ${index}, preserve its evidence. ${"detail ".repeat(12)}\n`,
      ).join("");
      writeFileSync(agentsPath, agentsContent);

      const faux = registerFauxProvider({
        models: [
          { id: "faux-1", name: "Faux One", reasoning: true, contextWindow: 100_000 },
          { id: "faux-2", name: "Faux Two", reasoning: true, contextWindow: 100_000 },
        ],
      });
      cleanupCallbacks.push(() => faux.unregister());
      const initialModel = faux.getModel("faux-1")!;
      const nextModel = faux.getModel("faux-2")!;
      const compilerModels: string[] = [];
      const compile = (messages: Message[], modelId: string) => {
        compilerModels.push(modelId);
        const userMessage = [...messages].reverse().find((message) => message.role === "user");
        if (!userMessage || typeof userMessage.content !== "string") throw new Error("Missing compiler payload");
        const payload = JSON.parse(userMessage.content) as CompilerPayload;
        if (payload.modules.some((module) => "wireOrdinal" in module)) throw new Error("Obsolete compiler payload");
        return fauxAssistantMessage('{"alwaysOn":[]}');
      };
      faux.setResponses([
        (context, _options, _state, model) => compile(context.messages, model.id),
        (context, _options, _state, model) => compile(context.messages, model.id),
      ]);

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
      const baseResourceLoader = createTestResourceLoader();
      const resourceLoader = {
        ...baseResourceLoader,
        getAgentsFiles: () => ({ agentsFiles: [{ path: agentsPath, content: agentsContent }] }),
      };
      const { session } = await createAgentSession({
        cwd: workspace,
        agentDir: join(workspace, ".agent"),
        model: initialModel,
        scopedModels: method === "cycle-scoped" ? [{ model: initialModel }, { model: nextModel }] : undefined,
        authStorage,
        modelRegistry,
        settingsManager: SettingsManager.inMemory(),
        sessionManager: SessionManager.inMemory(workspace),
        resourceLoader,
        completionMode: "implicit",
        taskVerificationMode: "off",
      });
      cleanupCallbacks.push(() => session.dispose());

      const initialHash = session._projectInstructions.state.current?.manifest.inputHash;
      const initialPrompt = session.systemPrompt;
      const oldTurn = session._createRuntimeContextPrompts("edit model switch area 0", session.systemPrompt);
      const oldLinks = oldTurn.projectRuleLinks ?? [];
      expect(oldLinks.length).toBeGreaterThan(0);
      expect(session._projectRuleGate).toBeDefined();
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/model.ts" })),
      ).resolves.toMatchObject({ block: true });
      const staleLinks = session._projectRuleGate?.batches.find((batch) => !batch.satisfied)?.links ?? [];
      expect(staleLinks).toEqual(expect.arrayContaining(oldLinks));
      const staleReadCall = projectInstructionToolHookInput("read_rules", { links: staleLinks });
      await expect(session.agent.beforeToolCall?.(staleReadCall)).resolves.toBeUndefined();
      const readRules = session.getToolDefinition("read_rules");
      expect(readRules).toBeDefined();
      const staleReadResult = await readRules!.execute(
        staleReadCall.toolCall.id,
        { links: staleLinks },
        undefined,
        undefined,
        extensionContext,
      );
      expect(session._projectRuleReadStages.has(staleReadCall.toolCall.id)).toBe(true);
      await session.steer("edit model switch area 1");
      const queuedUser = session.agent.steeringQueue.drain().find((message) => message.role === "user");
      expect(queuedUser).toBeDefined();
      expect(session._queuedProjectRuleGates.has(queuedUser!)).toBe(true);

      if (method === "set") await session.setModel(nextModel);
      else await session.cycleModel();

      const switchedHash = session._projectInstructions.state.current?.manifest.inputHash;
      expect(compilerModels).toEqual(["faux-1", "faux-2"]);
      expect(switchedHash).not.toBe(initialHash);
      expect(session.systemPrompt).not.toBe(initialPrompt);
      expect(session.systemPrompt).toContain(switchedHash);
      expect(session._projectRuleGate).toBeUndefined();
      expect(session._projectRuleReadStages.size).toBe(0);
      expect(session._queuedProjectRuleGates.has(queuedUser!)).toBe(false);
      const nextTurn = session._createRuntimeContextPrompts("edit model switch area 0", session.systemPrompt);
      expect(nextTurn.projectRuleLinks).toBeDefined();
      await session.agent.afterToolCall?.({
        ...staleReadCall,
        result: staleReadResult,
        isError: false,
        context: { messages: [] },
      } as unknown as AfterToolCallContext);
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/model.ts" })),
      ).resolves.toMatchObject({ block: true });
      await executeProjectInstructionReadRules(session, nextTurn.projectRuleLinks ?? []);
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/model.ts" })),
      ).resolves.toBeUndefined();
    },
  );
});
