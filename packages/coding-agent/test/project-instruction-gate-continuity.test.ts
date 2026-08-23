import { join } from "node:path";
import type { AgentMessage } from "@dst0/p-agent-core";
import { fauxAssistantMessage } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { installCacheRoutingProjectInstructions } from "./project-instruction-compiler-fixture.ts";
import {
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
  executeProjectInstructionReadRules,
  pendingProjectInstructionRuleBatches,
  projectInstructionToolHookInput,
} from "./project-instruction-delivery-fixture.ts";
import { createHarness } from "./suite/harness.ts";

afterEach(() => {
  cleanupProjectInstructionModeWorkspaces();
});

describe("compiled project-instruction gate continuity", () => {
  it("preserves uncommitted route candidates across a normal no-route follow-up", async () => {
    const harness = await createHarness({ completionMode: "implicit" });
    try {
      await installCacheRoutingProjectInstructions(
        harness.session,
        harness.tempDir,
        `# Security credential handling\n\nRead the security rule before editing credentials. ${"detail ".repeat(800)}\n`,
      );
      harness.setResponses([fauxAssistantMessage("Which file?"), fauxAssistantMessage("Understood.")]);
      await harness.session.prompt("edit security credential handling");
      await harness.session.prompt("hello there");

      await expect(
        harness.session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true });
      const [authoritativeBatch] = pendingProjectInstructionRuleBatches(harness.session);
      expect(authoritativeBatch?.length).toBeGreaterThan(0);
      await executeProjectInstructionReadRules(harness.session, authoritativeBatch!);
      await expect(
        harness.session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toBeUndefined();
    } finally {
      harness.cleanup();
    }
  });

  it("preserves the active gate across the real second turn_start before queued messages", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-steering-recovery"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      const matching = session._createRuntimeContextPrompts("edit security credential handling", session.systemPrompt);
      expect(matching.projectRuleLinks?.length).toBeGreaterThan(0);
      const initialUser: AgentMessage = {
        role: "user",
        content: [{ type: "text", text: "edit security credential handling" }],
        timestamp: Date.now(),
      };
      await session.steer("hello there");
      const queued = session.agent.steeringQueue.drain();

      await session.agent.runWithLifecycle(async () => {
        await session.agent.processEvents({ type: "turn_start" });
        await session.agent.processEvents({ type: "message_start", message: initialUser });
        await session.agent.processEvents({ type: "message_end", message: initialUser });
        await session.agent.processEvents({ type: "turn_start" });
        for (const message of queued) {
          await session.agent.processEvents({ type: "message_start", message });
          await session.agent.processEvents({ type: "message_end", message });
        }
      });

      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/auth.ts" })),
      ).resolves.toMatchObject({ block: true });
    } finally {
      session.dispose();
    }
  });
});
