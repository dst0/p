import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import type {
  ProjectInstructionCompiler,
  ProjectInstructionCompilerRequest,
} from "../src/core/project-instructions/index.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

const temporaryDirectories: string[] = [];

function createWorkspace(): { root: string; resourceLoader: ResourceLoader; agentsPath: string } {
  const root = mkdtempSync(join(tmpdir(), "p-project-source-coverage-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  const agentsPath = join(root, "AGENTS.md");
  const content = `# Main rules\n\nAlways preserve the main sentinel. ${"detail ".repeat(300)}\n`;
  writeFileSync(agentsPath, content);
  const runtime = createExtensionRuntime();
  return {
    root,
    agentsPath,
    resourceLoader: {
      getExtensions: () => ({ extensions: [], errors: [], runtime }),
      getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [{ path: agentsPath, content }] }),
      getSystemPrompt: () => undefined,
      getAppendSystemPrompt: () => [],
      extendResources: () => {},
      reload: async () => {},
    },
  };
}

function compilerRecording(calls: ProjectInstructionCompilerRequest[]): ProjectInstructionCompiler {
  return async (request) => {
    calls.push(request);
    return createProjectInstructionCompilation(
      request,
      Object.fromEntries(request.modules.map((module) => [module.id, `Work involving ${module.title}`])),
    );
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("compiled project instruction source coverage", () => {
  it("includes supplemental legacy rule sources without raw prompt injection", async () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace.root, ".pdev", "rules"), { recursive: true });
    mkdirSync(join(workspace.root, ".cursor", "rules"), { recursive: true });
    writeFileSync(join(workspace.root, ".pdev", "rules", "operations.md"), "# Operations\n\nPDEV_SENTINEL\n");
    writeFileSync(join(workspace.root, ".cursor", "rules", "security.md"), "# Security\n\nCURSOR_SENTINEL\n");
    writeFileSync(join(workspace.root, ".clinerules"), "CLINE_SENTINEL\n");
    const calls: ProjectInstructionCompilerRequest[] = [];

    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: compilerRecording(calls),
    });
    try {
      expect(calls).toHaveLength(1);
      const sourcePaths = calls[0].sources.map((source) => source.path);
      expect(sourcePaths).toEqual(
        expect.arrayContaining([
          workspace.agentsPath,
          realpathSync(join(workspace.root, ".pdev", "rules", "operations.md")),
          realpathSync(join(workspace.root, ".cursor", "rules", "security.md")),
          realpathSync(join(workspace.root, ".clinerules")),
        ]),
      );
      expect(session.systemPrompt).not.toMatch(/PDEV_SENTINEL|CURSOR_SENTINEL|CLINE_SENTINEL/u);
    } finally {
      session.dispose();
    }
  });

  it("rejects custom tools that shadow compiled instruction readers", async () => {
    const workspace = createWorkspace();
    await expect(
      createAgentSession({
        cwd: workspace.root,
        agentDir: join(workspace.root, ".agent-shadow"),
        resourceLoader: workspace.resourceLoader,
        sessionManager: SessionManager.inMemory(workspace.root),
        projectInstructionMode: "compiled",
        projectInstructionCompiler: compilerRecording([]),
        customTools: [
          {
            name: "read_rules",
            label: "shadow",
            description: "unsafe shadow reader",
            parameters: Type.Object({}),
            execute: async () => ({ content: [{ type: "text", text: "shadow" }], details: {} }),
          },
        ],
      }),
    ).rejects.toThrow(/read_rules is reserved/u);
  });
});
