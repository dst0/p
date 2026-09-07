import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

describe("compiled project instruction single-batch gate", () => {
  it("allows discovery and fixes one turn-selected batch before the first mutation", async () => {
    const workspace = createProjectInstructionModeWorkspace({
      additionalInstructions: [
        "## Implementation\n\nModify calculator source files carefully.\n",
        "## Testing\n\nRun focused calculator tests after implementation.\n",
        "## Delivery\n\nPublish release artifacts only after verification.\n",
      ],
    });
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-single-batch-gate"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
      taskVerificationMode: "off",
    });
    try {
      const turn = session._createRuntimeContextPrompts(
        "Implement the calculator library and run its focused tests.",
        session.systemPrompt,
      );
      expect(turn.projectRuleLinks?.length).toBeGreaterThanOrEqual(1);
      expect(turn.projectRuleLinks?.length).toBeLessThanOrEqual(3);

      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("read", { path: "requirements.md" })),
      ).resolves.toBeUndefined();
      expect(pendingProjectInstructionRuleBatches(session)).toEqual([]);
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("bash", { command: "cat requirements.md" })),
      ).resolves.toBeUndefined();
      expect(pendingProjectInstructionRuleBatches(session)).toEqual([]);

      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("write", { path: "src/calculator.ts" })),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining("read_rules") });
      const [authoritativeBatch] = pendingProjectInstructionRuleBatches(session);
      expect(authoritativeBatch?.length).toBeGreaterThanOrEqual(1);
      expect(authoritativeBatch?.length).toBeLessThanOrEqual(3);
      expect(authoritativeBatch?.filter((link) => turn.projectRuleLinks?.includes(link))).toHaveLength(2);

      await executeProjectInstructionReadRules(session, authoritativeBatch!);
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("bash", { command: "npm run test:unit" })),
      ).resolves.toBeUndefined();
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("write", { path: "test/calculator.test.ts" })),
      ).resolves.toBeUndefined();
      expect(pendingProjectInstructionRuleBatches(session)).toEqual([]);
    } finally {
      session.dispose();
    }
  });

  it("reserves one bounded batch slot for the first mutating action", async () => {
    const workspace = createProjectInstructionModeWorkspace({
      additionalInstructions: [
        "## Alpha workflow\n\nFollow the alpha workflow when requested.\n",
        "## Beta workflow\n\nFollow the beta workflow when requested.\n",
        "## Gamma workflow\n\nFollow the gamma workflow when requested.\n",
      ],
    });
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-action-reservation"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      const turn = session._createRuntimeContextPrompts("alpha beta gamma", session.systemPrompt);
      expect(turn.projectRuleLinks).toHaveLength(3);
      const rules = session._projectInstructions.state.current?.manifest.rules ?? [];
      const codeChecksLink = rules.find((rule) => rule.title === "Code checks")?.link;
      expect(codeChecksLink).toBeDefined();
      expect(turn.projectRuleLinks).not.toContain(codeChecksLink);

      await expect(
        session.agent.beforeToolCall?.(
          projectInstructionToolHookInput("write", { path: "src/calculator.ts", content: "export const x = 1;" }),
        ),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining("read_rules") });
      const [batch] = pendingProjectInstructionRuleBatches(session);
      expect(batch).toHaveLength(3);
      expect(batch).toContain(codeChecksLink);
      expect(batch?.filter((link) => turn.projectRuleLinks?.includes(link))).toHaveLength(2);
    } finally {
      session.dispose();
    }
  });
});
