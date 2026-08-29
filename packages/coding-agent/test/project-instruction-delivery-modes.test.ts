import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROJECT_RULE_RECEIPT_CUSTOM_TYPE } from "../src/core/agent-session/project-instruction-integrity.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
  executeProjectInstructionReadRules,
  pendingProjectInstructionRuleBatches,
  projectInstructionToolHookInput,
} from "./project-instruction-delivery-fixture.ts";

afterEach(() => {
  cleanupProjectInstructionModeWorkspaces();
});

describe("project instruction delivery modes", () => {
  it("keeps compiled, legacy, and off mutually exclusive", async () => {
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
      expect(compiled.session.systemPrompt).toContain("<project_instructions");
      expect(compiled.session.systemPrompt).not.toContain("<project_context>");
      expect(compiled.session.getToolDefinition("read_rules")).toBeDefined();
      expect(legacy.session.systemPrompt).toContain("<project_context>");
      expect(legacy.session.systemPrompt).not.toContain("<project_instructions agents_sha256=");
      expect(legacy.session.getToolDefinition("read_rules")).toBeUndefined();
      expect(off.session.systemPrompt).not.toContain("<project_context>");
      expect(off.session.systemPrompt).not.toContain("<project_instructions agents_sha256=");
      expect(off.session.getToolDefinition("read_rules")).toBeUndefined();
      expect(workspace.compiler).toHaveBeenCalledOnce();

      const compiledTurn = compiled.session._createRuntimeContextPrompts(
        "edit security credentials",
        compiled.session.systemPrompt,
      );
      const legacyTurn = legacy.session._createRuntimeContextPrompts(
        "edit security credentials",
        legacy.session.systemPrompt,
      );
      const offTurn = off.session._createRuntimeContextPrompts("edit security credentials", off.session.systemPrompt);
      expect(compiledTurn.rulesPrompt).toContain("read_rules");
      expect(compiledTurn.rulesPrompt).not.toContain("<project_rules>");
      expect(legacyTurn.rulesPrompt).toContain("<project_rules>");
      expect(offTurn.rulesPrompt).toBeUndefined();
    } finally {
      compiled.session.dispose();
      legacy.session.dispose();
      off.session.dispose();
    }
  });

  it("forms one authoritative query-plus-action batch and requires one successful gating read", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.inMemory(workspace.root);
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: manager,
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      const turn = session._createRuntimeContextPrompts("edit security credential handling", session.systemPrompt);
      const links = [...(turn.projectRuleLinks ?? [])];
      expect(links).toHaveLength(2);

      const blocked = await session.agent.beforeToolCall?.(
        projectInstructionToolHookInput("edit", { path: "src/auth.ts" }),
      );
      expect(blocked).toMatchObject({ block: true });
      const [authoritativeBatch] = pendingProjectInstructionRuleBatches(session);
      expect(authoritativeBatch).toEqual(expect.arrayContaining(links));
      expect(authoritativeBatch).toHaveLength(3);
      expect(pendingProjectInstructionRuleBatches(session)).toHaveLength(1);
      const partial = await session.agent.beforeToolCall?.(
        projectInstructionToolHookInput("read_rules", { links: links.slice(0, 1) }),
      );
      expect(partial).toBeUndefined();
      const extra = await session.agent.beforeToolCall?.(
        projectInstructionToolHookInput("read_rules", { links: [...links, "rules/unselected.md"] }),
      );
      expect(extra).toBeUndefined();
      const duplicate = await session.agent.beforeToolCall?.(
        projectInstructionToolHookInput("read_rules", { links: [...links, links[0]] }),
      );
      expect(duplicate).toBeUndefined();

      expect(session.getToolDefinition("read_rules")).toBeDefined();
      let successfulGatingReads = 0;
      await executeProjectInstructionReadRules(session, authoritativeBatch!);
      successfulGatingReads += 1;
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toBeUndefined();
      expect(successfulGatingReads).toBe(1);
      expect(
        manager
          .getBranch()
          .filter((entry) => entry.type === "custom" && entry.customType === PROJECT_RULE_RECEIPT_CUSTOM_TYPE),
      ).toHaveLength(1);
    } finally {
      session.dispose();
    }
  });

  it("keeps the sole batch fixed when later mutations would select unseen links", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-action-routing"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      const turn = session._createRuntimeContextPrompts("fix the bug", session.systemPrompt);
      expect(turn.projectRuleLinks).toHaveLength(2);
      const rules = session._projectInstructions.state.current?.manifest.rules ?? [];
      const testingLink = rules.find((rule) => rule.title === "Testing")?.link;
      const deploymentLink = rules.find((rule) => rule.title === "Deployment")?.link;
      expect(testingLink).toBeDefined();
      expect(deploymentLink).toBeDefined();

      const testCall = projectInstructionToolHookInput("bash", { command: "npm test" });
      await expect(session.agent.beforeToolCall?.(testCall)).resolves.toMatchObject({
        block: true,
        reason: expect.stringContaining(testingLink!),
      });
      const combinedCall = projectInstructionToolHookInput("bash", {
        command: "npm test && ./deploy production",
      });
      const overlapPending = await session.agent.beforeToolCall?.(combinedCall);
      expect(overlapPending).toMatchObject({ block: true, reason: expect.stringContaining("read_rules") });
      const testBatch = pendingProjectInstructionRuleBatches(session).find((batch) => batch.includes(testingLink!));
      expect(testBatch).toBeDefined();
      await executeProjectInstructionReadRules(session, testBatch!);
      await expect(session.agent.beforeToolCall?.(combinedCall)).resolves.toBeUndefined();
      expect(session._projectRuleGate?.batches.flatMap((batch) => batch.links)).not.toContain(deploymentLink);
      await expect(session.agent.beforeToolCall?.(testCall)).resolves.toBeUndefined();
    } finally {
      session.dispose();
    }
  });

  it("reserves one batch slot for the first mutating action route", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-action-cap"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      const turn = session._createRuntimeContextPrompts(
        "npm test execution production deployment biome format execution",
        session.systemPrompt,
      );
      const rules = session._projectInstructions.state.current?.manifest.rules ?? [];
      expect(turn.projectRuleLinks).toHaveLength(3);
      const overCapLink = rules.find((rule) => rule.title === "Migration")?.link;
      const overCapCall = projectInstructionToolHookInput("bash", { command: "./database migration" });
      await expect(session.agent.beforeToolCall?.(overCapCall)).resolves.toMatchObject({
        block: true,
        reason: expect.stringContaining("read_rules"),
      });
      const [batch] = pendingProjectInstructionRuleBatches(session);
      expect(batch).toHaveLength(3);
      expect(batch).toContain(overCapLink);
      expect(batch?.filter((link) => turn.projectRuleLinks?.includes(link))).toHaveLength(2);
      await executeProjectInstructionReadRules(session, batch!);
      await expect(session.agent.beforeToolCall?.(overCapCall)).resolves.toBeUndefined();
    } finally {
      session.dispose();
    }
  });

  it("fails closed for mutations when compiled instruction generation falls back", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-fallback"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: async () => {
        throw new Error("compiler unavailable");
      },
    });
    try {
      const turn = session._createRuntimeContextPrompts("edit security credentials", session.systemPrompt);
      expect(turn.rulesPrompt).toContain("Do not mutate");
      const blocked = await session.agent.beforeToolCall?.(
        projectInstructionToolHookInput("edit", { path: "src/auth.ts" }),
      );
      expect(blocked).toMatchObject({ block: true, reason: expect.stringContaining("legacy") });
      await executeProjectInstructionReadRules(session, ["rules/catalog.md"]);
      const stillBlocked = await session.agent.beforeToolCall?.(
        projectInstructionToolHookInput("edit", { path: "src/auth.ts" }),
      );
      expect(stillBlocked).toMatchObject({ block: true });
    } finally {
      session.dispose();
    }
  });

  it("keeps the required reader available with explicit mutating tools and rejects a contradictory denylist", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const created = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-tools"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
      tools: ["edit"],
    });
    try {
      expect(created.session.getActiveToolNames()).toEqual(expect.arrayContaining(["edit", "read_rules"]));
    } finally {
      created.session.dispose();
    }

    await expect(
      createAgentSession({
        cwd: workspace.root,
        agentDir: join(workspace.root, ".agent-denied-reader"),
        resourceLoader: workspace.resourceLoader,
        sessionManager: SessionManager.inMemory(workspace.root),
        projectInstructionMode: "compiled",
        projectInstructionCompiler: workspace.compiler,
        tools: ["edit"],
        excludeTools: ["read_rules"],
      }),
    ).rejects.toThrow(/require read_rules/u);
  });
});
