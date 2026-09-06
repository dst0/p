import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
  pendingProjectInstructionRuleBatches,
  projectInstructionToolHookInput,
} from "./project-instruction-delivery-fixture.ts";

afterEach(() => {
  cleanupProjectInstructionModeWorkspaces();
});

describe("compiled project-instruction route candidate lifecycle", () => {
  it("preserves an unread candidate across a later no-route turn", async () => {
    const workspace = createProjectInstructionModeWorkspace({
      additionalInstructions: ["## Ceruleanquartz\n\nPreserve ceruleanquartz behavior.\n"],
    });
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-candidate-no-route"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      const routed = session._createRuntimeContextPrompts("ceruleanquartz", session.systemPrompt);
      const [ceruleanquartzLink] = routed.projectRuleLinks ?? [];
      expect(ceruleanquartzLink).toBeDefined();

      const unrelated = session._createRuntimeContextPrompts("unrelated greeting", session.systemPrompt);
      expect(unrelated.projectRuleLinks).toBeUndefined();
      expect(session._projectRuleGate?.candidateLinks).toContain(ceruleanquartzLink);

      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/value.ts" })),
      ).resolves.toMatchObject({ block: true });
      expect(pendingProjectInstructionRuleBatches(session).flat()).toContain(ceruleanquartzLink);
    } finally {
      session.dispose();
    }
  });

  it("lets a later non-empty ordinary route replace an unread candidate", async () => {
    const workspace = createProjectInstructionModeWorkspace({
      additionalInstructions: [
        "## Ceruleanquartz\n\nPreserve ceruleanquartz behavior.\n",
        "## Amberzephyr\n\nPreserve amberzephyr behavior.\n",
      ],
    });
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-candidate-replacement"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      const first = session._createRuntimeContextPrompts("ceruleanquartz", session.systemPrompt);
      const [ceruleanquartzLink] = first.projectRuleLinks ?? [];
      const second = session._createRuntimeContextPrompts("amberzephyr", session.systemPrompt);
      const [amberzephyrLink] = second.projectRuleLinks ?? [];
      expect(ceruleanquartzLink).toBeDefined();
      expect(amberzephyrLink).toBeDefined();
      expect(amberzephyrLink).not.toBe(ceruleanquartzLink);
      expect(session._projectRuleGate?.candidateLinks).toContain(amberzephyrLink);
      expect(session._projectRuleGate?.candidateLinks).not.toContain(ceruleanquartzLink);
    } finally {
      session.dispose();
    }
  });
});
