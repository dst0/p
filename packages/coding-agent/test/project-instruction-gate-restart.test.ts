import { join } from "node:path";
import { fauxAssistantMessage } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session/agentsession.ts";
import {
  PROJECT_RULE_BATCH_CUSTOM_TYPE,
  PROJECT_RULE_RECEIPT_CUSTOM_TYPE,
} from "../src/core/agent-session/project-instruction-integrity.ts";
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

type Workspace = ReturnType<typeof createProjectInstructionModeWorkspace>;

async function createCompiledSession(workspace: Workspace, manager: SessionManager, suffix: string) {
  return createAgentSession({
    cwd: workspace.root,
    agentDir: join(workspace.root, `.agent-gate-restart-${suffix}`),
    resourceLoader: workspace.resourceLoader,
    sessionManager: manager,
    projectInstructionMode: "compiled",
    projectInstructionCompiler: workspace.compiler,
    projectInstructionCompilerIdentity: "gate-restart-test",
  });
}

async function persistRoutedTurn(session: AgentSession, manager: SessionManager): Promise<string[]> {
  const routed = session._createRuntimeContextPrompts("edit security credential handling", session.systemPrompt);
  const links = [...(routed.projectRuleLinks ?? [])];
  expect(links.length).toBeGreaterThan(0);
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "edit security credential handling" }],
    timestamp: Date.now(),
  });
  const runtimeMessage = session._createRuntimeContextPromptMessage(
    routed.turnContextPrompt!,
    Date.now(),
    routed.projectRuleGate,
  );
  manager.appendCustomMessageEntry(
    runtimeMessage.customType,
    runtimeMessage.content,
    runtimeMessage.display,
    runtimeMessage.details,
  );
  await expect(
    session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
  ).resolves.toMatchObject({ block: true });
  const [authoritative] = pendingProjectInstructionRuleBatches(session);
  expect(authoritative).toEqual(expect.arrayContaining(links));
  return authoritative!;
}

describe("compiled project-instruction gate restart persistence", () => {
  it("does not reopen a satisfied historical gate after restart", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.create(workspace.root, join(workspace.root, ".sessions"));
    const initial = await createCompiledSession(workspace, manager, "satisfied-initial");
    const links = await persistRoutedTurn(initial.session, manager);
    manager.appendMessage(fauxAssistantMessage("Reading the selected rules."));
    await executeProjectInstructionReadRules(initial.session, links);
    expect(
      manager
        .getBranch()
        .filter((entry) => entry.type === "custom" && entry.customType === PROJECT_RULE_RECEIPT_CUSTOM_TYPE),
    ).toHaveLength(1);
    expect(
      manager
        .buildSessionContext()
        .messages.some(
          (message) => message.role === "custom" && message.customType === PROJECT_RULE_RECEIPT_CUSTOM_TYPE,
        ),
    ).toBe(false);
    const sessionFile = manager.getSessionFile();
    expect(sessionFile).toBeDefined();
    initial.session.dispose();

    const reopenedManager = SessionManager.open(sessionFile!);
    const resumed = await createCompiledSession(workspace, reopenedManager, "satisfied-resumed");
    try {
      resumed.session._createRuntimeContextPrompts("hello there", resumed.session.systemPrompt);
      const editCall = projectInstructionToolHookInput("edit", { path: "src/auth.ts" });
      await expect(resumed.session.agent.beforeToolCall?.(editCall)).resolves.toMatchObject({ block: true });
      const actionBatches = pendingProjectInstructionRuleBatches(resumed.session);
      expect(actionBatches).toHaveLength(1);
      expect(actionBatches[0]).not.toEqual(links);
      await executeProjectInstructionReadRules(resumed.session, actionBatches[0]!);
      await expect(resumed.session.agent.beforeToolCall?.(editCall)).resolves.toBeUndefined();
    } finally {
      resumed.session.dispose();
    }
  });

  it("preserves an unread gate omitted from compacted model history", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.inMemory(workspace.root);
    const initial = await createCompiledSession(workspace, manager, "compacted-initial");
    await persistRoutedTurn(initial.session, manager);
    const firstKeptEntryId = manager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "hello there" }],
      timestamp: Date.now(),
    });
    manager.appendCompaction("Task remains active.", firstKeptEntryId, 100, 20);
    initial.session.dispose();

    const resumed = await createCompiledSession(workspace, manager, "compacted-resumed");
    try {
      resumed.session._createRuntimeContextPrompts("hello there", resumed.session.systemPrompt);
      await expect(
        resumed.session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true });
    } finally {
      resumed.session.dispose();
    }
  });

  it("restores a model-hidden action batch after compaction without duplicating it", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.inMemory(workspace.root);
    const initial = await createCompiledSession(workspace, manager, "action-compacted-initial");
    initial.session._createRuntimeContextPrompts("fix the bug", initial.session.systemPrompt);
    const testCall = projectInstructionToolHookInput("bash", { command: "npm test" });
    await expect(initial.session.agent.beforeToolCall?.(testCall)).resolves.toMatchObject({ block: true });
    const actionEntries = () =>
      manager
        .getBranch()
        .filter((entry) => entry.type === "custom" && entry.customType === PROJECT_RULE_BATCH_CUSTOM_TYPE);
    expect(actionEntries()).toHaveLength(1);
    expect(
      manager
        .buildSessionContext()
        .messages.some((message) => message.role === "custom" && message.customType === PROJECT_RULE_BATCH_CUSTOM_TYPE),
    ).toBe(false);
    const firstKeptEntryId = manager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "continue the fix" }],
      timestamp: Date.now(),
    });
    manager.appendCompaction("Task remains active.", firstKeptEntryId, 100, 20);
    initial.session.dispose();

    const resumed = await createCompiledSession(workspace, manager, "action-compacted-resumed");
    try {
      resumed.session._createRuntimeContextPrompts("continue the fix", resumed.session.systemPrompt);
      await expect(resumed.session.agent.beforeToolCall?.(testCall)).resolves.toMatchObject({ block: true });
      expect(actionEntries()).toHaveLength(1);
      const testingLink = resumed.session._projectInstructions.state.current?.manifest.rules.find(
        (rule) => rule.title === "Testing",
      )?.link;
      expect(testingLink).toBeDefined();
      const restoredBatch = pendingProjectInstructionRuleBatches(resumed.session).find((batch) =>
        batch.includes(testingLink!),
      );
      expect(restoredBatch).toBeDefined();
      await executeProjectInstructionReadRules(resumed.session, restoredBatch!);
      await expect(resumed.session.agent.beforeToolCall?.(testCall)).resolves.toBeUndefined();
    } finally {
      resumed.session.dispose();
    }
  });

  it("deduplicates overlapping identical routed turns into one same-hash receipt", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.inMemory(workspace.root);
    const initial = await createCompiledSession(workspace, manager, "duplicate-initial");
    const firstLinks = await persistRoutedTurn(initial.session, manager);
    expect(await persistRoutedTurn(initial.session, manager)).toEqual(firstLinks);
    expect(
      manager
        .getBranch()
        .filter((entry) => entry.type === "custom" && entry.customType === PROJECT_RULE_BATCH_CUSTOM_TYPE),
    ).toHaveLength(1);
    initial.session.dispose();

    const resumed = await createCompiledSession(workspace, manager, "duplicate-resumed");
    try {
      resumed.session._createRuntimeContextPrompts("hello there", resumed.session.systemPrompt);
      await expect(
        resumed.session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true });
      await executeProjectInstructionReadRules(resumed.session, firstLinks);
      expect(pendingProjectInstructionRuleBatches(resumed.session)).toEqual([]);
      expect(
        manager
          .getBranch()
          .filter((entry) => entry.type === "custom" && entry.customType === PROJECT_RULE_RECEIPT_CUSTOM_TYPE),
      ).toHaveLength(1);
      await expect(
        resumed.session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toBeUndefined();
    } finally {
      resumed.session.dispose();
    }
  });

  it.each(["malformed", "orphan"] as const)("fails closed on a %s receipt after restart", async (kind) => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.inMemory(workspace.root);
    const initial = await createCompiledSession(workspace, manager, `${kind}-receipt-initial`);
    const inputHash = initial.session._projectInstructions.state.current?.manifest.inputHash;
    expect(inputHash).toBeDefined();
    manager.appendCustomEntry(
      PROJECT_RULE_RECEIPT_CUSTOM_TYPE,
      kind === "malformed"
        ? { version: 1, inputHash: 42, links: ["rules/orphan.md"] }
        : { version: 1, inputHash, links: ["rules/orphan.md"] },
    );
    initial.session.dispose();

    const resumed = await createCompiledSession(workspace, manager, `${kind}-receipt-resumed`);
    try {
      resumed.session._createRuntimeContextPrompts("hello there", resumed.session.systemPrompt);
      await expect(
        resumed.session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining("cannot be verified") });
    } finally {
      resumed.session.dispose();
    }
  });

  it("does not apply a receipt from a sibling branch", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.inMemory(workspace.root);
    const initial = await createCompiledSession(workspace, manager, "branch-initial");
    const links = await persistRoutedTurn(initial.session, manager);
    const routedEntryId = manager.getLeafId();
    expect(routedEntryId).toBeDefined();
    await executeProjectInstructionReadRules(initial.session, links);
    expect(
      manager
        .getEntries()
        .filter((entry) => entry.type === "custom" && entry.customType === PROJECT_RULE_RECEIPT_CUSTOM_TYPE),
    ).toHaveLength(1);
    manager.branch(routedEntryId!);
    manager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "continue on sibling branch" }],
      timestamp: Date.now(),
    });
    expect(
      manager
        .getBranch()
        .some((entry) => entry.type === "custom" && entry.customType === PROJECT_RULE_RECEIPT_CUSTOM_TYPE),
    ).toBe(false);
    initial.session.dispose();

    const resumed = await createCompiledSession(workspace, manager, "branch-resumed");
    try {
      resumed.session._createRuntimeContextPrompts("hello there", resumed.session.systemPrompt);
      await expect(
        resumed.session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true });
    } finally {
      resumed.session.dispose();
    }
  });

  it("fails closed when a compaction summary contains unverifiable route state", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.inMemory(workspace.root);
    const initial = await createCompiledSession(workspace, manager, "summary-initial");
    const links = await persistRoutedTurn(initial.session, manager);
    await executeProjectInstructionReadRules(initial.session, links);
    const firstKeptEntryId = manager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "continue task" }],
      timestamp: Date.now(),
    });
    manager.appendCompaction(
      "Task remains active.\n<project_rule_routes>unverifiable route</project_rule_routes>",
      firstKeptEntryId,
      100,
      20,
    );
    initial.session.dispose();

    const resumed = await createCompiledSession(workspace, manager, "summary-resumed");
    try {
      resumed.session._createRuntimeContextPrompts("hello there", resumed.session.systemPrompt);
      await expect(
        resumed.session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining("cannot be verified") });
    } finally {
      resumed.session.dispose();
    }
  });
});
