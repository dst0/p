import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantMessage, completeSimple, createAssistantMessageEventStream, type Model } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

describe("SDK cold compilation spend", () => {
  it("charges compilation before the first task and reuses the compiled cache without another call", async () => {
    const root = mkdtempSync(join(tmpdir(), "p-budget-compiler-"));
    const model: Model<"budget-compiler-test"> = {
      id: "compiler",
      name: "compiler",
      api: "budget-compiler-test",
      provider: "budget-compiler-test",
      baseUrl: "",
      reasoning: false,
      input: ["text"],
      cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };
    const auth = AuthStorage.inMemory();
    auth.setRuntimeApiKey(model.provider, "faux-unit-key");
    const registry = ModelRegistry.inMemory(auth);
    let calls = 0;
    registry.registerProvider(model.provider, {
      api: model.api,
      streamSimple: () => {
        calls++;
        const stream = createAssistantMessageEventStream();
        const message: AssistantMessage = {
          role: "assistant",
          api: model.api,
          provider: model.provider,
          model: model.id,
          timestamp: 0,
          content: [{ type: "text", text: "Compiler response" }],
          stopReason: "stop",
          usage: {
            input: 2,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 3,
            cost: { input: 0.000002, output: 0.000001, cacheRead: 0, cacheWrite: 0, total: 0.000003 },
          },
        };
        stream.push({ type: "done", reason: "stop", message });
        stream.end();
        return stream;
      },
    });
    try {
      mkdirSync(join(root, ".git"));
      writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
      const path = join(root, "AGENTS.md");
      const content = Array.from(
        { length: 90 },
        (_, index) => `## Rule ${index}\nPreserve invariant ${index}. ${"Required project detail. ".repeat(10)}\n`,
      ).join("\n");
      writeFileSync(path, content);
      const resourceLoader: ResourceLoader = {
        getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
        getSkills: () => ({ skills: [], diagnostics: [] }),
        getPrompts: () => ({ prompts: [], diagnostics: [] }),
        getThemes: () => ({ themes: [], diagnostics: [] }),
        getAgentsFiles: () => ({ agentsFiles: [{ path, content }] }),
        getSystemPrompt: () => undefined,
        getAppendSystemPrompt: () => [],
        extendResources: () => {},
        reload: async () => {},
      };
      const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
      const options = {
        cwd: root,
        agentDir: join(root, ".agent"),
        authStorage: auth,
        modelRegistry: registry,
        model,
        resourceLoader,
        settingsManager,
        completionMode: "implicit" as const,
        taskVerificationMode: "off" as const,
        projectInstructionCompilerIdentity: "unit-budget-compiler-v1",
        projectInstructionCompiler: async (request: Parameters<typeof createProjectInstructionCompilation>[0]) => {
          const response = await completeSimple(model, { messages: [] });
          if (response.stopReason === "error") throw new Error(response.errorMessage);
          return createProjectInstructionCompilation(request);
        },
        runBudget: { mode: "limited", unit: "requests", limit: 1 } as const,
      };
      const first = await createAgentSession({ ...options, sessionManager: SessionManager.inMemory(root) });
      try {
        expect(calls).toBe(1);
        expect(first.session.runBudget.snapshot()).toMatchObject({ requests: 1, tokens: 3, status: "exhausted" });
        const result = await (await first.session.agent.streamFn(model, { messages: [] })).result();
        expect(result.errorMessage).toMatch(/^budget_exhausted:/);
        expect(calls).toBe(1);
      } finally {
        first.session.dispose();
      }
      const second = await createAgentSession({ ...options, sessionManager: SessionManager.inMemory(root) });
      try {
        expect(calls).toBe(1);
        expect(second.session.runBudget.snapshot()).toMatchObject({ requests: 0, status: "ready" });
      } finally {
        second.session.dispose();
      }
    } finally {
      registry.unregisterProvider(model.provider);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
