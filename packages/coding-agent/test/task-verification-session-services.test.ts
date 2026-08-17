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
    overrides: Pick<CreateAgentSessionFromServicesOptions, "tools" | "excludeTools" | "noTools" | "customTools"> = {},
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

  it("automatically registers and activates verification with mutating tools", async () => {
    const { session } = await createSession();
    try {
      expect(session.getAllTools().map((tool) => tool.name)).toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getAllTools().map((tool) => tool.name)).toContain(REQUIREMENT_AUDIT_TOOL_NAME);
      expect(session.getActiveToolNames()).toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getActiveToolNames()).toContain(REQUIREMENT_AUDIT_TOOL_NAME);
      expect(session.systemPrompt).toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.systemPrompt).toContain(REQUIREMENT_AUDIT_TOOL_NAME);
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

  it("honors an explicit verification-tool exclusion", async () => {
    const { session } = await createSession({ excludeTools: [TASK_VERIFICATION_TOOL_NAME] });
    try {
      expect(session.getAllTools().map((tool) => tool.name)).not.toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getAllTools().map((tool) => tool.name)).not.toContain(REQUIREMENT_AUDIT_TOOL_NAME);
      expect(session.getActiveToolNames()).not.toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getActiveToolNames()).not.toContain(REQUIREMENT_AUDIT_TOOL_NAME);
      expect(session.getActiveToolNames()).toContain("edit");
    } finally {
      session.dispose();
    }
  });

  it("disables the coupled verification protocol when the audit tool is excluded", async () => {
    const { session } = await createSession({ excludeTools: [REQUIREMENT_AUDIT_TOOL_NAME] });
    try {
      expect(session.getAllTools().map((tool) => tool.name)).not.toContain(TASK_VERIFICATION_TOOL_NAME);
      expect(session.getAllTools().map((tool) => tool.name)).not.toContain(REQUIREMENT_AUDIT_TOOL_NAME);
      expect(session.getActiveToolNames()).toContain("edit");
    } finally {
      session.dispose();
    }
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
