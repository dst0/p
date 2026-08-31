import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@dst0/p-ai";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CreateAgentSessionFromServicesOptions,
  createAgentSessionFromServices,
  createAgentSessionServices,
} from "../src/core/agent-session-services.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { REQUIREMENT_AUDIT_TOOL_NAME, TASK_VERIFICATION_TOOL_NAME } from "../src/core/task-verification.ts";

describe("task verification session wiring", () => {
  let tempDir: string;
  let agentDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `p-task-verification-session-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    agentDir = join(tempDir, "agent");
    mkdirSync(agentDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  async function createSession(
    overrides: Pick<
      CreateAgentSessionFromServicesOptions,
      "completionMode" | "customTools" | "excludeTools" | "noTools" | "taskVerificationMode" | "tools"
    > = {},
  ) {
    const settingsManager = SettingsManager.create(tempDir, agentDir);
    const sessionManager = SessionManager.inMemory(tempDir);
    const services = await createAgentSessionServices({
      cwd: tempDir,
      agentDir,
      settingsManager,
    });
    return createAgentSessionFromServices({
      services,
      sessionManager,
      model: getModel("anthropic", "claude-sonnet-4-5")!,
      ...overrides,
    });
  }

  it("defaults to evidence mode and exposes only record_task_verification", async () => {
    const { session } = await createSession();
    try {
      expect(session.getAllTools().map((tool) => tool.name)).toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getAllTools().map((tool) => tool.name)).not.toContain(REQUIREMENT_AUDIT_TOOL_NAME);
      expect(session.getActiveToolNames()).toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getActiveToolNames()).not.toContain(REQUIREMENT_AUDIT_TOOL_NAME);
      expect(session.systemPrompt).toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.systemPrompt).toContain("Do not classify task kinds");
      expect(session.systemPrompt).not.toContain(`Then follow ${REQUIREMENT_AUDIT_TOOL_NAME}`);
      expect(session._projectRuleSafeToolDefinitions.has(session.getToolDefinition(TASK_VERIFICATION_TOOL_NAME)!)).toBe(
        true,
      );
    } finally {
      session.dispose();
    }
  });

  it("installs the evidence controller for direct SDK sessions", async () => {
    const { session } = await createAgentSession({
      cwd: tempDir,
      agentDir,
      model: getModel("anthropic", "claude-sonnet-4-5")!,
      sessionManager: SessionManager.inMemory(tempDir),
      settingsManager: SettingsManager.create(tempDir, agentDir),
    });
    try {
      expect(session.getActiveToolNames()).toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getAllTools().map((tool) => tool.name)).not.toContain(REQUIREMENT_AUDIT_TOOL_NAME);
      expect(session._taskVerificationMode).toBe("evidence");
      expect(session.agent.beforeToolCall).toBeTypeOf("function");
    } finally {
      session.dispose();
    }
  });

  it("exposes both verification tools only in audit mode", async () => {
    const { session } = await createSession({ taskVerificationMode: "audit" });
    try {
      expect(session.getAllTools().map((tool) => tool.name)).toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getAllTools().map((tool) => tool.name)).toContain(REQUIREMENT_AUDIT_TOOL_NAME);
      expect(session.getActiveToolNames()).toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getActiveToolNames()).toContain(REQUIREMENT_AUDIT_TOOL_NAME);
      expect(session._projectRuleSafeToolDefinitions.has(session.getToolDefinition(REQUIREMENT_AUDIT_TOOL_NAME)!)).toBe(
        true,
      );
    } finally {
      session.dispose();
    }
  });

  it("registers no verification controller tools in off mode", async () => {
    const { session } = await createSession({ taskVerificationMode: "off" });
    try {
      expect(session.getAllTools().map((tool) => tool.name)).not.toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getAllTools().map((tool) => tool.name)).not.toContain(REQUIREMENT_AUDIT_TOOL_NAME);
      expect(session.getActiveToolNames()).not.toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getActiveToolNames()).not.toContain(REQUIREMENT_AUDIT_TOOL_NAME);
    } finally {
      session.dispose();
    }
  });

  it("does not register verification when built-in tools are disabled", async () => {
    const { session } = await createSession({ noTools: "builtin" });
    try {
      expect(session.getAllTools().map((tool) => tool.name)).not.toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getAllTools().map((tool) => tool.name)).not.toContain(REQUIREMENT_AUDIT_TOOL_NAME);
      expect(session.getActiveToolNames()).not.toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getActiveToolNames()).not.toContain(REQUIREMENT_AUDIT_TOOL_NAME);
      expect(session.systemPrompt).not.toContain(TASK_VERIFICATION_TOOL_NAME);
    } finally {
      session.dispose();
    }
  });

  it("rejects exclusion of the evidence mode's required tool", async () => {
    await expect(createSession({ excludeTools: [TASK_VERIFICATION_TOOL_NAME] })).rejects.toThrow(
      `Task verification mode "evidence" requires tool "${TASK_VERIFICATION_TOOL_NAME}"`,
    );
  });

  it.each([TASK_VERIFICATION_TOOL_NAME, REQUIREMENT_AUDIT_TOOL_NAME])(
    "rejects exclusion of audit mode's required tool %s",
    async (toolName) => {
      await expect(createSession({ excludeTools: [toolName], taskVerificationMode: "audit" })).rejects.toThrow(
        `Task verification mode "audit" requires tool "${toolName}"`,
      );
    },
  );

  it("keeps verification dormant for an explicit read-only tool selection", async () => {
    const { session } = await createSession({ tools: ["read"] });
    try {
      expect(session.getAllTools().map((tool) => tool.name)).not.toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getAllTools().map((tool) => tool.name)).not.toContain(REQUIREMENT_AUDIT_TOOL_NAME);
      expect(session._taskVerificationMode).toBe("off");
      expect(session._baseSystemPromptOptions.taskVerificationMode).toBe("off");
      expect(session.systemPrompt).not.toContain("Call record_task_verification");
    } finally {
      session.dispose();
    }
  });

  it("does not let an irrelevant audit-tool exclusion disable evidence mode", async () => {
    const { session } = await createSession({ excludeTools: [REQUIREMENT_AUDIT_TOOL_NAME] });
    try {
      expect(session.getActiveToolNames()).toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getActiveToolNames()).not.toContain(REQUIREMENT_AUDIT_TOOL_NAME);
    } finally {
      session.dispose();
    }
  });

  it.each(["evidence", "audit"] as const)("requires explicit completion for %s mode", async (mode) => {
    await expect(createSession({ completionMode: "implicit", taskVerificationMode: mode })).rejects.toThrow(
      `Task verification mode "${mode}" requires explicit_finish completion mode`,
    );
  });

  it("allows implicit completion when verification is off", async () => {
    const { session } = await createSession({ completionMode: "implicit", taskVerificationMode: "off" });
    session.dispose();
  });

  it.each([TASK_VERIFICATION_TOOL_NAME, REQUIREMENT_AUDIT_TOOL_NAME])(
    "rejects a custom tool collision with reserved name %s",
    async (name) => {
      await expect(
        createSession({
          customTools: [
            {
              name,
              label: "Conflicting verification tool",
              description: "Must not replace a built-in verification controller tool",
              parameters: Type.Object({}),
              execute: async () => ({ content: [{ type: "text", text: "conflict" }], details: {} }),
            },
          ],
        }),
      ).rejects.toThrow(`${name} is reserved by the built-in verification controller`);
    },
  );
});
