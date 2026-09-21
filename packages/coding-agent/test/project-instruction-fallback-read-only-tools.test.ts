import { join } from "node:path";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { TASK_VERIFICATION_TOOL_NAME } from "../src/core/task-verification/constants.ts";
import {
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
  projectInstructionToolHookInput,
} from "./project-instruction-delivery-fixture.ts";

afterEach(() => {
  cleanupProjectInstructionModeWorkspaces();
});

describe("compiled fallback read-only tool routing", () => {
  it("allows declared read-only extension tools while keeping unsafe declarations blocked", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-fallback-declared-read"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      taskVerificationMode: "off",
      projectInstructionCompiler: async () => {
        throw new Error("compiler unavailable");
      },
      customTools: [
        {
          name: "workspace_project_list",
          label: "Workspace project list",
          effect: { kind: "read", risk: "normal" },
          description: "List workspace projects without changing them",
          parameters: Type.Object({}),
          execute: async () => ({ content: [{ type: "text", text: "[]" }], details: {} }),
        },
        {
          name: "unclassified_project_list",
          label: "Unclassified project list",
          description: "A tool whose effects are not declared",
          parameters: Type.Object({}),
          execute: async () => ({ content: [{ type: "text", text: "[]" }], details: {} }),
        },
        {
          name: "network_project_list",
          label: "Network project list",
          effect: { kind: "read", risk: "normal", domains: ["network_send"] },
          description: "A read that declares an external effect domain",
          parameters: Type.Object({}),
          execute: async () => ({ content: [{ type: "text", text: "[]" }], details: {} }),
        },
        {
          name: "read",
          label: "Shadowed read",
          effect: { kind: "read", risk: "normal" },
          description: "A custom tool shadowing a built-in name",
          parameters: Type.Object({ path: Type.String() }),
          execute: async () => ({ content: [{ type: "text", text: "shadowed" }], details: {} }),
        },
      ],
    });
    try {
      session._createRuntimeContextPrompts("inspect workspace projects", session.systemPrompt);
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("workspace_project_list", {})),
      ).resolves.toBeUndefined();
      for (const [toolName, args] of [
        ["unclassified_project_list", {}],
        ["network_project_list", {}],
        ["read", { path: "project.json" }],
      ] as const) {
        await expect(
          session.agent.beforeToolCall?.(projectInstructionToolHookInput(toolName, args)),
        ).resolves.toMatchObject({ block: true, reason: expect.stringContaining("legacy") });
      }
    } finally {
      session.dispose();
    }
  });

  it("allows safe inspection shell commands but blocks mutating disk operations", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-fallback-shell-inspection"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      taskVerificationMode: "off",
      projectInstructionCompiler: async () => {
        throw new Error("compiler unavailable");
      },
    });
    try {
      session._createRuntimeContextPrompts("inspect external disks", session.systemPrompt);
      await expect(
        session.agent.beforeToolCall?.(
          projectInstructionToolHookInput("bash", { command: "echo ok && sw_vers && diskutil list" }),
        ),
      ).resolves.toBeUndefined();
      await expect(
        session.agent.beforeToolCall?.(
          projectInstructionToolHookInput("bash", { command: "diskutil eraseDisk APFS Empty disk9" }),
        ),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining("legacy") });
    } finally {
      session.dispose();
    }
  });

  it("keeps identity-bound verification control-plane actions available in fallback mode", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-fallback-verification"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      taskVerificationMode: "audit",
      projectInstructionCompiler: async () => {
        throw new Error("compiler unavailable");
      },
    });
    try {
      session._createRuntimeContextPrompts("inspect verification state", session.systemPrompt);
      await expect(
        session.agent.beforeToolCall?.(
          projectInstructionToolHookInput(TASK_VERIFICATION_TOOL_NAME, { action: "status" }),
        ),
      ).resolves.toBeUndefined();
    } finally {
      session.dispose();
    }
  });

  it("blocks read-only-looking shell calls when a command prefix is configured", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const settingsManager = SettingsManager.inMemory();
    settingsManager.setShellCommandPrefix("touch prefixed-mutation");
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-fallback-shell-prefix"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      settingsManager,
      projectInstructionMode: "compiled",
      taskVerificationMode: "off",
      projectInstructionCompiler: async () => {
        throw new Error("compiler unavailable");
      },
    });
    try {
      session._createRuntimeContextPrompts("inspect external disks", session.systemPrompt);
      await expect(
        session.agent.beforeToolCall?.(
          projectInstructionToolHookInput("bash", { command: "echo ok && sw_vers && diskutil list" }),
        ),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining("legacy") });
    } finally {
      session.dispose();
    }
  });
});
