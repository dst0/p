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
  pendingProjectInstructionRuleBatches,
  projectInstructionToolHookInput,
} from "./project-instruction-delivery-fixture.ts";

type CompiledSession = Awaited<ReturnType<typeof createAgentSession>>["session"];

afterEach(() => {
  cleanupProjectInstructionModeWorkspaces();
});

/** Fix an unread authoritative batch so every untrusted (potentially mutating) call is observably gated. */
async function stagePendingRuleBatch(session: CompiledSession): Promise<void> {
  session._createRuntimeContextPrompts("edit security credentials", session.systemPrompt);
  await expect(
    session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
  ).resolves.toMatchObject({ block: true, reason: expect.stringContaining("read_rules") });
  expect(pendingProjectInstructionRuleBatches(session)).toHaveLength(1);
}

const gated = { block: true, reason: expect.stringContaining("read_rules") };

describe("compiled gate read-only tool trust", () => {
  it("allows declared read-only extension tools while keeping unsafe declarations gated", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-gate-declared-read"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      taskVerificationMode: "off",
      projectInstructionCompiler: workspace.compiler,
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
      expect(session._projectInstructions.state.current?.manifest.mode).toBe("compiled");
      await stagePendingRuleBatch(session);
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
        ).resolves.toMatchObject(gated);
      }
    } finally {
      session.dispose();
    }
  });

  it("allows safe inspection shell commands but gates mutating disk operations", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-gate-shell-inspection"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      taskVerificationMode: "off",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      await stagePendingRuleBatch(session);
      await expect(
        session.agent.beforeToolCall?.(
          projectInstructionToolHookInput("bash", { command: "echo ok && sw_vers && diskutil list" }),
        ),
      ).resolves.toBeUndefined();
      await expect(
        session.agent.beforeToolCall?.(
          projectInstructionToolHookInput("bash", { command: "diskutil eraseDisk APFS Empty disk9" }),
        ),
      ).resolves.toMatchObject(gated);
    } finally {
      session.dispose();
    }
  });

  it("keeps identity-bound verification control-plane actions available behind a pending batch", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-gate-verification"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      taskVerificationMode: "audit",
      projectInstructionCompiler: workspace.compiler,
      customTools: [
        {
          name: "mutate_project",
          label: "Mutate project",
          effect: { kind: "workspace_write", risk: "normal" },
          description: "A mutation that activates task verification",
          parameters: Type.Object({ path: Type.String() }),
          execute: async () => ({ content: [{ type: "text", text: "mutated" }], details: {} }),
        },
      ],
    });
    try {
      await stagePendingRuleBatch(session);
      await expect(
        session.agent.beforeToolCall?.(
          projectInstructionToolHookInput(TASK_VERIFICATION_TOOL_NAME, { action: "status" }),
        ),
      ).resolves.toBeUndefined();
    } finally {
      session.dispose();
    }
  });

  it("gates read-only-looking shell calls when a command prefix is configured", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const settingsManager = SettingsManager.inMemory();
    settingsManager.setShellCommandPrefix("touch prefixed-mutation");
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-gate-shell-prefix"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      settingsManager,
      projectInstructionMode: "compiled",
      taskVerificationMode: "off",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      await stagePendingRuleBatch(session);
      await expect(
        session.agent.beforeToolCall?.(
          projectInstructionToolHookInput("bash", { command: "echo ok && sw_vers && diskutil list" }),
        ),
      ).resolves.toMatchObject(gated);
    } finally {
      session.dispose();
    }
  });
});
