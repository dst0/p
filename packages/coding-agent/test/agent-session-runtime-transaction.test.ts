import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
} from "../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";

describe("AgentSessionRuntime replacement transaction", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
  });

  async function createRuntimeHost() {
    const root = mkdtempSync(join(tmpdir(), "p-runtime-transaction-"));
    const faux = registerFauxProvider();
    faux.setResponses(Array.from({ length: 8 }, (_, index) => fauxAssistantMessage(`reply ${index}`)));
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");
    const createdSessions: AgentSession[] = [];
    const activeExtensionInstances = new Set<number>();
    const lifecycleEvents: string[] = [];
    let extensionInstance = 0;
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({
        cwd,
        agentDir: root,
        authStorage,
        resourceLoaderOptions: {
          extensionFactories: [
            (api) => {
              const instance = ++extensionInstance;
              api.on("session_start", () => {
                lifecycleEvents.push(`start:${instance}`);
                activeExtensionInstances.add(instance);
              });
              api.on("session_shutdown", () => {
                lifecycleEvents.push(`shutdown:${instance}`);
                activeExtensionInstances.delete(instance);
              });
            },
          ],
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
        },
      });
      const created = await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        model: faux.getModel(),
        projectInstructionMode: "off",
        taskVerificationMode: "off",
      });
      createdSessions.push(created.session);
      return {
        ...created,
        services,
        diagnostics: services.diagnostics,
      };
    };
    const runtimeHost = await createAgentSessionRuntime(createRuntime, {
      cwd: root,
      agentDir: root,
      sessionManager: SessionManager.inMemory(root),
    });
    await runtimeHost.session.bindExtensions({});
    cleanups.push(async () => {
      await runtimeHost.dispose();
      faux.unregister();
      rmSync(root, { recursive: true, force: true });
    });
    return { activeExtensionInstances, createdSessions, lifecycleEvents, runtimeHost };
  }

  async function expectOldSessionUsable(
    runtimeHost: Awaited<ReturnType<typeof createRuntimeHost>>["runtimeHost"],
    old: AgentSession,
  ) {
    expect(runtimeHost.session === old).toBe(true);
    expect(() => old.extensionRunner.createContext()).not.toThrow();
    await old.prompt("still usable");
    expect(old.messages.at(-1)).toMatchObject({ role: "assistant" });
  }

  function expectReplacementDisposed(createdSessions: AgentSession[]) {
    const replacement = createdSessions.at(-1);
    expect(replacement).toBeDefined();
    expect(() => replacement!.extensionRunner.createContext().cwd).toThrow(/stale/i);
  }

  it("rolls back when new-session setup rejects", async () => {
    const { activeExtensionInstances, createdSessions, lifecycleEvents, runtimeHost } = await createRuntimeHost();
    const old = runtimeHost.session;
    lifecycleEvents.length = 0;

    await expect(
      runtimeHost.newSession({
        setup: async () => {
          throw new Error("setup rejected");
        },
      }),
    ).rejects.toThrow("setup rejected");
    expectReplacementDisposed(createdSessions);
    expect([...activeExtensionInstances]).toEqual([1]);
    expect(lifecycleEvents).toEqual([]);
    await expectOldSessionUsable(runtimeHost, old);
  });

  it("does not shut down a replacement when rebind rejects before extension startup", async () => {
    const { activeExtensionInstances, createdSessions, lifecycleEvents, runtimeHost } = await createRuntimeHost();
    const old = runtimeHost.session;
    lifecycleEvents.length = 0;
    runtimeHost.setRebindSession(async (session) => {
      if (session !== old) throw new Error("rebind rejected before startup");
      await session.bindExtensions({});
    });

    await expect(runtimeHost.newSession()).rejects.toThrow("rebind rejected before startup");
    expectReplacementDisposed(createdSessions);
    expect([...activeExtensionInstances]).toEqual([1]);
    expect(lifecycleEvents).toEqual(["shutdown:1", "start:1"]);
    await expectOldSessionUsable(runtimeHost, old);
  });

  it("rolls back and rebinds the old runtime when replacement rebind rejects", async () => {
    const { activeExtensionInstances, createdSessions, lifecycleEvents, runtimeHost } = await createRuntimeHost();
    const old = runtimeHost.session;
    lifecycleEvents.length = 0;
    let reboundOld = 0;
    runtimeHost.setRebindSession(async (session) => {
      await session.bindExtensions({});
      if (session !== old) throw new Error("rebind rejected");
      reboundOld++;
    });

    await expect(runtimeHost.newSession()).rejects.toThrow("rebind rejected");
    expectReplacementDisposed(createdSessions);
    expect([...activeExtensionInstances]).toEqual([1]);
    expect(lifecycleEvents).toEqual(["shutdown:1", "start:2", "shutdown:2", "start:1"]);
    expect(reboundOld).toBe(1);
    await expectOldSessionUsable(runtimeHost, old);
  });

  it("rolls back and rebinds the old runtime when withSession rejects", async () => {
    const { activeExtensionInstances, createdSessions, lifecycleEvents, runtimeHost } = await createRuntimeHost();
    const old = runtimeHost.session;
    lifecycleEvents.length = 0;
    let reboundOld = 0;
    runtimeHost.setRebindSession(async (session) => {
      await session.bindExtensions({});
      if (session === old) reboundOld++;
    });

    await expect(
      runtimeHost.newSession({
        withSession: async () => {
          throw new Error("withSession rejected");
        },
      }),
    ).rejects.toThrow("withSession rejected");
    expectReplacementDisposed(createdSessions);
    expect([...activeExtensionInstances]).toEqual([1]);
    expect(lifecycleEvents).toEqual(["shutdown:1", "start:2", "shutdown:2", "start:1"]);
    expect(reboundOld).toBe(1);
    await expectOldSessionUsable(runtimeHost, old);
  });

  it("restarts old extension bindings after withSession rejects without a host rebind callback", async () => {
    const { activeExtensionInstances, createdSessions, lifecycleEvents, runtimeHost } = await createRuntimeHost();
    const old = runtimeHost.session;
    lifecycleEvents.length = 0;

    await expect(
      runtimeHost.newSession({
        withSession: async () => {
          throw new Error("withSession rejected without rebind");
        },
      }),
    ).rejects.toThrow("withSession rejected without rebind");
    expectReplacementDisposed(createdSessions);
    expect([...activeExtensionInstances]).toEqual([1]);
    expect(lifecycleEvents).toEqual(["shutdown:1", "start:1"]);
    await expectOldSessionUsable(runtimeHost, old);
  });
});
