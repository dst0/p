import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall, type Model, registerFauxProvider } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import type { TaskVerificationSelection } from "../src/core/task-verification/verification-policy.ts";
import { formatVerificationTierBadge } from "../src/modes/interactive/components/footer-verification-badge.ts";
import { createTestResourceLoader } from "./utilities.ts";

interface FirstRequest {
  systemPromptChars: number;
  toolNames: string[];
  toolSchemaChars: number;
  session: AgentSession;
}

describe("adaptive verification through createAgentSession", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  function setup() {
    const root = mkdtempSync(join(tmpdir(), "p-adaptive-sdk-"));
    const faux = registerFauxProvider({});
    cleanups.push(() => {
      faux.unregister();
      rmSync(root, { recursive: true, force: true });
    });
    const model = faux.getModel();
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(model.provider, "faux-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    modelRegistry.registerProvider(model.provider, {
      baseUrl: model.baseUrl,
      apiKey: "faux-key",
      api: faux.api,
      models: faux.models.map((registered) => ({ ...registered })),
    });
    const create = async (
      sessionManager: SessionManager,
      taskVerificationMode?: TaskVerificationSelection,
      tools?: string[],
    ) => {
      const { session } = await createAgentSession({
        cwd: root,
        agentDir: root,
        model,
        authStorage,
        modelRegistry,
        settingsManager: SettingsManager.inMemory({ compaction: { keepRecentTokens: 10 } }),
        sessionManager,
        resourceLoader: createTestResourceLoader(),
        projectInstructionMode: "legacy",
        taskVerificationMode,
        tools,
      });
      cleanups.push(() => session.dispose());
      return session;
    };
    return { root, faux, create };
  }

  async function firstRequest(
    taskVerificationMode?: TaskVerificationSelection,
    tools?: string[],
  ): Promise<FirstRequest> {
    const { root, faux, create } = setup();
    let captured: Omit<FirstRequest, "session"> | undefined;
    faux.setResponses([
      (context: Context) => {
        const toolSchemas = (context.tools ?? []).map(({ name, description, parameters }) => ({
          name,
          description,
          parameters,
        }));
        captured = {
          systemPromptChars: context.systemPrompt?.length ?? 0,
          toolNames: toolSchemas.map((tool) => tool.name),
          toolSchemaChars: JSON.stringify(toolSchemas).length,
        };
        return fauxAssistantMessage("391");
      },
      ...(taskVerificationMode === "strict"
        ? [
            fauxAssistantMessage(
              fauxToolCall("record_task_verification", {
                action: "record_completion_checklist",
                completion_checklist: ["The answer states 391"],
                verification_scope: "response_only",
              }),
              { stopReason: "toolUse" },
            ),
            fauxAssistantMessage(fauxToolCall("finish_work", { status: "success", summary: "391" }), {
              stopReason: "toolUse",
            }),
          ]
        : []),
    ]);
    const session = await create(SessionManager.inMemory(root), taskVerificationMode, tools);
    await session.prompt("What is 17*23? Reply with just the number.");
    if (!captured) throw new Error("No provider request was captured");
    expect(faux.getPendingResponseCount()).toBe(0);
    expect(session.state.errorMessage).toBeUndefined();
    return { ...captured, session };
  }

  it("makes verification off lighter than LIGHT: no controller, ceremony, or finish_work", async () => {
    const light = await firstRequest();
    const off = await firstRequest("off");

    expect(off.toolNames).toEqual(["read", "bash", "edit", "write", "semantic_search", "tool_search"]);
    expect(off.session.agent.completionMode).toBe("implicit");
    expect(off.session.getVerificationTierStatus()).toMatchObject({ policy: "off", active: false });
    expect(formatVerificationTierBadge(off.session.getVerificationTierStatus())?.text).toBe("OFF");
    expect(off.systemPromptChars + off.toolSchemaChars).toBeLessThan(light.systemPromptChars + light.toolSchemaChars);
  });

  it("reports a read-only allowlist as unverified and completes it on the text answer", async () => {
    const readOnly = await firstRequest(undefined, ["read"]);

    expect(readOnly.toolNames).toEqual(["read"]);
    expect(readOnly.session.agent.completionMode).toBe("implicit");
    expect(readOnly.session.getVerificationTierStatus()).toMatchObject({ policy: "auto", active: false });
    expect(formatVerificationTierBadge(readOnly.session.getVerificationTierStatus())?.text).toBe("OFF");

    const { root, create } = setup();
    const strict = await create(SessionManager.inMemory(root), "strict", ["read"]);
    expect(strict.agent.completionMode).toBe("explicit_finish");
    expect(strict.getVerificationTierStatus()).toMatchObject({ policy: "strict", active: false });
  });

  it("defaults sessions to the LIGHT tier with implicit completion and no finish_work ceremony", async () => {
    const { root, create } = setup();
    const session = await create(SessionManager.inMemory(root));

    expect(session.getVerificationTierStatus()).toMatchObject({ policy: "auto", tier: "light", reason: "default" });
    expect(session.agent.completionMode).toBe("implicit");
    expect(session.systemPrompt).not.toContain("- finish_work:");
    expect(session.systemPrompt).toContain("- begin_code_task:");
    expect(session._taskVerificationMode).toBe("off");
  });

  it("keeps the default LIGHT first request small compared with forced STRICT", async () => {
    const light = await firstRequest();
    const strict = await firstRequest("strict");

    expect(light.toolNames).toEqual([
      "read",
      "bash",
      "edit",
      "write",
      "semantic_search",
      "tool_search",
      "begin_code_task",
    ]);
    expect(strict.toolNames).toEqual(
      expect.arrayContaining(["process", "sleep", "update_session_state", "record_task_verification", "finish_work"]),
    );
    expect(light.systemPromptChars).toBeLessThan(5_000);
    expect(light.toolSchemaChars).toBeLessThan(7_000);
    const lightTotal = light.systemPromptChars + light.toolSchemaChars;
    const strictTotal = strict.systemPromptChars + strict.toolSchemaChars;
    expect(lightTotal).toBeLessThan(strictTotal * 0.4);
  });

  it("restores the escalated tier, tools, and owed ledger when a compacted session is resumed", async () => {
    const { root, faux, create } = setup();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.js"), "export const value = 1;\n");
    const sessionDir = join(root, "sessions");
    const original = SessionManager.create(root, sessionDir);
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("write", { path: "src/a.js", content: "export const value = 2;\n" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxToolCall("finish_work", { status: "partial", summary: "Edited src/a.js." }), {
        stopReason: "toolUse",
      }),
    ]);
    const first: AgentSession = await create(original);
    await first.prompt("Look at src/a.js.");
    first.agent.state.model = undefined as unknown as Model<string>;
    await first.compact();
    const sessionFile = original.getSessionFile();
    first.dispose();
    if (!sessionFile) throw new Error("Expected a persisted session file");
    expect(original.getEntries().some((entry) => entry.type === "compaction")).toBe(true);

    const resumed = await create(SessionManager.open(sessionFile, sessionDir));

    expect(resumed.getVerificationTierStatus()).toMatchObject({
      policy: "auto",
      tier: "strict",
      reason: "effect_source",
      trigger: "src/a.js",
    });
    expect(resumed.getActiveToolNames()).toEqual(expect.arrayContaining(["record_task_verification", "process"]));
    expect(resumed.getActiveToolNames()).not.toContain("begin_code_task");
    expect(resumed.agent.completionMode).toBe("explicit_finish");
    expect(resumed._taskVerificationRuntime?.controller.state.taskOwnedPaths).toEqual(["src/a.js"]);

    faux.setResponses([
      fauxAssistantMessage("Still verifying."),
      fauxAssistantMessage(fauxToolCall("finish_work", { status: "partial", summary: "Verification pending." }), {
        stopReason: "toolUse",
      }),
    ]);
    await resumed.prompt("continue");
    expect(faux.getPendingResponseCount()).toBe(0);
  });

  it("keeps an explicit tool allowlist and adds only verification controls per tier", async () => {
    const { root, faux, create } = setup();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.js"), "export const value = 1;\n");
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("write", { path: "src/a.js", content: "export const value = 2;\n" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxToolCall("finish_work", { status: "partial", summary: "Edited src/a.js." }), {
        stopReason: "toolUse",
      }),
    ]);
    const session = await create(SessionManager.inMemory(root), undefined, ["read", "edit", "write"]);

    expect(session.getActiveToolNames()).toEqual(["read", "edit", "write", "begin_code_task"]);
    await session.prompt("Look at src/a.js.");

    expect(session.getActiveToolNames()).toEqual(["read", "edit", "write", "record_task_verification"]);
    expect(session.getVerificationTierStatus()?.tier).toBe("strict");
  });
});
