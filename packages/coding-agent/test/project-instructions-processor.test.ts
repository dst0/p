import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProjectInstructionState,
  type ProjectInstructionCompiler,
  prepareProjectInstructions,
} from "../src/core/project-instructions/index.ts";
import { readRuleLinks, readSkillLinks } from "../src/core/project-instructions/reader.ts";
import type { Skill } from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

const temporaryDirectories: string[] = [];

function createWorkspace(): { root: string; agentsPath: string; cacheDir: string } {
  const root = mkdtempSync(join(tmpdir(), "p-project-instructions-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  return {
    root,
    agentsPath: join(root, "AGENTS.md"),
    cacheDir: join(root, ".pdev", "instructions"),
  };
}

function createCompiler(): ProjectInstructionCompiler {
  return vi.fn(async (request: Parameters<ProjectInstructionCompiler>[0]) =>
    createProjectInstructionCompilation(
      request,
      Object.fromEntries(request.modules.map((module) => [module.id, `When ${module.title} applies`])),
    ),
  );
}

function createSkill(root: string, index: number): Skill {
  const baseDir = join(root, "skills", `skill-${index}`);
  const filePath = join(baseDir, "SKILL.md");
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(
    filePath,
    `---\nname: skill-${index}\ndescription: Skill ${index} guidance\n---\n\nInstructions ${index}.\n`,
  );
  return {
    name: `skill-${index}`,
    description: `Skill ${index} guidance`,
    filePath,
    baseDir,
    sourceInfo: createSyntheticSourceInfo(filePath, { source: "test", baseDir }),
    disableModelInvocation: false,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("project instruction processing", () => {
  it.each([
    "",
    ".",
    "..",
    "./rules/catalog.md",
    "rules//catalog.md",
    "rules/../catalog.md",
    "rules\\catalog.md",
    "rules/..\\catalog.md",
  ])("rejects invalid catalog link boundary %s", async (link) => {
    const workspace = createWorkspace();
    const content = "# Rules\n\nKeep catalog links lexical.\n";
    writeFileSync(workspace.agentsPath, content);
    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
    });

    expect(() => readRuleLinks(createProjectInstructionState(prepared), [link])).toThrow(
      /Invalid relative catalog link/u,
    );
    expect(() => readSkillLinks(createProjectInstructionState(prepared), [link])).toThrow(
      /Invalid relative catalog link/u,
    );
  });

  it("keeps small sources exact without disclosing them to the compiler", async () => {
    const workspace = createWorkspace();
    const compiler = createCompiler();
    writeFileSync(workspace.agentsPath, "# Rules\n\nNever expose secrets.\n");

    const first = await prepareProjectInstructions({
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content: readFileSync(workspace.agentsPath, "utf8") }],
      skills: [],
      compiler,
    });
    const second = await prepareProjectInstructions({
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content: readFileSync(workspace.agentsPath, "utf8") }],
      skills: [],
      compiler,
    });

    expect(compiler).not.toHaveBeenCalled();
    expect(first.manifest.mode).toBe("exact");
    expect(first.prompt).toContain("Never expose secrets.");
    expect(first.prompt).toContain("read_rules");
    expect(first.prompt).toContain("list_skills");
    expect(first.prompt).toContain("read_skills");
    expect(first.prompt).toContain("rules/catalog.md");
    expect(first.prompt).not.toContain("skills/catalog.md");
    expect(first.prompt.length).toBeLessThan(5_000);
    expect(second.manifest.inputHash).toBe(first.manifest.inputHash);

    writeFileSync(workspace.agentsPath, "# Rules\n\nNever expose secrets.\nAlways verify output.\n");
    const changed = await prepareProjectInstructions({
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content: readFileSync(workspace.agentsPath, "utf8") }],
      skills: [],
      compiler,
    });
    expect(compiler).not.toHaveBeenCalled();
    expect(changed.manifest.agentsHash).not.toBe(first.manifest.agentsHash);
  });

  it("uses list_skills prompt discovery when many skill links cannot fit inline", async () => {
    const workspace = createWorkspace();
    writeFileSync(workspace.agentsPath, "# Rules\n\nUse relevant skills.\n");
    const skills = Array.from({ length: 120 }, (_, index) => createSkill(workspace.root, index));

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content: readFileSync(workspace.agentsPath, "utf8") }],
      skills,
      compiler: createCompiler(),
    });

    expect(prepared.manifest.skills).toHaveLength(120);
    expect(prepared.prompt.length).toBeLessThan(5_000);
    expect(prepared.prompt).toContain("list_skills");
    expect(prepared.prompt).not.toContain("skills/catalog.md");
    expect(prepared.prompt).not.toContain(prepared.manifest.skills[119].link);
    const catalog = readFileSync(join(prepared.versionDir, prepared.manifest.skillsCatalogFile), "utf8");
    expect(catalog).toContain(prepared.manifest.skills[119].link);
  });

  it("falls back when a valid compiled body leaves no room for routed turn metadata", async () => {
    const workspace = createWorkspace();
    const content = [
      `# Global\n\nAlways ${"preserve ".repeat(365)}evidence on every task.\n`,
      ...Array.from({ length: 3 }, (_, index) => `# Routed ${index}\n\nWhen routed ${index} applies, inspect it.\n`),
    ].join("");
    writeFileSync(workspace.agentsPath, content);
    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => {
        const result = createProjectInstructionCompilation(request);
        for (const module of request.modules) {
          if (result.classifications.modules[module.id] === "routed") {
            result.triggers[module.id] = `${module.title} ${"x".repeat(450)}`;
          }
        }
        return result;
      },
    });

    expect(prepared.manifest).toMatchObject({
      mode: "fallback",
      compilerStatus: "failed",
      compilerDiagnostic: "project instruction compiler output validation failed",
    });
  });
});
