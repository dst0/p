import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProjectInstructionState,
  PROJECT_INSTRUCTIONS_PROMPT_BUDGET,
  type ProjectInstructionCompiler,
  prepareProjectInstructions,
} from "../src/core/project-instructions/index.ts";
import { readRuleLinks } from "../src/core/project-instructions/reader.ts";
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

  it("stores every large-source byte in exact rule modules while bounding the complete injected block", async () => {
    const workspace = createWorkspace();
    const content = Array.from(
      { length: 90 },
      (_, index) => `## Rule ${index}\n\nAlways preserve invariant ${index}. ${"detail ".repeat(12)}\n`,
    ).join("");
    writeFileSync(workspace.agentsPath, content);
    const compiler = vi.fn<ProjectInstructionCompiler>(async (request) =>
      createProjectInstructionCompilation(
        request,
        Object.fromEntries(request.modules.map((module) => [module.id, `Work involving ${module.title}`])),
      ),
    );

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler,
    });

    expect(compiler).toHaveBeenCalledOnce();
    expect(compiler.mock.calls[0][0].sources[0].content).toBe(content);
    expect(prepared.manifest.mode).toBe("compiled");
    expect(prepared.prompt.length).toBeLessThanOrEqual(PROJECT_INSTRUCTIONS_PROMPT_BUDGET);
    expect(prepared.prompt).not.toContain(content);
    const restored = prepared.manifest.rules
      .map((rule) => readFileSync(join(prepared.versionDir, rule.file), "utf8"))
      .join("");
    expect(restored).toBe(content);
    const catalog = readFileSync(join(prepared.versionDir, prepared.manifest.rulesCatalogFile), "utf8");
    for (const rule of prepared.manifest.rules) expect(catalog).toContain(rule.link);
  });

  it("falls back deterministically when compilation fails without dropping source modules", async () => {
    const workspace = createWorkspace();
    const content = `# Rules\n\n${"Never drop this requirement.\n".repeat(400)}`;
    writeFileSync(workspace.agentsPath, content);
    const compiler: ProjectInstructionCompiler = async () => {
      throw new Error("compiler unavailable");
    };

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler,
    });

    expect(prepared.manifest.mode).toBe("fallback");
    expect(prepared.manifest.compilerDiagnostic).toBe("project instruction compiler failed");
    expect(JSON.stringify(prepared.manifest)).not.toContain("compiler unavailable");
    expect(prepared.prompt.length).toBeLessThan(5_000);
    expect(
      prepared.manifest.rules.map((rule) => readFileSync(join(prepared.versionDir, rule.file), "utf8")).join(""),
    ).toBe(content);
  });

  it("atomically repairs a corrupted exact cache version without invoking the compiler", async () => {
    const workspace = createWorkspace();
    const compiler = createCompiler();
    writeFileSync(workspace.agentsPath, "# Rules\n\nAlways validate cached instructions.\n");
    const options = {
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content: readFileSync(workspace.agentsPath, "utf8") }],
      skills: [],
      compiler,
    };
    const first = await prepareProjectInstructions(options);
    writeFileSync(join(first.versionDir, first.manifest.promptFile), "corrupted\n");

    const repaired = await prepareProjectInstructions(options);

    expect(compiler).not.toHaveBeenCalled();
    expect(repaired.prompt).toBe(first.prompt);
    expect(readFileSync(join(repaired.versionDir, repaired.manifest.promptFile), "utf8")).toBe(first.prompt);
  });

  it("keeps concurrent same-input versions usable when compiler output differs", async () => {
    const workspace = createWorkspace();
    const content = `# Rules\n\n${"Always preserve concurrent cache integrity.\n".repeat(180)}`;
    writeFileSync(workspace.agentsPath, content);
    let compilation = 0;
    const compiler = vi.fn<ProjectInstructionCompiler>(async (request) => {
      compilation++;
      const result = createProjectInstructionCompilation(
        request,
        Object.fromEntries(
          request.modules.map((module) => [module.id, `concurrent cache integrity compilation ${compilation}`]),
        ),
      );
      result.usage = { input: 100, output: compilation, cacheRead: 0, cacheWrite: 0, total: 100 + compilation };
      return result;
    });
    const options = {
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler,
    };

    const [first, second] = await Promise.all([
      prepareProjectInstructions(options),
      prepareProjectInstructions(options),
    ]);

    expect(compiler).toHaveBeenCalledTimes(2);
    expect(first.manifest.inputHash).toBe(second.manifest.inputHash);
    expect(first.manifest.resultHash).not.toBe(second.manifest.resultHash);
    expect(readRuleLinks(createProjectInstructionState(first), [first.manifest.rules[0].link])).toContain(
      "concurrent cache integrity",
    );
    expect(readRuleLinks(createProjectInstructionState(second), [second.manifest.rules[0].link])).toContain(
      "concurrent cache integrity",
    );
    await prepareProjectInstructions(options);
    expect(compiler).toHaveBeenCalledTimes(2);
  });

  it("refuses a symlinked .pdev cache parent before writing through it", async () => {
    const workspace = createWorkspace();
    const outside = mkdtempSync(join(tmpdir(), "p-project-cache-outside-"));
    temporaryDirectories.push(outside);
    writeFileSync(workspace.agentsPath, "# Rules\n\nNever follow cache symlinks.\n");
    symlinkSync(outside, join(workspace.root, ".pdev"));

    await expect(
      prepareProjectInstructions({
        cwd: workspace.root,
        cacheDir: workspace.cacheDir,
        contextFiles: [{ path: workspace.agentsPath, content: readFileSync(workspace.agentsPath, "utf8") }],
        skills: [],
        compiler: createCompiler(),
      }),
    ).rejects.toThrow(/cache.*workspace|symlink/i);
    expect(existsSync(join(outside, "instructions"))).toBe(false);
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
});
