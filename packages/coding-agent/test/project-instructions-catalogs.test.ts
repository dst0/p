import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProjectInstructionState,
  type ProjectInstructionCompiler,
  prepareProjectInstructions,
} from "../src/core/project-instructions/index.ts";
import { renderProjectInstructions, renderRulesCatalog } from "../src/core/project-instructions/prompt.ts";
import { readRuleLinks, readSkillLinks } from "../src/core/project-instructions/reader.ts";
import type { ProjectInstructionRuleRecord } from "../src/core/project-instructions/types.ts";
import type { Skill } from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

const temporaryDirectories: string[] = [];

function createWorkspace(): { root: string; agentsPath: string; cacheDir: string } {
  const root = mkdtempSync(join(tmpdir(), "p-project-catalogs-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  return { root, agentsPath: join(root, "AGENTS.md"), cacheDir: join(root, ".pdev", "instructions") };
}

function createSkill(root: string, index: number): Skill {
  const baseDir = join(root, "skills", `catalog-skill-${index}`);
  const filePath = join(baseDir, "SKILL.md");
  const description = `Catalog skill ${index} ${"detailed condition ".repeat(35)}`;
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(filePath, `---\nname: catalog-skill-${index}\ndescription: ${description}\n---\n\nUse it.\n`);
  return {
    name: `catalog-skill-${index}`,
    description,
    filePath,
    baseDir,
    sourceInfo: createSyntheticSourceInfo(filePath, { source: "test", baseDir }),
    disableModelInvocation: false,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("project instruction catalog persistence", () => {
  it("persists, reloads, reads, and repairs paginated rule and skill catalogs", async () => {
    const workspace = createWorkspace();
    const content = Array.from(
      { length: 450 },
      (_, index) => `## Catalog rule ${index}\n\nPreserve catalog invariant ${index}.\n`,
    ).join("");
    writeFileSync(workspace.agentsPath, content);
    const skills = Array.from({ length: 240 }, (_, index) => createSkill(workspace.root, index));
    const compiler = vi.fn<ProjectInstructionCompiler>(async (request) =>
      createProjectInstructionCompilation(
        request,
        Object.fromEntries(
          request.modules.map((module) => [
            module.id,
            `When ${module.title} applies ${"specific detail ".repeat(15).trim()}`,
          ]),
        ),
      ),
    );
    const options = {
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills,
      compiler,
    };

    const first = await prepareProjectInstructions(options);
    expect(first.manifest).toMatchObject({ mode: "compiled", compilerStatus: "success" });
    expect(first.manifest.rulesCatalogPages.length).toBeGreaterThan(1);
    expect(first.manifest.skillsCatalogPages.length).toBeGreaterThan(1);
    const state = createProjectInstructionState(first);
    const rulePage = first.manifest.rulesCatalogPages[0];
    const skillPage = first.manifest.skillsCatalogPages[0];
    expect(readRuleLinks(state, [first.manifest.rulesCatalogFile, rulePage.link])).toContain("Catalog rule");
    expect(readSkillLinks(state, [first.manifest.skillsCatalogFile, skillPage.link])).toContain("Catalog skill");

    writeFileSync(join(first.versionDir, rulePage.file), "tampered page\n");
    const repaired = await prepareProjectInstructions(options);
    expect(compiler).toHaveBeenCalledOnce();
    expect(readFileSync(join(repaired.versionDir, rulePage.file), "utf8")).not.toContain("tampered page");
    expect(readRuleLinks(createProjectInstructionState(repaired), [rulePage.link])).toContain("Catalog rule");
  });

  it("rejects a skill whose declared base directory is wider than its root", async () => {
    const workspace = createWorkspace();
    writeFileSync(workspace.agentsPath, "# Rules\n\nKeep skill roots canonical.\n");
    const baseDir = join(workspace.root, "skills");
    const actualDir = join(baseDir, "nested");
    const filePath = join(actualDir, "SKILL.md");
    mkdirSync(actualDir, { recursive: true });
    writeFileSync(filePath, "---\nname: nested\ndescription: Nested\n---\n");
    const skill: Skill = {
      name: "nested",
      description: "Nested",
      filePath,
      baseDir,
      sourceInfo: createSyntheticSourceInfo(filePath, { source: "test", baseDir }),
      disableModelInvocation: false,
    };

    await expect(
      prepareProjectInstructions({
        cwd: workspace.root,
        cacheDir: workspace.cacheDir,
        contextFiles: [{ path: workspace.agentsPath, content: "# Rules\n\nKeep skill roots canonical.\n" }],
        skills: [skill],
      }),
    ).rejects.toThrow(/directly inside/u);
  });
});

describe("project instruction catalog bounds", () => {
  it("rejects one catalog entry that cannot fit in any bounded page", () => {
    const rule: ProjectInstructionRuleRecord = {
      id: "oversized",
      link: "rules/oversized.md",
      file: "rules/oversized.md",
      title: "Oversized",
      trigger: "Always",
      routable: true,
      sourcePath: "x".repeat(140_000),
      contentHash: "a".repeat(64),
    };

    expect(() => renderRulesCatalog([rule])).toThrow(/entry exceeds the page limit/u);
  });

  it("rejects routing metadata that alone exceeds the injected prompt budget", () => {
    expect(() =>
      renderProjectInstructions({
        agentsHash: "a".repeat(64),
        inputHash: "b".repeat(64),
        cacheDir: `/${"nested-cache/".repeat(600)}`,
        mode: "compiled",
        body: "Use exact modules.",
        sources: [],
        rules: [],
        skills: [],
      }),
    ).toThrow(/routing metadata exceeds/u);
  });
});
