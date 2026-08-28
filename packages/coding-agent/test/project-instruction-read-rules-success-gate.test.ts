import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AfterToolCallContext, BeforeToolCallContext } from "@dst0/p-agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import type { ProjectInstructionCompiler } from "../src/core/project-instructions/index.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

const extensionContext = {} as ExtensionContext;
const temporaryDirectories: string[] = [];

function createWorkspace(): { root: string; resourceLoader: ResourceLoader; compiler: ProjectInstructionCompiler } {
  const root = mkdtempSync(join(tmpdir(), "p-read-rules-success-gate-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  const agentsPath = join(root, "AGENTS.md");
  const content = `# Security edits\n\nRead this module before editing credentials.\n${Array.from(
    { length: 160 },
    (_, index) => `Security credential detail ${index}.`,
  ).join("\n")}\n`;
  writeFileSync(agentsPath, content);
  const runtime = createExtensionRuntime();
  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [{ path: agentsPath, content }] }),
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
  const compiler: ProjectInstructionCompiler = async (request) =>
    createProjectInstructionCompilation(
      request,
      Object.fromEntries(request.modules.map((module) => [module.id, "Editing security credentials"])),
    );
  return { root, resourceLoader, compiler };
}

function hookInput(name: string, id: string, args: Record<string, unknown>): BeforeToolCallContext {
  return {
    toolCall: { type: "toolCall", id, name, arguments: args },
    args,
    assistantMessage: {} as BeforeToolCallContext["assistantMessage"],
    context: {} as BeforeToolCallContext["context"],
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("compiled read_rules success gate", () => {
  it("merges a generated context extract into non-record tool details", async () => {
    const workspace = createWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-context-extract"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      vi.spyOn(session, "_maybeCreateToolResultContextExtract").mockResolvedValue({
        summary: "Focused evidence",
        relevantLines: ["line 1"],
        source: "deterministic",
      });
      const call = hookInput("read", "read-with-extract", { path: "src/auth.ts" });
      const result = await session.agent.afterToolCall?.({
        ...call,
        result: { content: [{ type: "text", text: "raw" }], details: "opaque" },
        isError: false,
        context: { messages: [] },
      } as unknown as AfterToolCallContext);

      expect(result?.details).toEqual({
        contextExtract: { summary: "Focused evidence", relevantLines: ["line 1"], source: "deterministic" },
      });
    } finally {
      session.dispose();
    }
  });

  it("keeps a staged read pending when source refresh fails during finalization", async () => {
    const workspace = createWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-refresh-failure"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      session._createRuntimeContextPrompts("edit security credentials", session.systemPrompt);
      await session.agent.beforeToolCall?.(hookInput("edit", "edit-stage-refresh-failure", { path: "src/auth.ts" }));
      const links = session._projectRuleGate?.batches.find((batch) => !batch.satisfied)?.links ?? [];
      expect(links.length).toBeGreaterThan(0);
      const call = hookInput("read_rules", "read-refresh-failure", { links });
      await session.agent.beforeToolCall?.(call);
      const result = await session
        .getToolDefinition("read_rules")!
        .execute(call.toolCall.id, { links }, undefined, undefined, extensionContext);
      vi.spyOn(session._projectInstructions, "refresh").mockRejectedValueOnce(new Error("refresh failed"));
      await session.agent.afterToolCall?.({ ...call, result, isError: false } as AfterToolCallContext);

      await expect(
        session.agent.beforeToolCall?.(hookInput("edit", "edit-after-refresh-failure", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true });
    } finally {
      session.dispose();
    }
  });

  it("allows exploratory reads without satisfying a pending mutation batch", async () => {
    const workspace = createWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      session._createRuntimeContextPrompts("explain arithmetic", session.systemPrompt);
      await expect(
        session.agent.beforeToolCall?.(
          hookInput("read_rules", "read-zero-route-catalog", {
            links: ["rules/catalog.md"],
          }),
        ),
      ).resolves.toBeUndefined();

      const turn = session._createRuntimeContextPrompts("edit security credentials", session.systemPrompt);
      expect(turn.projectRuleLinks).toHaveLength(1);
      const reader = session.getToolDefinition("read_rules");
      const exploratoryCall = hookInput("read_rules", "read-pending-catalog", { links: ["rules/catalog.md"] });
      await expect(session.agent.beforeToolCall?.(exploratoryCall)).resolves.toBeUndefined();
      const result = await reader?.execute(
        exploratoryCall.toolCall.id,
        { links: ["rules/catalog.md"] },
        undefined,
        undefined,
        extensionContext,
      );
      await session.agent.afterToolCall?.({
        ...exploratoryCall,
        result: result!,
        isError: false,
      } as AfterToolCallContext);

      expect(session._projectRuleReadStages.size).toBe(0);
      await expect(
        session.agent.beforeToolCall?.(hookInput("edit", "edit-after-exploration", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true });
    } finally {
      session.dispose();
    }
  });

  it("satisfies a staged exact batch only after the final post-extension result succeeds", async () => {
    const workspace = createWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      const turn = session._createRuntimeContextPrompts("edit security credentials", session.systemPrompt);
      const links = [...(turn.projectRuleLinks ?? [])];
      expect(links.length).toBeGreaterThan(0);
      const reader = session.getToolDefinition("read_rules");
      expect(reader).toBeDefined();

      let extensionResult: "replace" | "error" | "pass" = "replace";
      vi.spyOn(session._extensionRunner, "hasHandlers").mockImplementation((event) => event === "tool_result");
      vi.spyOn(session._extensionRunner, "emitToolResult").mockImplementation(async () => {
        if (extensionResult === "replace") return { content: [{ type: "text", text: "replacement" }] };
        return extensionResult === "error" ? { isError: true } : undefined;
      });

      const replacedCall = hookInput("read_rules", "read-replaced", { links });
      await expect(session.agent.beforeToolCall?.(replacedCall)).resolves.toBeUndefined();
      const replacedRawResult = await reader?.execute(
        replacedCall.toolCall.id,
        { links },
        undefined,
        undefined,
        extensionContext,
      );
      await expect(
        session.agent.beforeToolCall?.(hookInput("edit", "edit-before-finalize", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true });

      const replacedFinalResult = await session.agent.afterToolCall?.({
        ...replacedCall,
        result: replacedRawResult!,
        isError: false,
      } as AfterToolCallContext);
      expect(replacedFinalResult).toMatchObject({
        content: [{ type: "text", text: "replacement" }],
        isError: false,
      });
      await expect(
        session.agent.beforeToolCall?.(hookInput("edit", "edit-after-replacement", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true });

      extensionResult = "pass";
      const mismatchedCall = hookInput("read_rules", "read-mismatched", { links });
      await session.agent.beforeToolCall?.(mismatchedCall);
      const mismatchedRawResult = await reader?.execute(
        mismatchedCall.toolCall.id,
        { links },
        undefined,
        undefined,
        extensionContext,
      );
      await session.agent.afterToolCall?.({
        ...mismatchedCall,
        result: { ...mismatchedRawResult!, details: { links: [] } },
        isError: false,
      } as AfterToolCallContext);
      await expect(
        session.agent.beforeToolCall?.(hookInput("edit", "edit-after-mismatch", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true });

      await session.agent.afterToolCall?.({
        ...replacedCall,
        result: replacedRawResult!,
        isError: false,
      } as AfterToolCallContext);
      await expect(
        session.agent.beforeToolCall?.(hookInput("edit", "edit-after-stale-replay", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true });

      extensionResult = "error";
      const rejectedCall = hookInput("read_rules", "read-rejected", { links });
      await expect(session.agent.beforeToolCall?.(rejectedCall)).resolves.toBeUndefined();
      const rejectedRawResult = await reader?.execute(
        rejectedCall.toolCall.id,
        { links },
        undefined,
        undefined,
        extensionContext,
      );
      const rejectedFinalResult = await session.agent.afterToolCall?.({
        ...rejectedCall,
        result: rejectedRawResult!,
        isError: false,
      } as AfterToolCallContext);
      expect(rejectedFinalResult).toMatchObject({ isError: true });
      await expect(
        session.agent.beforeToolCall?.(hookInput("edit", "edit-after-rejection", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true });

      extensionResult = "pass";
      const acceptedCall = hookInput("read_rules", "read-accepted", { links });
      await expect(session.agent.beforeToolCall?.(acceptedCall)).resolves.toBeUndefined();
      const acceptedRawResult = await reader?.execute(
        acceptedCall.toolCall.id,
        { links },
        undefined,
        undefined,
        extensionContext,
      );
      await session.agent.afterToolCall?.({
        ...acceptedCall,
        result: acceptedRawResult!,
        isError: false,
      } as AfterToolCallContext);
      await expect(
        session.agent.beforeToolCall?.(hookInput("edit", "edit-after-success", { path: "src/auth.ts" })),
      ).resolves.toBeUndefined();
    } finally {
      session.dispose();
    }
  });
});
