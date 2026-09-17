import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
} from "../../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import type { ExtensionAPI } from "../../src/index.ts";

describe("AgentSessionRuntime coverage edges", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
  });

  async function createRuntime() {
    const root = mkdtempSync(join(tmpdir(), "p-runtime-coverage-"));
    const faux = registerFauxProvider();
    faux.setResponses([fauxAssistantMessage("reply"), fauxAssistantMessage("reply 2")]);
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({
        cwd,
        agentDir: root,
        authStorage,
        resourceLoaderOptions: {
          extensionFactories: [
            (pi: ExtensionAPI) => {
              pi.registerProvider(faux.getModel().provider, {
                baseUrl: faux.getModel().baseUrl,
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
                })),
              });
            },
          ],
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
        },
      });
      const result = await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        model: faux.getModel(),
        projectInstructionMode: "off",
        taskVerificationMode: "off",
      });
      return { ...result, services, diagnostics: services.diagnostics };
    };
    const runtime = await createAgentSessionRuntime(createRuntime, {
      cwd: root,
      agentDir: root,
      sessionManager: SessionManager.create(root),
    });
    await runtime.session.bindExtensions({});
    cleanups.push(async () => {
      await runtime.dispose();
      faux.unregister();
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    });
    return { runtime, root };
  }

  it("hydrates the replacement agent state from a new-session setup", async () => {
    const { runtime } = await createRuntime();
    const result = await runtime.newSession({
      setup: async (sessionManager) => {
        sessionManager.appendMessage({
          role: "user",
          content: [{ type: "text", text: "prepared" }],
          timestamp: Date.now(),
        });
      },
    });

    expect(result.cancelled).toBe(false);
    expect(runtime.session.messages).toHaveLength(1);
    expect(runtime.session.messages[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "prepared" }],
    });
  });

  it("creates a parent session when forking before the first user entry", async () => {
    const { runtime, root } = await createRuntime();
    const source = SessionManager.create(root, runtime.session.sessionManager.getSessionDir());
    source.appendMessage({
      role: "user",
      content: [{ type: "text", text: "fork me" }],
      timestamp: Date.now(),
    });
    source.appendMessage(fauxAssistantMessage("source reply"));
    await runtime.switchSession(source.getSessionFile()!);
    const userMessage = runtime.session.getUserMessagesForForking()[0];
    const previousSessionFile = runtime.session.sessionFile;
    expect(userMessage).toBeDefined();
    expect(previousSessionFile).toBeDefined();

    await expect(runtime.fork(userMessage!.entryId)).resolves.toEqual({ cancelled: false, selectedText: "fork me" });
    expect(runtime.session.sessionManager.getHeader()?.parentSession).toBe(previousSessionFile);
  });

  it("imports a persisted JSONL session and replaces the runtime", async () => {
    const { runtime, root } = await createRuntime();
    const sourceCwd = join(root, "import-source");
    const sourceSessionDir = join(root, "import-sessions");
    mkdirSync(sourceCwd, { recursive: true });
    const source = SessionManager.create(sourceCwd, sourceSessionDir);
    source.appendMessage({
      role: "user",
      content: [{ type: "text", text: "imported user" }],
      timestamp: Date.now(),
    });
    source.appendMessage(fauxAssistantMessage("imported assistant"));
    const sourceFile = source.getSessionFile();
    expect(sourceFile).toBeTruthy();

    const result = await runtime.importFromJsonl(sourceFile!);

    expect(result).toEqual({ cancelled: false });
    expect(realpathSync(runtime.cwd)).toBe(realpathSync(sourceCwd));
    expect(runtime.session.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: [{ type: "text", text: "imported user" }] }),
        expect.objectContaining({ role: "assistant", content: [{ type: "text", text: "imported assistant" }] }),
      ]),
    );
  });
});
