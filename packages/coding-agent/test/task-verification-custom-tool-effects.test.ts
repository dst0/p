import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@dst0/p-ai";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { REQUIREMENT_AUDIT_TOOL_NAME, TASK_VERIFICATION_TOOL_NAME } from "../src/core/task-verification.ts";
import { createAgentSession, type ToolDefinition, type ToolEffectDeclaration } from "../src/index.ts";

function customTool(name: string, effect?: ToolEffectDeclaration, visible = true): ToolDefinition {
  return {
    name,
    label: name,
    description: `Execute ${name}`,
    promptSnippet: visible ? `${name}(): execute the custom operation` : undefined,
    parameters: Type.Object({}),
    effect,
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
  };
}

describe("task verification custom tool effects", () => {
  let cwd: string;
  let agentDir: string;

  beforeEach(() => {
    cwd = join(tmpdir(), `p-tool-effects-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    agentDir = join(cwd, "agent");
    mkdirSync(agentDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  async function createCustomSession(tool: ToolDefinition) {
    return createAgentSession({
      cwd,
      agentDir,
      model: getModel("anthropic", "claude-sonnet-4-5")!,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager: SettingsManager.create(cwd, agentDir),
      projectInstructionMode: "off",
      noTools: "builtin",
      customTools: [tool],
    });
  }

  it.each([
    ["send_email", { kind: "external_write", risk: "high", domains: ["network_send"] }],
    ["deploy", { kind: "external_write", risk: "high", domains: ["deployment", "publication"] }],
    ["update_ticket", { kind: "external_write", risk: "normal", domains: ["network_send", "persistent_state"] }],
    ["opaque_writer", undefined],
  ] as const)("activates evidence verification for custom mutator %s", async (name, effect) => {
    const { session } = await createCustomSession(customTool(name, effect));
    try {
      expect(session.getActiveToolNames()).toContain(name);
      expect(session.getActiveToolNames()).toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getAllTools().map((tool) => tool.name)).not.toContain(REQUIREMENT_AUDIT_TOOL_NAME);
      expect(session._taskVerificationMode).toBe("evidence");
      expect(session.agent.state.tools.find((tool) => tool.name === name)?.effect).toMatchObject(
        effect ?? { kind: "unknown", risk: "high", source: "default_unknown" },
      );
    } finally {
      session.dispose();
    }
  });

  it("keeps verification dormant for an explicitly read-only custom tool", async () => {
    const { session } = await createCustomSession(
      customTool("lookup_ticket", { kind: "read", risk: "normal", domains: [] }),
    );
    try {
      expect(session.getActiveToolNames()).toContain("lookup_ticket");
      expect(session.getAllTools().map((tool) => tool.name)).not.toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session._taskVerificationMode).toBe("off");
      expect(session.agent.state.tools.find((tool) => tool.name === "lookup_ticket")?.effect).toEqual({
        kind: "read",
        risk: "normal",
        domains: [],
        source: "declared",
      });
    } finally {
      session.dispose();
    }
  });

  it.each(["off", "evidence"] as const)(
    "rejects reserved custom verification names while configured %s is inactive",
    async (taskVerificationMode) => {
      for (const name of [TASK_VERIFICATION_TOOL_NAME, REQUIREMENT_AUDIT_TOOL_NAME]) {
        await expect(
          createAgentSession({
            cwd,
            agentDir,
            model: getModel("anthropic", "claude-sonnet-4-5")!,
            sessionManager: SessionManager.inMemory(cwd),
            settingsManager: SettingsManager.create(cwd, agentDir),
            projectInstructionMode: "off",
            noTools: "builtin",
            includeAllExtensionTools: false,
            taskVerificationMode,
            customTools: [customTool(name, { kind: "read", risk: "normal" })],
          }),
        ).rejects.toThrow(`${name} is reserved by the built-in verification controller`);
      }
    },
  );

  it("activates a dormant controller for a hidden external mutator and keeps it after the effect", async () => {
    const lookup = customTool("lookup_ticket", { kind: "read", risk: "normal" });
    const sendEmail = customTool(
      "send_email",
      { kind: "external_write", risk: "high", domains: ["network_send"] },
      false,
    );
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      model: getModel("anthropic", "claude-sonnet-4-5")!,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager: SettingsManager.create(cwd, agentDir),
      projectInstructionMode: "off",
      noTools: "builtin",
      includeAllExtensionTools: false,
      customTools: [lookup, sendEmail],
    });
    try {
      expect(session._taskVerificationMode).toBe("off");
      expect(session.getActiveToolNames()).toEqual(["lookup_ticket"]);

      session.setActiveToolsByName(["lookup_ticket", "send_email"]);
      expect(session._taskVerificationMode).toBe("evidence");
      expect(session.getActiveToolNames()).toContain(TASK_VERIFICATION_TOOL_NAME);

      const sendTool = session.agent.state.tools.find((tool) => tool.name === "send_email")!;
      expect(sendTool.effect).toMatchObject({ kind: "external_write", source: "declared" });
      const args = {};
      const toolCall = { type: "toolCall" as const, id: "send-1", name: "send_email", arguments: args };
      expect(
        (
          await session.agent.beforeToolCall?.({
            assistantMessage: {} as never,
            toolCall,
            args,
            effect: sendTool.effect as never,
            context: {} as never,
          })
        )?.block,
      ).not.toBe(true);
      const effectResult = await session.agent.afterToolCall?.({
        assistantMessage: {} as never,
        toolCall,
        args,
        effect: sendTool.effect as never,
        result: { content: [{ type: "text", text: "sent" }], details: {} },
        isError: false,
        context: {} as never,
      });
      expect(session._taskVerificationRuntime?.controller.currentState.mutationRevision).toBe(1);
      expect(session._taskVerificationRuntime?.controller.currentState.externalEffectReceipts).toHaveLength(1);
      const effectText =
        effectResult?.content
          ?.filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text)
          .join("\n") ?? "";
      expect(effectText).toContain("Verification evidence handle:");
      const evidenceRef = effectText.match(/Verification evidence handle: (verification-evidence-\d+)/u)?.[1];
      expect(evidenceRef).toBeTruthy();

      session.setActiveToolsByName(["lookup_ticket"]);
      expect(session._taskVerificationMode).toBe("evidence");
      expect(session.getActiveToolNames()).toContain(TASK_VERIFICATION_TOOL_NAME);

      const verification = session.getToolDefinition(TASK_VERIFICATION_TOOL_NAME)!;
      const readyResult = await verification.execute(
        "ready",
        {
          action: "ready_to_finish",
          acceptance_checks: [{ criterion: "Email sent", evidence_refs: [evidenceRef!] }],
          unresolved_failures: [],
        } as never,
        undefined,
        undefined,
        {} as never,
      );
      const readyText = readyResult.content.find((part) => part.type === "text")?.text ?? "";
      const token = readyText.match(/verification_token:\s*([^\s]+)/u)?.[1];
      expect(token).toBeTruthy();

      const finishArgs = { status: "success", verification_token: token };
      const finishCall = {
        type: "toolCall" as const,
        id: "finish-1",
        name: "finish_work",
        arguments: finishArgs,
      };
      expect(
        (
          await session.agent.beforeToolCall?.({
            assistantMessage: {} as never,
            toolCall: finishCall,
            args: finishArgs,
            context: {} as never,
          })
        )?.block,
      ).not.toBe(true);
      await session.agent.afterToolCall?.({
        assistantMessage: {} as never,
        toolCall: finishCall,
        args: finishArgs,
        result: { content: [{ type: "text", text: "finished" }], details: {} },
        isError: false,
        context: {} as never,
      });
      expect(session._taskVerificationMode).toBe("off");
      expect(session.getActiveToolNames()).not.toContain(TASK_VERIFICATION_TOOL_NAME);
    } finally {
      session.dispose();
    }
  });

  it("returns dormant verification to off when a mutator is deactivated before any effect", async () => {
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      model: getModel("anthropic", "claude-sonnet-4-5")!,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager: SettingsManager.create(cwd, agentDir),
      projectInstructionMode: "off",
      noTools: "builtin",
      includeAllExtensionTools: false,
      customTools: [
        customTool("lookup_ticket", { kind: "read", risk: "normal" }),
        customTool("send_email", { kind: "external_write", risk: "high" }, false),
      ],
    });
    try {
      session.setActiveToolsByName(["lookup_ticket", "send_email"]);
      expect(session._taskVerificationMode).toBe("evidence");
      session.setActiveToolsByName(["lookup_ticket"]);
      expect(session._taskVerificationMode).toBe("off");
      expect(session.getActiveToolNames()).not.toContain(TASK_VERIFICATION_TOOL_NAME);
    } finally {
      session.dispose();
    }
  });

  it("rejects implicit completion before a dormant controller can activate later", async () => {
    await expect(
      createAgentSession({
        cwd,
        agentDir,
        model: getModel("anthropic", "claude-sonnet-4-5")!,
        sessionManager: SessionManager.inMemory(cwd),
        settingsManager: SettingsManager.create(cwd, agentDir),
        projectInstructionMode: "off",
        completionMode: "implicit",
        taskVerificationMode: "evidence",
        noTools: "builtin",
        customTools: [customTool("lookup_ticket", { kind: "read", risk: "normal" })],
      }),
    ).rejects.toThrow('Task verification mode "evidence" requires explicit_finish completion mode');
  });
});
