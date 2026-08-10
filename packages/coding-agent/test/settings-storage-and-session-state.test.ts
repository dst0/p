import { describe, expect, it, vi } from "vitest";
import { AgentSessionState } from "../src/core/agent-session/agentsessionstate.ts";
import {
  do_loadFromStorage,
  do_migrateSettings,
  do_tryLoadFromStorage,
} from "../src/core/settings-manager/settingsmanager-methods/storage-loading.ts";
import type { SettingsStorage } from "../src/core/settings-manager/types.ts";

function storage(content: string | undefined): SettingsStorage {
  return {
    withLock: (_scope, callback) => {
      callback(content);
    },
  };
}

describe("split settings storage loading", () => {
  it("loads commented JSON and isolates parse failures", () => {
    expect(do_loadFromStorage(storage('{ // comment\n "quietStartup": true }'), "global")).toEqual({
      quietStartup: true,
    });
    expect(do_loadFromStorage(storage('{"quietStartup":true}'), "project", false)).toEqual({});
    const failed = do_tryLoadFromStorage(storage("{"), "global");
    expect(failed.settings).toEqual({});
    expect(failed.error).toBeInstanceOf(Error);
  });

  it("migrates legacy queue, transport, skill, and retry settings", () => {
    const migrated = do_migrateSettings({
      queueMode: "all",
      websockets: true,
      skills: { enableSkillCommands: false, customDirectories: ["/skills"] },
      retry: { maxDelayMs: 12_000, provider: null },
    });
    expect(migrated).toMatchObject({
      steeringMode: "all",
      transport: "websocket",
      enableSkillCommands: false,
      skills: ["/skills"],
      retry: { provider: { maxRetryDelayMs: 12_000 } },
    });
    expect(migrated).not.toHaveProperty("queueMode");
    expect(migrated).not.toHaveProperty("websockets");
  });
});

describe("split agent session state", () => {
  it("exposes the state collaborators and retry attempt", () => {
    const agent = {
      completionMode: "normal",
      sessionId: "",
      state: {
        isStreaming: false,
        messages: [],
        model: undefined,
        systemPrompt: "system",
        thinkingLevel: "medium",
      },
    };
    const sessionManager = {
      getSessionFile: vi.fn(() => undefined),
      getSessionId: vi.fn(() => "session"),
      getSessionName: vi.fn(() => "named"),
    };
    const resourceLoader = { getPrompts: vi.fn(() => ({ prompts: [] })) };
    const modelRegistry = { id: "registry" };
    const state = new AgentSessionState({
      agent,
      cwd: "/project",
      modelRegistry,
      resourceLoader,
      sessionManager,
      settingsManager: { getRetryEnabled: vi.fn(() => true) },
    } as never);
    state._retryAttempt = 2;
    expect(state.modelRegistry).toBe(modelRegistry);
    expect(state.state).toBe(agent.state);
    expect(state.retryAttempt).toBe(2);
    expect(state.resourceLoader).toBe(resourceLoader);
    expect(state.isPlanMode).toBe(false);
    expect(state.sessionName).toBe("named");
    expect(state.autoRetryEnabled).toBe(true);
  });
});
