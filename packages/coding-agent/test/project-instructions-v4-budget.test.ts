import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROJECT_INSTRUCTIONS_PROMPT_BUDGET,
  PROJECT_INSTRUCTIONS_PROMPT_TARGET,
  prepareProjectInstructions,
  renderProjectInstructionTurnContext,
} from "../src/core/project-instructions/index.ts";
import type {
  PreparedProjectInstructions,
  ProjectInstructionCompiler,
} from "../src/core/project-instructions/types.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

const temporaryDirectories: string[] = [];

function createWorkspace(): { root: string; agentsPath: string } {
  const root = mkdtempSync(join(tmpdir(), "p-project-v4-budget-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  return { root, agentsPath: join(root, "AGENTS.md") };
}

function largeInstructions(): string {
  return Array.from(
    { length: 40 },
    (_, index) => `## Module ${index}\n\nAlways preserve invariant ${index}. ${"detail ".repeat(12)}\n`,
  ).join("");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("project instruction compiler v4 budget", () => {
  it("keeps this repository's activity-scoped AGENTS policy compilable", async () => {
    const workspace = createWorkspace();
    const content = readFileSync(join(import.meta.dirname, "../../../AGENTS.md"), "utf8");
    writeFileSync(workspace.agentsPath, content);
    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => createProjectInstructionCompilation(request),
    });

    expect(content.length).toBeGreaterThan(PROJECT_INSTRUCTIONS_PROMPT_TARGET);
    expect(prepared.manifest.compilerStatus).toBe("success");
    expect(prepared.manifest.mode).toBe("compiled");
    expect(prepared.prompt.length).toBeLessThanOrEqual(PROJECT_INSTRUCTIONS_PROMPT_TARGET);
  });

  it("keeps ordinary compiled context near target and complete turn injection under the hard ceiling", async () => {
    const workspace = createWorkspace();
    const content = largeInstructions();
    writeFileSync(workspace.agentsPath, content);
    const compiler = vi.fn<ProjectInstructionCompiler>(async (request) =>
      createProjectInstructionCompilation(
        request,
        Object.fromEntries(request.modules.map((module) => [module.id, `Work involving ${module.title}`])),
      ),
    );
    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler,
    });
    const turn = renderProjectInstructionTurnContext(prepared, "change module 1 and module 2 invariants");

    expect(compiler).toHaveBeenCalledOnce();
    expect(prepared.prompt.length).toBeLessThanOrEqual(PROJECT_INSTRUCTIONS_PROMPT_TARGET);
    expect(prepared.prompt).not.toContain(prepared.manifest.rules[0].link);
    expect(prepared.prompt.length + (turn?.prompt.length ?? 0)).toBeLessThanOrEqual(PROJECT_INSTRUCTIONS_PROMPT_BUDGET);
    expect(turn?.links.length).toBeGreaterThanOrEqual(1);
    expect(turn?.links.length).toBeLessThanOrEqual(3);
  });

  it("rejects a compiler body above its hard body ceiling instead of truncating it", async () => {
    const workspace = createWorkspace();
    const content = `# Global\n\nAlways ${"x".repeat(PROJECT_INSTRUCTIONS_PROMPT_BUDGET)} on every task.\n`;
    writeFileSync(workspace.agentsPath, content);
    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => createProjectInstructionCompilation(request),
    });

    expect(prepared.manifest.compilerStatus).toBe("failed");
    expect(prepared.manifest.mode).toBe("fallback");
  });

  it("treats 2k as a soft target while reserving hard-ceiling room for three routed links", async () => {
    const workspace = createWorkspace();
    const content = [
      ...Array.from(
        { length: 17 },
        (_, index) =>
          `## Global ${index}\n\nAlways preserve global invariant ${index} on every task, including condition ${index}, exception ${index}, and prohibition ${index}, without substituting its objects or actions.\n`,
      ),
      ...Array.from(
        { length: 3 },
        (_, index) => `## Routed ${index + 1}\n\nFor routed condition ${index + 1}, preserve its invariant.\n`,
      ),
    ].join("");
    writeFileSync(workspace.agentsPath, content);
    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => createProjectInstructionCompilation(request),
    });
    const turn = renderProjectInstructionTurnContext(prepared, "routed condition 1 2 3");

    expect(prepared.manifest.mode).toBe("compiled");
    expect(prepared.prompt.length).toBeGreaterThan(PROJECT_INSTRUCTIONS_PROMPT_TARGET);
    expect(turn?.links).toHaveLength(3);
    expect(prepared.prompt.length + (turn?.prompt.length ?? 0)).toBeLessThanOrEqual(PROJECT_INSTRUCTIONS_PROMPT_BUDGET);
  });

  it("fails closed if a tampered prepared prompt leaves no room for its selected route", () => {
    const prepared = {
      prompt: "x".repeat(PROJECT_INSTRUCTIONS_PROMPT_BUDGET),
      manifest: {
        mode: "compiled",
        inputHash: "a".repeat(64),
        rules: [
          {
            id: "release",
            link: "rules/release.md",
            file: "rules/release.md",
            title: "Release",
            trigger: "Publish release artifacts",
            routable: true,
            sourcePath: "/repo/AGENTS.md",
            contentHash: "b".repeat(64),
          },
        ],
      },
    } as PreparedProjectInstructions;

    expect(() => renderProjectInstructionTurnContext(prepared, "publish release artifacts")).toThrow(
      /complete injected prompt budget/iu,
    );
  });
});
