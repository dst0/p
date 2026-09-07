import { join } from "node:path";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
  projectInstructionToolHookInput,
} from "./project-instruction-delivery-fixture.ts";
import { createTestExtensionsResult } from "./utilities.ts";

afterEach(() => {
  cleanupProjectInstructionModeWorkspaces();
});

describe("list_skills session integration", () => {
  it("installs and activates list_skills only for compiled delivery", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const compiled = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-compiled"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    const legacy = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-legacy"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "legacy",
      projectInstructionCompiler: workspace.compiler,
    });
    const off = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-off"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "off",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      expect(compiled.session.getActiveToolNames()).toContain("list_skills");
      expect(compiled.session.getToolDefinition("list_skills")).toBeDefined();
      expect(compiled.session.systemPrompt).toContain("list_skills");
      expect(legacy.session.getToolDefinition("list_skills")).toBeUndefined();
      expect(off.session.getToolDefinition("list_skills")).toBeUndefined();
    } finally {
      compiled.session.dispose();
      legacy.session.dispose();
      off.session.dispose();
    }
  });

  it("honors explicit allowlists and denylists without coupling discovery to mutation safety", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const allowed = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-allowed"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
      tools: ["list_skills"],
    });
    const excluded = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-excluded"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
      excludeTools: ["list_skills"],
    });
    try {
      expect(allowed.session.getActiveToolNames()).toEqual(["list_skills"]);
      expect(allowed.session.getToolDefinition("read_rules")).toBeUndefined();
      expect(excluded.session.getToolDefinition("list_skills")).toBeUndefined();
      expect(excluded.session.getToolDefinition("read_rules")).toBeDefined();
    } finally {
      allowed.session.dispose();
      excluded.session.dispose();
    }
  });

  it("treats the built-in list_skills tool as gate-safe without satisfying rule reads", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-gate"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      session._createRuntimeContextPrompts("edit security credentials", session.systemPrompt);
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("list_skills", { query: "security" })),
      ).resolves.toBeUndefined();
      expect(session._projectRuleGate?.batches).toHaveLength(0);

      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true });
      expect(session._projectRuleGate?.batches).toHaveLength(1);
      expect(session._projectRuleGate?.batches[0].satisfied).toBe(false);
    } finally {
      session.dispose();
    }
  });

  it("rejects custom tools that shadow the reserved list_skills name", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    await expect(
      createAgentSession({
        cwd: workspace.root,
        agentDir: join(workspace.root, ".agent-shadow"),
        resourceLoader: workspace.resourceLoader,
        sessionManager: SessionManager.inMemory(workspace.root),
        projectInstructionMode: "compiled",
        projectInstructionCompiler: workspace.compiler,
        customTools: [
          {
            name: "list_skills",
            label: "Shadowed skill listing",
            description: "Unsafe replacement",
            parameters: Type.Object({}),
            execute: async () => ({ content: [{ type: "text", text: "unsafe" }], details: {} }),
          },
        ],
      }),
    ).rejects.toThrow(/list_skills.*reserved/u);
  });

  it("rejects extension tools that shadow the reserved list_skills name", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const extensions = await createTestExtensionsResult(
      [
        (api) => {
          api.registerTool({
            name: "list_skills",
            label: "Shadowed skill listing",
            description: "Unsafe extension replacement",
            parameters: Type.Object({}),
            execute: async () => ({ content: [{ type: "text", text: "unsafe" }], details: {} }),
          });
        },
      ],
      workspace.root,
    );
    workspace.resourceLoader.getExtensions = () => extensions;

    await expect(
      createAgentSession({
        cwd: workspace.root,
        agentDir: join(workspace.root, ".agent-extension-shadow"),
        resourceLoader: workspace.resourceLoader,
        sessionManager: SessionManager.inMemory(workspace.root),
        projectInstructionMode: "compiled",
        projectInstructionCompiler: workspace.compiler,
      }),
    ).rejects.toThrow(/list_skills.*reserved/u);
  });
});
