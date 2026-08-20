import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import type { ProjectInstructionCompiler } from "../src/core/project-instructions/index.ts";
import { getProjectInstructionFallbackPath } from "../src/core/project-instructions/paths.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";

const temporaryDirectories: string[] = [];

function createWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "p-project-session-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  const agentsPath = join(root, "AGENTS.md");
  let content = createLargeInstructions("first");
  writeFileSync(agentsPath, content);
  const runtime = createExtensionRuntime();
  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [{ path: agentsPath, content }] }),
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
  return {
    root,
    agentsPath,
    resourceLoader,
    updateInstructions(label: string) {
      content = createLargeInstructions(label);
      writeFileSync(agentsPath, content);
    },
  };
}

function createLargeInstructions(label: string): string {
  return `${Array.from(
    { length: 90 },
    (_, index) => `## ${label} rule ${index}\n\nAlways enforce ${label} invariant ${index}. ${"detail ".repeat(10)}\n`,
  ).join("")}\nSENTINEL_UNINJECTED_TAIL_${label}\n`;
}

function createCompiler(): ProjectInstructionCompiler {
  return vi.fn(async (request: Parameters<ProjectInstructionCompiler>[0]) => ({
    body: `Use read_rules for ${request.modules[0].link} and every other matching catalog route.`,
    triggers: Object.fromEntries(request.modules.map((module) => [module.id, `Work on ${module.title}`])),
  }));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("session project instruction integration", () => {
  it("injects the bounded compiled block, activates both readers, and refreshes after source changes", async () => {
    const workspace = createWorkspace();
    const compiler = createCompiler();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionCompiler: compiler,
    });
    try {
      expect(session.getActiveToolNames()).toEqual(expect.arrayContaining(["read_rules", "read_skills"]));
      expect(session.systemPrompt).toContain("read_rules");
      expect(session.systemPrompt).toContain("read_skills");
      expect(session.systemPrompt).not.toContain("SENTINEL_UNINJECTED_TAIL_first");
      const injected = session.systemPrompt.match(/<project_instructions[\s\S]*<\/project_instructions>/u)?.[0];
      expect(injected?.length).toBeLessThan(5_000);
      expect(existsSync(join(workspace.root, ".pdev", "instructions", "current.json"))).toBe(true);
      expect(compiler).toHaveBeenCalledTimes(1);

      workspace.updateInstructions("second");
      await session.reload();
      expect(compiler).toHaveBeenCalledTimes(2);
      expect(session.systemPrompt).toContain("second-rule-0");
      expect(session.systemPrompt).not.toContain("SENTINEL_UNINJECTED_TAIL_second");
    } finally {
      session.dispose();
    }
  });

  it("honors an explicit tool allowlist", async () => {
    const workspace = createWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionCompiler: createCompiler(),
      tools: ["read"],
    });
    try {
      expect(session.getActiveToolNames()).toEqual(["read"]);
      expect(session.getToolDefinition("read_rules")).toBeUndefined();
      expect(session.getToolDefinition("read_skills")).toBeUndefined();
      const fallbackPath = getProjectInstructionFallbackPath(
        join(realpathSync(workspace.root), ".pdev", "instructions"),
        readCurrentInputHash(workspace.root),
      );
      expect(session.systemPrompt).toContain(`ordinary-read \`${fallbackPath}\``);
      const fallback = readFileSync(fallbackPath, "utf8");
      expect(fallback).toContain(workspace.agentsPath);
      expect(fallback).toContain("Physical rule catalog:");
    } finally {
      session.dispose();
    }
  });

  it("recovers a cached no-auth fallback when a later session has a working compiler", async () => {
    const workspace = createWorkspace();
    const unavailable = vi.fn<ProjectInstructionCompiler>(async () => {
      throw new Error("no model auth");
    });
    const first = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-first"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionCompiler: unavailable,
    });
    expect(first.session.systemPrompt).toContain('mode="fallback"');
    first.session.dispose();

    const compiler = createCompiler();
    const second = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-second"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionCompiler: compiler,
    });
    try {
      expect(unavailable).toHaveBeenCalledOnce();
      expect(compiler).toHaveBeenCalledOnce();
      expect(second.session.systemPrompt).toContain('mode="compiled"');
    } finally {
      second.session.dispose();
    }
  });
});

function readCurrentInputHash(root: string): string {
  const currentPath = join(realpathSync(root), ".pdev", "instructions", "current.json");
  const value = JSON.parse(readFileSync(currentPath, "utf8")) as { inputHash?: unknown };
  if (typeof value.inputHash !== "string") throw new Error("Missing project instruction input hash");
  return value.inputHash;
}
