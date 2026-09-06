import { join } from "node:path";
import type { AfterToolCallContext } from "@dst0/p-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { TASK_VERIFICATION_TOOL_NAME } from "../src/core/task-verification.ts";
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

describe("compiled project instructions with evidence verification", () => {
  it("requires one exact rule batch and one prompt-bound checklist before mutation", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.inMemory(workspace.root);
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-project-rules-with-evidence"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: manager,
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
      taskVerificationMode: "evidence",
    });
    try {
      const prompt = "Edit security credential handling without exposing credential values in logs.";
      const message = { role: "user" as const, content: prompt, timestamp: Date.now() };
      await session.agent.runWithLifecycle(async () => {
        await session.agent.processEvents({ type: "turn_start" });
        await session.agent.processEvents({ type: "message_start", message });
        await session.agent.processEvents({ type: "message_end", message });
      });
      const routed = session._createRuntimeContextPrompts(prompt, session.systemPrompt);
      expect(routed.projectRuleLinks?.length).toBeGreaterThanOrEqual(1);
      expect(routed.projectRuleLinks?.length).toBeLessThanOrEqual(3);
      expect(session._taskVerificationMode).toBe("evidence");

      const checklistArgs = {
        action: "record_completion_checklist",
        completion_checklist: ["Credential handling changes never expose credential values in logs"],
      };
      const checklistCall = projectInstructionToolHookInput(TASK_VERIFICATION_TOOL_NAME, checklistArgs);
      await expect(session.agent.beforeToolCall?.(checklistCall)).resolves.toBeUndefined();
      const checklistResult = await session
        .getToolDefinition(TASK_VERIFICATION_TOOL_NAME)!
        .execute(checklistCall.toolCall.id, checklistArgs, undefined, undefined, {} as ExtensionContext);
      await session.agent.afterToolCall?.({
        ...checklistCall,
        result: checklistResult,
        isError: false,
        context: { messages: [] },
      } as unknown as AfterToolCallContext);
      const verificationState = session._taskVerificationRuntime?.controller.currentState;
      expect(verificationState?.taskPrompts?.map((item) => item.text)).toEqual([prompt]);
      expect(verificationState?.completionChecklist?.sourcePromptIds).toEqual(
        verificationState?.taskPrompts?.map((item) => item.id),
      );

      const mutationArgs = { path: "src/auth.ts", content: "export const protectsCredentials = true;\n" };
      const firstMutation = projectInstructionToolHookInput("write", mutationArgs);
      const blocked = await session.agent.beforeToolCall?.(firstMutation);
      const [batch] = pendingProjectInstructionRuleBatches(session);
      expect(batch?.length).toBeGreaterThanOrEqual(1);
      expect(batch?.length).toBeLessThanOrEqual(3);
      expect(blocked).toEqual({
        block: true,
        reason: `Call read_rules with each selected authoritative batch before continuing: ${JSON.stringify([
          { links: batch },
        ])}.`,
      });

      await executeProjectInstructionReadRules(session, batch!);
      expect(pendingProjectInstructionRuleBatches(session)).toEqual([]);
      await expect(session.agent.beforeToolCall?.(firstMutation)).resolves.toBeUndefined();
      expect(pendingProjectInstructionRuleBatches(session)).toEqual([]);
    } finally {
      session.dispose();
    }
  });
});
