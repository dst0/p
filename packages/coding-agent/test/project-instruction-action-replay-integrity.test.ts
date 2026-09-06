import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE } from "../src/core/agent-session/constants.ts";
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

type Workspace = ReturnType<typeof createProjectInstructionModeWorkspace>;

async function createCompiledSession(workspace: Workspace, manager: SessionManager, suffix: string) {
  return createAgentSession({
    cwd: workspace.root,
    agentDir: join(workspace.root, `.agent-action-replay-${suffix}`),
    resourceLoader: workspace.resourceLoader,
    sessionManager: manager,
    projectInstructionMode: "compiled",
    projectInstructionCompiler: workspace.compiler,
    projectInstructionCompilerIdentity: "action-replay-test",
  });
}

function actionEntries(manager: SessionManager) {
  return manager
    .getBranch()
    .filter((entry) => entry.type === "custom" && entry.customType === PROJECT_RULE_BATCH_CUSTOM_TYPE);
}

describe("action-selected project-rule replay integrity", () => {
  it("rejects runtime route content that disagrees with its hidden gate details", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.inMemory(workspace.root);
    const initial = await createCompiledSession(workspace, manager, "mismatch-initial");
    const prepared = initial.session._projectInstructions.state.current!;
    const testingLink = prepared.manifest.rules.find((rule) => rule.title === "Testing")!.link;
    const deploymentLink = prepared.manifest.rules.find((rule) => rule.title === "Deployment")!.link;
    manager.appendCustomMessageEntry(
      RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE,
      `<project_rule_routes input_sha256="${prepared.manifest.inputHash}">\n- \`${testingLink}\`: npm test execution\n</project_rule_routes>`,
      false,
      {
        projectInstructionMode: "compiled",
        projectRuleGate: {
          inputHash: prepared.manifest.inputHash,
          batches: [{ links: [deploymentLink], satisfied: false, generation: 1 }],
          activeGeneration: 1,
        },
      },
    );
    initial.session.dispose();

    const resumed = await createCompiledSession(workspace, manager, "mismatch-resumed");
    try {
      resumed.session._createRuntimeContextPrompts("continue", resumed.session.systemPrompt);
      await expect(
        resumed.session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/file.ts" })),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining("cannot be verified") });
    } finally {
      resumed.session.dispose();
    }
  });

  it("rejects duplicate visible route links that omit a hidden gate link", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.inMemory(workspace.root);
    const initial = await createCompiledSession(workspace, manager, "duplicate-route-initial");
    const prepared = initial.session._projectInstructions.state.current!;
    const testingLink = prepared.manifest.rules.find((rule) => rule.title === "Testing")!.link;
    const deploymentLink = prepared.manifest.rules.find((rule) => rule.title === "Deployment")!.link;
    manager.appendCustomMessageEntry(
      RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE,
      `<project_rule_routes input_sha256="${prepared.manifest.inputHash}">\n- \`${testingLink}\`: first\n- \`${testingLink}\`: duplicate\n</project_rule_routes>`,
      false,
      {
        projectInstructionMode: "compiled",
        projectRuleGate: {
          inputHash: prepared.manifest.inputHash,
          batches: [{ links: [testingLink, deploymentLink], satisfied: false, generation: 1 }],
          activeGeneration: 1,
        },
      },
    );
    initial.session.dispose();

    const resumed = await createCompiledSession(workspace, manager, "duplicate-route-resumed");
    try {
      resumed.session._createRuntimeContextPrompts("continue", resumed.session.systemPrompt);
      await expect(
        resumed.session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/file.ts" })),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining("cannot be verified") });
    } finally {
      resumed.session.dispose();
    }
  });

  it("rejects an unknown persisted queued-candidate merge policy", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.inMemory(workspace.root);
    const initial = await createCompiledSession(workspace, manager, "merge-policy-initial");
    const prepared = initial.session._projectInstructions.state.current!;
    const testingLink = prepared.manifest.rules.find((rule) => rule.title === "Testing")!.link;
    manager.appendCustomMessageEntry(
      RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE,
      `<project_rule_routes input_sha256="${prepared.manifest.inputHash}">\n- \`${testingLink}\`: npm test execution\n</project_rule_routes>`,
      false,
      {
        projectInstructionMode: "compiled",
        projectRuleGate: {
          inputHash: prepared.manifest.inputHash,
          batches: [],
          activeGeneration: 1,
          candidateLinks: [testingLink],
          candidateMerge: "replace",
        },
      },
    );
    initial.session.dispose();

    const resumed = await createCompiledSession(workspace, manager, "merge-policy-resumed");
    try {
      resumed.session._createRuntimeContextPrompts("continue", resumed.session.systemPrompt);
      await expect(
        resumed.session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", { path: "src/file.ts" })),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining("cannot be verified") });
    } finally {
      resumed.session.dispose();
    }
  });

  it("fails closed when an unread persisted action batch has a stale source hash", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.inMemory(workspace.root);
    const initial = await createCompiledSession(workspace, manager, "stale-initial");
    initial.session._createRuntimeContextPrompts("fix the bug", initial.session.systemPrompt);
    await expect(
      initial.session.agent.beforeToolCall?.(projectInstructionToolHookInput("bash", { command: "npm test" })),
    ).resolves.toMatchObject({ block: true });
    expect(actionEntries(manager)).toHaveLength(1);
    initial.session.dispose();
    appendFileSync(workspace.agentsPath, "\n## New rule\n\nPreserve the new source hash.\n");

    const resumed = await createCompiledSession(workspace, manager, "stale-resumed");
    try {
      resumed.session._createRuntimeContextPrompts("continue", resumed.session.systemPrompt);
      await expect(
        resumed.session.agent.beforeToolCall?.(projectInstructionToolHookInput("bash", { command: "npm test" })),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining("changed since the persisted") });
    } finally {
      resumed.session.dispose();
    }
  });

  it("reopens an unread action batch from disk without duplicating it", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const manager = SessionManager.create(workspace.root, join(workspace.root, ".sessions"));
    const initial = await createCompiledSession(workspace, manager, "disk-initial");
    initial.session._createRuntimeContextPrompts("fix the bug", initial.session.systemPrompt);
    const testCall = projectInstructionToolHookInput("bash", { command: "npm test" });
    await expect(initial.session.agent.beforeToolCall?.(testCall)).resolves.toMatchObject({ block: true });
    const sessionFile = manager.getSessionFile();
    expect(sessionFile).toBeDefined();
    initial.session.dispose();

    const reopenedManager = SessionManager.open(sessionFile!);
    const resumed = await createCompiledSession(workspace, reopenedManager, "disk-resumed");
    try {
      resumed.session._createRuntimeContextPrompts("continue", resumed.session.systemPrompt);
      await expect(resumed.session.agent.beforeToolCall?.(testCall)).resolves.toMatchObject({ block: true });
      expect(actionEntries(reopenedManager)).toHaveLength(1);
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
});
