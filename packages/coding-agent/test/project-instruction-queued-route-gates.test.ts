import { join } from "node:path";
import type { AgentMessage } from "@dst0/p-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import { PROJECT_RULE_BATCH_CUSTOM_TYPE } from "../src/core/agent-session/project-instruction-integrity.ts";
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

describe("queued compiled project-instruction route gates", () => {
  it("combines disjoint queued candidates into one authoritative read", async () => {
    const workspace = createProjectInstructionModeWorkspace({
      additionalInstructions: [
        "## Ceruleanquartz\n\nPreserve ceruleanquartz behavior.\n",
        "## Amberzephyr\n\nPreserve amberzephyr behavior.\n",
      ],
    });
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-queued"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
      taskVerificationMode: "off",
    });
    try {
      session.agent.steeringMode = "all";
      await session.steer("ceruleanquartz");
      await session.steer("amberzephyr");
      const queued = session.agent.steeringQueue.drain();
      expect(queued.map((message) => message.role)).toEqual(["user", "custom", "user", "custom"]);
      const batches = queuedRouteBatches(queued);
      expect(batches).toHaveLength(2);
      expect(batches.every((links) => links.length === 1)).toBe(true);
      const expectedQueuedLinks = [...new Set(batches.flat())];
      expect(expectedQueuedLinks).toHaveLength(2);

      await session.agent.runWithLifecycle(async () => {
        await session.agent.processEvents({ type: "turn_start" });
        for (const message of queued) {
          await session.agent.processEvents({ type: "message_start", message });
          await session.agent.processEvents({ type: "message_end", message });
        }
      });

      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/value.ts" })),
      ).resolves.toMatchObject({ block: true });
      const [authoritativeBatch] = pendingProjectInstructionRuleBatches(session);
      expect(authoritativeBatch).toEqual(expect.arrayContaining(expectedQueuedLinks));
      expect(authoritativeBatch!.length).toBeLessThanOrEqual(3);
      await executeProjectInstructionReadRules(session, authoritativeBatch!);
      expect(pendingProjectInstructionRuleBatches(session)).toEqual([]);
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/value.ts" })),
      ).resolves.toBeUndefined();
    } finally {
      session.dispose();
    }
  });

  it("stages queued candidates after the preceding authoritative read completes", async () => {
    const workspace = createProjectInstructionModeWorkspace({
      additionalInstructions: [
        "## Ceruleanquartz\n\nPreserve ceruleanquartz behavior.\n",
        "## Amberzephyr\n\nPreserve amberzephyr behavior.\n",
        "## Violetcascade\n\nPreserve violetcascade behavior.\n",
      ],
    });
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-pending-queued"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
      taskVerificationMode: "off",
    });
    try {
      session._createRuntimeContextPrompts("ceruleanquartz", session.systemPrompt);
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/value.ts" })),
      ).resolves.toMatchObject({ block: true });
      const [initialBatch] = pendingProjectInstructionRuleBatches(session);

      session.agent.steeringMode = "all";
      await session.steer("amberzephyr");
      await session.steer("violetcascade");
      const queued = session.agent.steeringQueue.drain();
      const expectedQueuedLinks = [...new Set(queuedRouteBatches(queued).flat())];
      expect(expectedQueuedLinks).toHaveLength(2);
      await processQueuedMessages(session, queued);

      await executeProjectInstructionReadRules(session, initialBatch!);
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/value.ts" })),
      ).resolves.toMatchObject({ block: true });
      const [queuedBatch] = pendingProjectInstructionRuleBatches(session);
      expect(queuedBatch).toEqual(expect.arrayContaining(expectedQueuedLinks));
      expect(queuedBatch!.length).toBeLessThanOrEqual(3);
      await executeProjectInstructionReadRules(session, queuedBatch!);
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/value.ts" })),
      ).resolves.toBeUndefined();
    } finally {
      session.dispose();
    }
  });

  it("stages a queued candidate delivered after the preceding batch is satisfied", async () => {
    const workspace = createProjectInstructionModeWorkspace({
      additionalInstructions: [
        "## Ceruleanquartz\n\nPreserve ceruleanquartz behavior.\n",
        "## Amberzephyr\n\nPreserve amberzephyr behavior.\n",
      ],
    });
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-satisfied-queued"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
      taskVerificationMode: "off",
    });
    try {
      session._createRuntimeContextPrompts("ceruleanquartz", session.systemPrompt);
      await session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/value.ts" }));
      const [initialBatch] = pendingProjectInstructionRuleBatches(session);
      await executeProjectInstructionReadRules(session, initialBatch!);

      session.agent.steeringMode = "all";
      await session.steer("amberzephyr");
      const queued = session.agent.steeringQueue.drain();
      const [expectedQueuedLinks] = queuedRouteBatches(queued);
      await processQueuedMessages(session, queued);

      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/value.ts" })),
      ).resolves.toMatchObject({ block: true });
      const [queuedBatch] = pendingProjectInstructionRuleBatches(session);
      expect(queuedBatch).toEqual(expect.arrayContaining(expectedQueuedLinks!));
    } finally {
      session.dispose();
    }
  });

  it("restores merged queued candidates after an authoritative batch", async () => {
    const workspace = createProjectInstructionModeWorkspace({
      additionalInstructions: [
        "## Ceruleanquartz\n\nPreserve ceruleanquartz behavior.\n",
        "## Amberzephyr\n\nPreserve amberzephyr behavior.\n",
        "## Violetcascade\n\nPreserve violetcascade behavior.\n",
      ],
    });
    const manager = SessionManager.inMemory(workspace.root);
    const createSession = (suffix: string) =>
      createAgentSession({
        cwd: workspace.root,
        agentDir: join(workspace.root, `.agent-queued-restart-${suffix}`),
        resourceLoader: workspace.resourceLoader,
        sessionManager: manager,
        projectInstructionMode: "compiled",
        projectInstructionCompiler: workspace.compiler,
        projectInstructionCompilerIdentity: "queued-route-restart-test",
        taskVerificationMode: "off",
      });
    const initial = await createSession("initial");
    let initialBatch: string[] = [];
    let expectedQueuedLinks: string[] = [];
    try {
      initial.session._createRuntimeContextPrompts("ceruleanquartz", initial.session.systemPrompt);
      await initial.session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/value.ts" }));
      [initialBatch] = pendingProjectInstructionRuleBatches(initial.session) as [string[]];
      expect(initialBatch.length).toBeGreaterThan(0);
      initial.session.agent.steeringMode = "all";
      await initial.session.steer("amberzephyr");
      await initial.session.steer("violetcascade");
      const queued = initial.session.agent.steeringQueue.drain();
      expectedQueuedLinks = [...new Set(queuedRouteBatches(queued).flat())];
      expect(expectedQueuedLinks).toHaveLength(2);
      await processQueuedMessages(initial.session, queued);
      expect(
        manager
          .getBranch()
          .filter((entry) => entry.type === "custom" && entry.customType === PROJECT_RULE_BATCH_CUSTOM_TYPE),
      ).toHaveLength(1);
    } finally {
      initial.session.dispose();
    }

    const resumed = await createSession("resumed");
    try {
      resumed.session._createRuntimeContextPrompts("unrelated greeting", resumed.session.systemPrompt);
      const restoredBatches = pendingProjectInstructionRuleBatches(resumed.session);
      expect(restoredBatches).toContainEqual(initialBatch);
      const restoredInitial = restoredBatches.find((batch) => batch.every((link) => initialBatch.includes(link)));
      await executeProjectInstructionReadRules(resumed.session, restoredInitial!);
      await expect(
        resumed.session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/value.ts" })),
      ).resolves.toMatchObject({ block: true });
      const [restoredQueuedBatch] = pendingProjectInstructionRuleBatches(resumed.session);
      expect(restoredQueuedBatch).toEqual(expect.arrayContaining(expectedQueuedLinks));
    } finally {
      resumed.session.dispose();
    }
  });

  it("preserves the active gate when a queued user turn has no matching route", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-no-route-queued"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
      taskVerificationMode: "off",
    });
    try {
      const initialTurn = session._createRuntimeContextPrompts(
        "edit security credential handling",
        session.systemPrompt,
      );
      const initialLinks = [...(initialTurn.projectRuleLinks ?? [])];
      expect(initialLinks.length).toBeGreaterThan(0);
      const initialUser: AgentMessage = {
        role: "user",
        content: [{ type: "text", text: "edit security credential handling" }],
        timestamp: Date.now(),
      };
      await session.steer("unrelated greeting with no matching route terms");
      const queued = session.agent.steeringQueue.drain();

      await session.agent.runWithLifecycle(async () => {
        await session.agent.processEvents({ type: "turn_start" });
        await session.agent.processEvents({ type: "message_start", message: initialUser });
        await session.agent.processEvents({ type: "message_end", message: initialUser });
        for (const message of queued) {
          await session.agent.processEvents({ type: "message_start", message });
          await session.agent.processEvents({ type: "message_end", message });
        }
      });

      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true });
      const [authoritativeBatch] = pendingProjectInstructionRuleBatches(session);
      expect(authoritativeBatch).toEqual(expect.arrayContaining(initialLinks));
      await executeProjectInstructionReadRules(session, authoritativeBatch!);
      expect(pendingProjectInstructionRuleBatches(session)).toEqual([]);
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toBeUndefined();
    } finally {
      session.dispose();
    }
  });
});

function queuedRouteBatches(messages: AgentMessage[]): string[][] {
  return messages.flatMap((message) =>
    message.role === "custom" && message.customType === "runtime_context" && typeof message.content === "string"
      ? [[...message.content.matchAll(/`(rules\/[a-z0-9./-]+)`/gu)].map((match) => match[1]!)]
      : [],
  );
}

async function processQueuedMessages(
  session: Awaited<ReturnType<typeof createAgentSession>>["session"],
  messages: AgentMessage[],
): Promise<void> {
  await session.agent.runWithLifecycle(async () => {
    await session.agent.processEvents({ type: "turn_start" });
    for (const message of messages) {
      await session.agent.processEvents({ type: "message_start", message });
      await session.agent.processEvents({ type: "message_end", message });
    }
  });
}
