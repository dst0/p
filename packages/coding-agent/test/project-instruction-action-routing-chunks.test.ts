import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { selectProjectInstructionRuleLinks } from "../src/core/project-instructions/index.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  ACTION_ROUTING_BOUNDARY_TOKEN,
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
  projectInstructionToolHookInput,
} from "./project-instruction-delivery-fixture.ts";

const ACTION_ROUTING_CHUNK_LENGTH = 16_384;

afterEach(() => {
  cleanupProjectInstructionModeWorkspaces();
});

async function createCompiledSession(suffix: string, additionalInstructions: string[] = []) {
  const workspace = createProjectInstructionModeWorkspace({ additionalInstructions });
  const created = await createAgentSession({
    cwd: workspace.root,
    agentDir: join(workspace.root, `.agent-action-chunk-${suffix}`),
    resourceLoader: workspace.resourceLoader,
    sessionManager: SessionManager.inMemory(workspace.root),
    projectInstructionMode: "compiled",
    projectInstructionCompiler: workspace.compiler,
  });
  return { ...created, workspace };
}

function boundaryPayload(toolName: string, token: string): string {
  const serializedPrefix = '{"payload":"';
  const payloadLength = ACTION_ROUTING_CHUNK_LENGTH - `${toolName}\n`.length;
  const tokenStart = payloadLength - Math.floor(token.length / 2);
  return `${"x".repeat(tokenStart - serializedPrefix.length - 1)} ${token}`;
}

describe("chunked project-instruction action routing", () => {
  it("routes a relevant action term after the first chunk", async () => {
    const { session } = await createCompiledSession("tail");
    try {
      session._createRuntimeContextPrompts("fix the bug", session.systemPrompt);
      const deploymentLink = session._projectInstructions.state.current?.manifest.rules.find(
        (rule) => rule.title === "Deployment",
      )?.link;
      expect(deploymentLink).toBeDefined();

      await expect(
        session.agent.beforeToolCall?.(
          projectInstructionToolHookInput("bash", {
            padding: "x".repeat(ACTION_ROUTING_CHUNK_LENGTH + 500),
            command: "./deploy production",
          }),
        ),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining(deploymentLink!) });
    } finally {
      session.dispose();
    }
  });

  it("preserves a compiler-permitted 500-character trigger across a chunk boundary", async () => {
    const { session } = await createCompiledSession("boundary");
    try {
      const turn = session._createRuntimeContextPrompts("fix the bug", session.systemPrompt);
      const boundaryRule = session._projectInstructions.state.current?.manifest.rules.find(
        (rule) => rule.title === "Boundary routing",
      );
      const boundaryLink = boundaryRule?.link;
      expect(boundaryLink).toBeDefined();
      expect(boundaryRule?.trigger).toBe(ACTION_ROUTING_BOUNDARY_TOKEN);
      expect(boundaryRule?.routable).toBe(true);
      expect(turn.projectRuleLinks ?? []).not.toContain(boundaryLink);
      expect(session._projectRuleGate).toBeDefined();
      const payload = boundaryPayload("bash", ACTION_ROUTING_BOUNDARY_TOKEN);
      const serialized = JSON.stringify({ payload });
      const payloadLength = ACTION_ROUTING_CHUNK_LENGTH - "bash\n".length;
      const boundaryChunk = `bash\n${serialized.slice(payloadLength - 500, payloadLength * 2 - 500)}`;
      expect(boundaryChunk).toContain(ACTION_ROUTING_BOUNDARY_TOKEN);
      expect(selectProjectInstructionRuleLinks([boundaryRule!], boundaryChunk)).toContain(boundaryLink);
      expect(
        selectProjectInstructionRuleLinks(session._projectInstructions.state.current!.manifest.rules, boundaryChunk),
      ).toContain(boundaryLink);

      await expect(
        session.agent.beforeToolCall?.(
          projectInstructionToolHookInput("bash", {
            payload,
          }),
        ),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining(boundaryLink!) });
    } finally {
      session.dispose();
    }
  });

  it("routes generic edit calls through deterministic file-modification labels", async () => {
    const { session } = await createCompiledSession("semantic-edit");
    try {
      session._createRuntimeContextPrompts("please handle it", session.systemPrompt);
      const checkLink = session._projectInstructions.state.current?.manifest.rules.find(
        (rule) => rule.title === "Code checks",
      )?.link;
      expect(checkLink).toBeDefined();

      await expect(
        session.agent.beforeToolCall?.(
          projectInstructionToolHookInput("edit", {
            path: "src/app.ts",
            oldText: "alpha",
            newText: "beta",
          }),
        ),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining(checkLink!) });
    } finally {
      session.dispose();
    }
  });

  it("routes circular mutation arguments through semantic labels without serializing them", async () => {
    const { session } = await createCompiledSession("circular");
    try {
      session._createRuntimeContextPrompts("please handle it", session.systemPrompt);
      const checkLink = session._projectInstructions.state.current?.manifest.rules.find(
        (rule) => rule.title === "Code checks",
      )?.link;
      const circular: Record<string, unknown> = { path: "src/app.ts" };
      circular.self = circular;

      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("edit", circular)),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining(checkLink!) });
    } finally {
      session.dispose();
    }
  });

  it.each([
    ["package-install", "npm install exact-package", "Dependency management"],
    ["file-delete", "rm obsolete.txt", "Deletion safety"],
  ])("adds defensive shell semantics for %s", async (suffix, command, title) => {
    const { session } = await createCompiledSession(suffix, [
      "## Dependency management\n\nBefore dependency installation, inspect package integrity.\n",
      "## Deletion safety\n\nBefore file deletion, verify the removal scope.\n",
    ]);
    try {
      session._createRuntimeContextPrompts("please handle it", session.systemPrompt);
      const expectedLink = session._projectInstructions.state.current?.manifest.rules.find(
        (rule) => rule.title === title,
      )?.link;
      expect(expectedLink).toBeDefined();

      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("bash", { command })),
      ).resolves.toMatchObject({ block: true, reason: expect.stringContaining(expectedLink!) });
    } finally {
      session.dispose();
    }
  });
});
