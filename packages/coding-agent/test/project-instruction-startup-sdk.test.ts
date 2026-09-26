import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectInstructionCompiler } from "../src/core/project-instructions/index.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
} from "./project-instruction-delivery-fixture.ts";

afterEach(cleanupProjectInstructionModeWorkspaces);

describe("project instruction startup deadline SDK delivery", () => {
  it("rejects out-of-range deadlines even when instructions are cached or absent", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    await expect(
      createAgentSession({
        cwd: workspace.root,
        agentDir: join(workspace.root, ".agent-invalid-deadline"),
        resourceLoader: workspace.resourceLoader,
        sessionManager: SessionManager.inMemory(workspace.root),
        projectInstructionMode: "compiled",
        taskVerificationMode: "off",
        projectInstructionCompiler: workspace.compiler,
        projectInstructionStartupDeadline: Number.POSITIVE_INFINITY,
      }),
    ).rejects.toThrow(RangeError);
  });

  it("falls back on a slow cold compiler through the public session option", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const slowCompiler: ProjectInstructionCompiler = async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return workspace.compiler(request);
    };
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-startup-deadline"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      taskVerificationMode: "off",
      projectInstructionCompiler: slowCompiler,
      projectInstructionStartupDeadline: 0.01,
    });
    try {
      expect(session._projectInstructions.state.current?.manifest.mode).toBe("fallback");
      expect(session._projectInstructions.state.current?.manifest.compilerStatus).toBe("failed");
      await new Promise((resolve) => setTimeout(resolve, 170));
      expect(session._projectInstructions.state.current?.manifest.mode).toBe("fallback");
    } finally {
      session.dispose();
    }
  });
});
