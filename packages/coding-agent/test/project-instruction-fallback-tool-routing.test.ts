import { join } from "node:path";
import type { AfterToolCallContext } from "@dst0/p-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { getProjectInstructionFallbackPath } from "../src/core/project-instructions/paths.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
  executeProjectInstructionReadRules,
  pendingProjectInstructionRuleBatches,
  projectInstructionToolHookInput,
} from "./project-instruction-delivery-fixture.ts";

const extensionContext = {} as ExtensionContext;

afterEach(() => {
  cleanupProjectInstructionModeWorkspaces();
});

describe("compiled fallback tool routing", () => {
  it("keeps physical fallback paths out of prompts when logical readers are active", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-fallback-logical-readers"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: async () => {
        throw new Error("compiler unavailable");
      },
    });
    try {
      const prepared = session._projectInstructions.state.current;
      expect(prepared?.manifest.mode).toBe("fallback");
      if (!prepared) throw new Error("Expected prepared project instructions");
      const fallbackPath = getProjectInstructionFallbackPath(prepared.cacheDir, prepared.manifest.inputHash);

      expect(session.getActiveToolNames()).toEqual(expect.arrayContaining(["read_rules", "read_skills"]));
      expect(session.systemPrompt).toContain("Rule catalog: `rules/catalog.md`");
      expect.soft(session.systemPrompt).not.toContain("fallback.md");

      const turn = session._createRuntimeContextPrompts("edit security credentials", session.systemPrompt);
      expect(turn.projectRuleLinks).toBeUndefined();
      expect(turn.projectRuleGate?.candidateLinks).toEqual([]);
      expect(session._projectRuleGate?.candidateLinks).toEqual([]);

      const readRules = session.getToolDefinition("read_rules");
      expect(readRules).toBeDefined();
      if (!readRules) throw new Error("Expected read_rules");
      const absoluteArgs = { links: [fallbackPath] };
      const absoluteCall = projectInstructionToolHookInput("read_rules", absoluteArgs);
      await expect(session.agent.beforeToolCall?.(absoluteCall)).resolves.toBeUndefined();
      await expect(
        readRules.execute(absoluteCall.toolCall.id, absoluteArgs, undefined, undefined, extensionContext),
      ).rejects.toThrow(/invalid relative catalog link/iu);
      const basenameArgs = { links: ["fallback.md"] };
      const basenameCall = projectInstructionToolHookInput("read_rules", basenameArgs);
      await expect(session.agent.beforeToolCall?.(basenameCall)).resolves.toBeUndefined();
      await expect(
        readRules.execute(basenameCall.toolCall.id, basenameArgs, undefined, undefined, extensionContext),
      ).rejects.toThrow(/not cataloged/u);

      const rule = prepared.manifest.rules[0];
      expect(rule?.link).toMatch(/^rules\//u);
      if (!rule) throw new Error("Expected a logical rule module");
      await expect(
        executeProjectInstructionReadRules(session, [prepared.manifest.rulesCatalogFile, rule.link]),
      ).resolves.toBeUndefined();

      const read = session.getToolDefinition("read");
      expect(read).toBeDefined();
      if (!read) throw new Error("Expected ordinary read tool");
      const readCall = projectInstructionToolHookInput("read", { path: fallbackPath });
      await expect(session.agent.beforeToolCall?.(readCall)).resolves.toBeUndefined();
      const readResult = await read.execute(
        readCall.toolCall.id,
        { path: fallbackPath },
        undefined,
        undefined,
        extensionContext,
      );
      await session.agent.afterToolCall?.({
        ...readCall,
        result: readResult,
        isError: false,
        context: { messages: [] },
      } as unknown as AfterToolCallContext);
      expect(
        readResult.content.some(
          (item) => item.type === "text" && item.text.includes("Ordinary-read project instruction fallback"),
        ),
      ).toBe(true);

      const blocked = await session.agent.beforeToolCall?.(
        projectInstructionToolHookInput("edit", { path: "src/auth.ts" }),
      );
      expect(blocked).toMatchObject({ block: true, reason: expect.stringContaining("legacy") });
    } finally {
      session.dispose();
    }
  });

  it("advertises and reads the physical fallback when only ordinary read is active", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-fallback-ordinary-read"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: async () => {
        throw new Error("compiler unavailable");
      },
      tools: ["read"],
    });
    try {
      const prepared = session._projectInstructions.state.current;
      expect(prepared?.manifest.mode).toBe("fallback");
      if (!prepared) throw new Error("Expected prepared project instructions");
      const fallbackPath = getProjectInstructionFallbackPath(prepared.cacheDir, prepared.manifest.inputHash);

      expect(session.getActiveToolNames()).toEqual(["read"]);
      expect(session.getToolDefinition("read_rules")).toBeUndefined();
      expect(session.systemPrompt).toContain(fallbackPath);

      const read = session.getToolDefinition("read");
      expect(read).toBeDefined();
      if (!read) throw new Error("Expected ordinary read tool");
      const call = projectInstructionToolHookInput("read", { path: fallbackPath });
      await expect(session.agent.beforeToolCall?.(call)).resolves.toBeUndefined();
      const result = await read.execute(
        call.toolCall.id,
        { path: fallbackPath },
        undefined,
        undefined,
        extensionContext,
      );
      await session.agent.afterToolCall?.({
        ...call,
        result,
        isError: false,
        context: { messages: [] },
      } as unknown as AfterToolCallContext);
      const text = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      expect(text).toContain("Ordinary-read project instruction fallback");
      expect(text).toContain(prepared.manifest.inputHash);
    } finally {
      session.dispose();
    }
  });

  it("hides physical fallback references when read_rules is active without read_skills", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-fallback-read-rules-only"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: async () => {
        throw new Error("compiler unavailable");
      },
      tools: ["read", "read_rules"],
    });
    try {
      const prepared = session._projectInstructions.state.current;
      expect(prepared?.manifest.mode).toBe("fallback");
      if (!prepared) throw new Error("Expected prepared project instructions");
      const fallbackPath = getProjectInstructionFallbackPath(prepared.cacheDir, prepared.manifest.inputHash);

      expect(session.getActiveToolNames()).toEqual(["read", "read_rules"]);
      expect(session.getToolDefinition("read_rules")).toBeDefined();
      expect(session.getToolDefinition("read_skills")).toBeUndefined();
      expect(session.systemPrompt).toContain("Rule catalog: `rules/catalog.md`");
      expect
        .soft({
          exactPathExposed: session.systemPrompt.includes(fallbackPath),
          fallbackNameExposed: session.systemPrompt.includes("fallback.md"),
        })
        .toEqual({ exactPathExposed: false, fallbackNameExposed: false });

      const readRules = session.getToolDefinition("read_rules");
      if (!readRules) throw new Error("Expected read_rules");
      const result = await readRules.execute(
        "mixed-logical-catalog",
        { links: [prepared.manifest.rulesCatalogFile] },
        undefined,
        undefined,
        extensionContext,
      );
      expect(
        result.content.some((item) => item.type === "text" && item.text.includes("Project instruction modules")),
      ).toBe(true);
    } finally {
      session.dispose();
    }
  });

  it("keeps successful compilation on manifest-bound routes and unlocks only after the real batch read", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-compiled-logical-readers"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      const prepared = session._projectInstructions.state.current;
      expect(prepared?.manifest.mode).toBe("compiled");
      if (!prepared) throw new Error("Expected prepared project instructions");
      expect(session.systemPrompt).toContain("Rule catalog: `rules/catalog.md`");
      expect.soft(session.systemPrompt).not.toContain("fallback.md");

      const turn = session._createRuntimeContextPrompts("edit security credentials", session.systemPrompt);
      const manifestLinks = new Set(prepared.manifest.rules.map((rule) => rule.link));
      expect(turn.projectRuleLinks?.length).toBeGreaterThan(0);
      expect(turn.projectRuleLinks?.every((link) => manifestLinks.has(link))).toBe(true);

      const editCall = projectInstructionToolHookInput("edit", { path: "src/auth.ts" });
      await expect(session.agent.beforeToolCall?.(editCall)).resolves.toMatchObject({
        block: true,
        reason: expect.stringContaining("read_rules"),
      });
      const [batch] = pendingProjectInstructionRuleBatches(session);
      expect(batch?.length).toBeGreaterThanOrEqual(1);
      expect(batch?.length).toBeLessThanOrEqual(3);
      expect(batch?.every((link) => manifestLinks.has(link))).toBe(true);
      if (!batch) throw new Error("Expected a pending project-rule batch");

      await executeProjectInstructionReadRules(session, batch);
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toBeUndefined();
    } finally {
      session.dispose();
    }
  });
});
