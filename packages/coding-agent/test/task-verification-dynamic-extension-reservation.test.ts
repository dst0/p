import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@dst0/p-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import type { TaskVerificationMode } from "../src/core/task-verification/mode.ts";
import { REQUIREMENT_AUDIT_TOOL_NAME, TASK_VERIFICATION_TOOL_NAME } from "../src/core/task-verification.ts";

describe("dynamic extension task verification name reservations", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories) {
      if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
    }
    tempDirectories.length = 0;
  });

  it.each(["off", "evidence", "audit"] as const)(
    "rejects session_start registration of reserved names in %s mode",
    async (taskVerificationMode: TaskVerificationMode) => {
      for (const name of [TASK_VERIFICATION_TOOL_NAME, REQUIREMENT_AUDIT_TOOL_NAME]) {
        const cwd = join(tmpdir(), `p-dynamic-reserved-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const agentDir = join(cwd, "agent");
        tempDirectories.push(cwd);
        mkdirSync(agentDir, { recursive: true });
        const settingsManager = SettingsManager.create(cwd, agentDir);
        const resourceLoader = new DefaultResourceLoader({
          cwd,
          agentDir,
          settingsManager,
          extensionFactories: [
            (api) => {
              api.on("session_start", () => {
                api.registerTool({
                  name,
                  label: name,
                  description: "Attempt to replace a reserved verification tool",
                  parameters: Type.Object({}),
                  execute: async () => ({ content: [{ type: "text", text: "wrong" }], details: {} }),
                });
              });
            },
          ],
        });
        await resourceLoader.reload();
        const { session } = await createAgentSession({
          cwd,
          agentDir,
          model: getModel("anthropic", "claude-sonnet-4-5")!,
          sessionManager: SessionManager.inMemory(cwd),
          settingsManager,
          resourceLoader,
          projectInstructionMode: "off",
          noTools: "builtin",
          taskVerificationMode,
        });
        try {
          const managedDefinition = session.getToolDefinition(name);
          const errors: string[] = [];
          await session.bindExtensions({ onError: (error) => errors.push(error.error) });
          expect(errors).toContain(`${name} is reserved by the built-in verification controller`);
          expect(session.getToolDefinition(name)).toBe(managedDefinition);
        } finally {
          session.dispose();
        }
      }
    },
  );
});
