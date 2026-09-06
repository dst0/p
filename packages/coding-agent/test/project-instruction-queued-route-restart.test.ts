import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@dst0/p-agent-core";
import { fauxAssistantMessage } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session/agentsession.ts";
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

function createCompiledSession(workspace: Workspace, manager: SessionManager, suffix: string) {
  return createAgentSession({
    cwd: workspace.root,
    agentDir: join(workspace.root, `.agent-queued-restart-${suffix}`),
    resourceLoader: workspace.resourceLoader,
    sessionManager: manager,
    projectInstructionMode: "compiled",
    projectInstructionCompiler: workspace.compiler,
    projectInstructionCompilerIdentity: "queued-route-restart-test",
  });
}

describe("queued compiled project-instruction restart persistence", () => {
  it("filters covered links before applying the three-link restored-candidate cap", async () => {
    const workspace = createProjectInstructionModeWorkspace({
      additionalInstructions: [
        "## Ceruleanquartz\n\nPreserve ceruleanquartz behavior.\n",
        "## Amberzephyr\n\nPreserve amberzephyr behavior.\n",
        "## Violetcascade\n\nPreserve violetcascade behavior.\n",
        "## Obsidianharbor\n\nPreserve obsidianharbor behavior.\n",
      ],
    });
    const manager = SessionManager.create(workspace.root, join(workspace.root, ".sessions-cap"));
    const initial = await createCompiledSession(workspace, manager, "cap-initial");
    let initialBatch: string[] = [];
    let expectedUncoveredLinks: string[] = [];
    let sessionFile: string | undefined;
    try {
      initial.session._createRuntimeContextPrompts("ceruleanquartz", initial.session.systemPrompt);
      await initial.session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/value.ts" }));
      [initialBatch] = pendingProjectInstructionRuleBatches(initial.session) as [string[]];
      expect(initialBatch.length).toBeGreaterThan(0);

      initial.session.agent.steeringMode = "all";
      for (const query of ["ceruleanquartz", "amberzephyr", "violetcascade", "obsidianharbor"]) {
        await initial.session.steer(query);
      }
      const queued = initial.session.agent.steeringQueue.drain();
      expectedUncoveredLinks = [...new Set(queuedRouteBatches(queued).flat())].filter(
        (link) => !initialBatch.includes(link),
      );
      expect(expectedUncoveredLinks).toHaveLength(3);
      await processQueuedMessages(initial.session, queued);
      expect(initial.session._projectRuleGate?.candidateLinks).toEqual(expectedUncoveredLinks);
      manager.appendMessage(fauxAssistantMessage("Queued requests acknowledged."));
      sessionFile = manager.getSessionFile();
      expect(sessionFile).toBeDefined();
      expect(existsSync(sessionFile!)).toBe(true);
    } finally {
      initial.session.dispose();
    }

    const reopenedManager = SessionManager.open(sessionFile!);
    const resumed = await createCompiledSession(workspace, reopenedManager, "cap-resumed");
    try {
      resumed.session._createRuntimeContextPrompts("unrelated greeting", resumed.session.systemPrompt);
      await executeProjectInstructionReadRules(resumed.session, initialBatch);
      await expect(
        resumed.session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/value.ts" })),
      ).resolves.toMatchObject({ block: true });
      const [restoredQueuedBatch] = pendingProjectInstructionRuleBatches(resumed.session);
      const codeChecksLink = resumed.session._projectInstructions.state.current?.manifest.rules.find(
        (rule) => rule.title === "Code checks",
      )?.link;
      expect(codeChecksLink).toBeDefined();
      expect(restoredQueuedBatch).toContain(codeChecksLink);
      expect(restoredQueuedBatch?.filter((link) => expectedUncoveredLinks.includes(link))).toHaveLength(2);
      expect(restoredQueuedBatch).toHaveLength(3);
    } finally {
      resumed.session.dispose();
    }
  });

  it("fails closed when only a persisted routed candidate has a stale source hash", async () => {
    const workspace = createProjectInstructionModeWorkspace({
      additionalInstructions: ["## Ceruleanquartz\n\nPreserve ceruleanquartz behavior.\n"],
    });
    workspace.resourceLoader.getAgentsFiles = () => ({
      agentsFiles: [{ path: workspace.agentsPath, content: readFileSync(workspace.agentsPath, "utf8") }],
    });
    const manager = SessionManager.inMemory(workspace.root);
    const initial = await createCompiledSession(workspace, manager, "stale-initial");
    try {
      const routed = initial.session._createRuntimeContextPrompts("ceruleanquartz", initial.session.systemPrompt);
      persistRoutedTurn(initial.session, manager, "ceruleanquartz", routed);
    } finally {
      initial.session.dispose();
    }
    appendFileSync(workspace.agentsPath, "\n## New safety route\n\nInspect the changed instruction source.\n");

    const resumed = await createCompiledSession(workspace, manager, "stale-resumed");
    try {
      resumed.session._createRuntimeContextPrompts("unrelated greeting", resumed.session.systemPrompt);
      await expect(
        resumed.session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/value.ts" })),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining("changed") });
    } finally {
      resumed.session.dispose();
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

async function processQueuedMessages(session: AgentSession, messages: AgentMessage[]): Promise<void> {
  await session.agent.runWithLifecycle(async () => {
    await session.agent.processEvents({ type: "turn_start" });
    for (const message of messages) {
      await session.agent.processEvents({ type: "message_start", message });
      await session.agent.processEvents({ type: "message_end", message });
    }
  });
}

function persistRoutedTurn(
  session: AgentSession,
  manager: SessionManager,
  query: string,
  routed: ReturnType<AgentSession["_createRuntimeContextPrompts"]>,
): void {
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: query }],
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
}
