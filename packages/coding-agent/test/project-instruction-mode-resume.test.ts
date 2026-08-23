import { join } from "node:path";
import type { AgentMessage } from "@dst0/p-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectInstructionDeliveryMode } from "../src/core/project-instructions/index.ts";
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

function messageText(messages: AgentMessage[]): string {
  return messages
    .map((message) => {
      if (message.role === "custom") {
        return typeof message.content === "string"
          ? message.content
          : message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
      }
      if (message.role === "compactionSummary" || message.role === "branchSummary") return message.summary;
      return "";
    })
    .join("\n");
}

async function resumeWithMode(
  mode: ProjectInstructionDeliveryMode,
  runtimeContent: string,
): Promise<{ text: string; runtimeDetails: unknown }> {
  const workspace = createProjectInstructionModeWorkspace();
  const manager = SessionManager.inMemory(workspace.root);
  manager.appendCustomMessageEntry("runtime_context", runtimeContent, false);
  const { session } = await createAgentSession({
    cwd: workspace.root,
    agentDir: join(workspace.root, `.agent-resume-${mode}`),
    resourceLoader: workspace.resourceLoader,
    sessionManager: manager,
    projectInstructionMode: mode,
    projectInstructionCompiler: workspace.compiler,
  });
  try {
    const prepared = session._preparePromptContext(session.messages).messages;
    const currentRuntime = session._createRuntimeContextPromptMessage("CURRENT", Date.now());
    return { text: messageText(prepared), runtimeDetails: currentRuntime.details };
  } finally {
    session.dispose();
  }
}

describe("project-instruction delivery mode resume isolation", () => {
  it("does not replay legacy raw rules into compiled or off mode", async () => {
    const legacyRuntime = "KEEP_RUNTIME\n<project_rules>RAW_LEGACY_RULE</project_rules>";
    for (const mode of ["compiled", "off"] as const) {
      const resumed = await resumeWithMode(mode, legacyRuntime);
      expect(resumed.text).not.toContain("RAW_LEGACY_RULE");
      expect(resumed.runtimeDetails).toMatchObject({ projectInstructionMode: mode });
    }
  });

  it("does not replay compiled routes into legacy or off mode", async () => {
    const compiledRuntime =
      'KEEP_RUNTIME\n<project_rule_routes input_sha256="old">OLD_COMPILED_ROUTE</project_rule_routes>';
    for (const mode of ["legacy", "off"] as const) {
      const resumed = await resumeWithMode(mode, compiledRuntime);
      expect(resumed.text).not.toContain("OLD_COMPILED_ROUTE");
      expect(resumed.runtimeDetails).toMatchObject({ projectInstructionMode: mode });
    }
  });

  it("removes stale instruction blocks from compaction summaries without dropping task state", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.inMemory(workspace.root);
    const firstKept = manager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "continue task" }],
      timestamp: Date.now(),
    });
    manager.appendCompaction(
      "KEEP_TASK_STATE\n<project_rules>STALE_SUMMARY_RULE</project_rules>\n<project_rule_routes>STALE_ROUTE</project_rule_routes>",
      firstKept,
      100,
      20,
    );
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-summary-resume"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: manager,
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      const text = messageText(session._preparePromptContext(session.messages).messages);
      expect(text).toContain("KEEP_TASK_STATE");
      expect(text).not.toMatch(/STALE_SUMMARY_RULE|STALE_ROUTE/u);
    } finally {
      session.dispose();
    }
  });

  it("preserves an unread routed gate across restart and a no-route continuation", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.inMemory(workspace.root);
    const initial = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-compiled-before-restart"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: manager,
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
      projectInstructionCompilerIdentity: "resume-gate-test",
    });
    const routed = initial.session._createRuntimeContextPrompts(
      "edit security credential handling",
      initial.session.systemPrompt,
    );
    const routedLinks = [...(routed.projectRuleLinks ?? [])];
    expect(routedLinks.length).toBeGreaterThan(0);
    manager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "edit security credential handling" }],
      timestamp: Date.now(),
    });
    const routedMessage = initial.session._createRuntimeContextPromptMessage(
      routed.turnContextPrompt!,
      Date.now(),
      routed.projectRuleGate,
    );
    manager.appendCustomMessageEntry(
      routedMessage.customType,
      routedMessage.content,
      routedMessage.display,
      routedMessage.details,
    );
    initial.session.dispose();

    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-compiled-unread-resume"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: manager,
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
      projectInstructionCompilerIdentity: "resume-gate-test",
    });
    try {
      expect(session._projectInstructions.state.current?.manifest.inputHash).toBe(routed.projectRuleGate?.inputHash);
      await session.steer("hello there");
      const queued = session.agent.steeringQueue.drain();
      await session.agent.runWithLifecycle(async () => {
        await session.agent.processEvents({ type: "turn_start" });
        for (const message of queued) {
          await session.agent.processEvents({ type: "message_start", message });
          await session.agent.processEvents({ type: "message_end", message });
        }
      });
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true });
      await executeProjectInstructionReadRules(session, routedLinks);
      const actionBatches = pendingProjectInstructionRuleBatches(session);
      expect(actionBatches).toHaveLength(1);
      await executeProjectInstructionReadRules(session, actionBatches[0]!);
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toBeUndefined();
    } finally {
      session.dispose();
    }
  });
});
