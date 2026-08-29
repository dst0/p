import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session/agentsession.ts";
import { PROJECT_RULE_SUPERSESSION_CUSTOM_TYPE } from "../src/core/agent-session/project-instruction-integrity.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
  executeProjectInstructionReadRules,
  projectInstructionToolHookInput,
} from "./project-instruction-delivery-fixture.ts";

afterEach(() => {
  cleanupProjectInstructionModeWorkspaces();
});

type Workspace = ReturnType<typeof createProjectInstructionModeWorkspace>;

async function createCompiledSession(workspace: Workspace, manager: SessionManager, suffix: string) {
  return createAgentSession({
    cwd: workspace.root,
    agentDir: join(workspace.root, `.agent-reload-${suffix}`),
    resourceLoader: workspace.resourceLoader,
    sessionManager: manager,
    projectInstructionMode: "compiled",
    projectInstructionCompiler: workspace.compiler,
    projectInstructionCompilerIdentity: "reload-supersession-test",
  });
}

function persistUnreadRoutedTurn(session: AgentSession, manager: SessionManager): void {
  const routed = session._createRuntimeContextPrompts("edit security credential handling", session.systemPrompt);
  expect(routed.projectRuleLinks?.length).toBeGreaterThan(0);
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
}

describe("compiled project-instruction reload supersession", () => {
  it("durably supersedes a restored stale gate after sources change and reload succeeds", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.create(workspace.root, join(workspace.root, ".sessions"));
    const initial = await createCompiledSession(workspace, manager, "initial");
    persistUnreadRoutedTurn(initial.session, manager);
    const oldHash = initial.session._projectInstructions.state.current?.manifest.inputHash;
    initial.session.dispose();

    const sessionFile = manager.getSessionFile();
    expect(sessionFile).toBeDefined();
    const reopenedManager = SessionManager.open(sessionFile!);
    const reopened = await createCompiledSession(workspace, reopenedManager, "reopened");
    appendFileSync(workspace.agentsPath, "\n## Reloaded checksum\n\nPreserve checksum integrity.\n");
    await reopened.session.reload();
    const newHash = reopened.session._projectInstructions.state.current?.manifest.inputHash;
    expect(newHash).not.toBe(oldHash);
    expect(
      reopenedManager
        .getBranch()
        .some((entry) => entry.type === "custom" && entry.customType === PROJECT_RULE_SUPERSESSION_CUSTOM_TYPE),
    ).toBe(true);
    reopened.session.dispose();

    const finalManager = SessionManager.open(sessionFile!);
    const final = await createCompiledSession(workspace, finalManager, "final");
    try {
      const routed = final.session._createRuntimeContextPrompts(
        "edit security credential handling",
        final.session.systemPrompt,
      );
      const links = routed.projectRuleLinks ?? [];
      expect(links.length).toBeGreaterThan(0);
      const editCall = projectInstructionToolHookInput("edit", { path: "src/auth.ts" });
      await expect(final.session.agent.beforeToolCall?.(editCall)).resolves.toMatchObject({ block: true });
      const pendingBatches = final.session._projectRuleGate?.batches.filter((batch) => !batch.satisfied) ?? [];
      expect(pendingBatches.length).toBeGreaterThan(0);
      for (const batch of pendingBatches) await executeProjectInstructionReadRules(final.session, batch.links);
      await expect(final.session.agent.beforeToolCall?.(editCall)).resolves.toBeUndefined();
    } finally {
      final.session.dispose();
    }
  });
});
