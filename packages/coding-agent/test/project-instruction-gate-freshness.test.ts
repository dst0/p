import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
  executeProjectInstructionReadRules,
  projectInstructionToolHookInput,
} from "./project-instruction-delivery-fixture.ts";

afterEach(() => {
  cleanupProjectInstructionModeWorkspaces();
});

function makeInstructionSourcesDynamic(workspace: ReturnType<typeof createProjectInstructionModeWorkspace>): string {
  const agentsPath = join(workspace.root, "AGENTS.md");
  workspace.resourceLoader.getAgentsFiles = () => ({
    agentsFiles: [{ path: agentsPath, content: readFileSync(agentsPath, "utf8") }],
  });
  return agentsPath;
}

describe("compiled project-instruction source freshness", () => {
  it("fails closed after a no-route turn when the instruction source changes", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const agentsPath = makeInstructionSourcesDynamic(workspace);
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-zero-route-freshness"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      const turn = session._createRuntimeContextPrompts("hello there", session.systemPrompt);
      expect(turn.projectRuleLinks).toBeUndefined();
      appendFileSync(agentsPath, "\n## New safety route\n\nAlways inspect new safety state.\n");

      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining("changed") });
    } finally {
      session.dispose();
    }
  });

  it("rechecks sources after a previously satisfied batch", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const agentsPath = makeInstructionSourcesDynamic(workspace);
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-satisfied-freshness"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      const turn = session._createRuntimeContextPrompts("edit security credentials", session.systemPrompt);
      const links = [...(turn.projectRuleLinks ?? [])];
      expect(links.length).toBeGreaterThan(0);
      await executeProjectInstructionReadRules(session, links);
      appendFileSync(agentsPath, "\n## Post-read route\n\nAlways inspect post-read state.\n");

      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining("changed") });
    } finally {
      session.dispose();
    }
  });

  it("does not finalize a read when a tool_result extension changes the source", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const agentsPath = makeInstructionSourcesDynamic(workspace);
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-finalization-freshness"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      const turn = session._createRuntimeContextPrompts("edit security credentials", session.systemPrompt);
      const links = [...(turn.projectRuleLinks ?? [])];
      expect(links.length).toBeGreaterThan(0);
      vi.spyOn(session._extensionRunner, "hasHandlers").mockImplementation((event) => event === "tool_result");
      vi.spyOn(session._extensionRunner, "emitToolResult").mockImplementation(async () => {
        appendFileSync(agentsPath, "\n## Hook route\n\nAlways inspect hook state.\n");
        return undefined;
      });

      await executeProjectInstructionReadRules(session, links);
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true });
    } finally {
      session.dispose();
    }
  });

  it("rechecks sources after a tool_call extension allows a mutation", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const agentsPath = makeInstructionSourcesDynamic(workspace);
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-tool-call-freshness"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      const turn = session._createRuntimeContextPrompts("hello there", session.systemPrompt);
      expect(turn.projectRuleLinks).toBeUndefined();
      const editCall = projectInstructionToolHookInput("edit", { path: "src/auth.ts" });
      await expect(session.agent.beforeToolCall?.(editCall)).resolves.toMatchObject({ block: true });
      const actionBatches = session._projectRuleGate?.batches.filter((batch) => !batch.satisfied) ?? [];
      expect(actionBatches).toHaveLength(1);
      await executeProjectInstructionReadRules(session, actionBatches[0]!.links);
      vi.spyOn(session._extensionRunner, "hasHandlers").mockImplementation((event) => event === "tool_call");
      vi.spyOn(session._extensionRunner, "emitToolCall").mockImplementation(async () => {
        appendFileSync(agentsPath, "\n## Interposed route\n\nAlways inspect interposed state.\n");
        return undefined;
      });

      await expect(session.agent.beforeToolCall?.(editCall)).resolves.toMatchObject({
        block: true,
        reason: expect.stringContaining("changed"),
      });
    } finally {
      session.dispose();
    }
  });
});
