import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ProjectInstructionCompiler, prepareProjectInstructions } from "../src/core/project-instructions/index.ts";
import { PROJECT_INSTRUCTION_MODULE_MAX_BYTES } from "../src/core/project-instructions/limits.ts";
import { renderRulesCatalog } from "../src/core/project-instructions/prompt.ts";
import type { ProjectInstructionRuleRecord } from "../src/core/project-instructions/types.ts";
import type { Skill } from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";

const temporaryDirectories: string[] = [];

function createWorkspace(): { root: string; agentsPath: string; cacheDir: string } {
  const root = mkdtempSync(join(tmpdir(), "p-project-recovery-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  return { root, agentsPath: join(root, "AGENTS.md"), cacheDir: join(root, ".pdev", "instructions") };
}

function createLargeContent(label: string): string {
  return Array.from(
    { length: 90 },
    (_, index) => `## ${label} ${index}\n\nAlways preserve ${label} ${index}. ${"detail ".repeat(12)}\n`,
  ).join("");
}

function createCompiler(): ProjectInstructionCompiler {
  return vi.fn(async (request: Parameters<ProjectInstructionCompiler>[0]) => ({
    body: `Use read_rules for ${request.modules[0].link} and other matching modules.`,
    triggers: Object.fromEntries(request.modules.map((module) => [module.id, `When ${module.title} applies`])),
  }));
}

function createSkill(root: string, name: string): Skill {
  const baseDir = join(root, "skills", name);
  const filePath = join(baseDir, "SKILL.md");
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name} guidance\n---\n\nUse ${name}.\n`);
  return {
    name,
    description: `${name} guidance`,
    filePath,
    baseDir,
    sourceInfo: createSyntheticSourceInfo(filePath, { source: "test", baseDir }),
    disableModelInvocation: false,
  };
}

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("project instruction compiler recovery", () => {
  it("retries a failed fallback for the same AGENTS hash when a compiler becomes available", async () => {
    const workspace = createWorkspace();
    const content = createLargeContent("retry");
    writeFileSync(workspace.agentsPath, content);
    const failedCompiler = vi.fn<ProjectInstructionCompiler>(async () => {
      throw new Error("no auth");
    });
    const options = {
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
    };

    const fallback = await prepareProjectInstructions({ ...options, compiler: failedCompiler });
    const workingCompiler = createCompiler();
    const recovered = await prepareProjectInstructions({ ...options, compiler: workingCompiler });

    expect(fallback.manifest.mode).toBe("fallback");
    expect(failedCompiler).toHaveBeenCalledOnce();
    expect(recovered.manifest.mode).toBe("compiled");
    expect(workingCompiler).toHaveBeenCalledOnce();
  });

  it("backs off the same failing compiler identity without making the failure permanent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T00:00:00Z"));
    const workspace = createWorkspace();
    const content = createLargeContent("backoff");
    writeFileSync(workspace.agentsPath, content);
    let shouldFail = true;
    const compiler = vi.fn<ProjectInstructionCompiler>(async (request) => {
      if (shouldFail) throw new Error("malformed response");
      return {
        body: `Use read_rules for ${request.modules[0].link}.`,
        triggers: Object.fromEntries(request.modules.map((module) => [module.id, `When ${module.title} applies`])),
      };
    });
    const options = {
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler,
      compilerIdentity: "test/model",
      compilerFailureBackoffMs: 300_000,
    };

    expect((await prepareProjectInstructions(options)).manifest.mode).toBe("fallback");
    shouldFail = false;
    expect((await prepareProjectInstructions(options)).manifest.mode).toBe("fallback");
    expect(compiler).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(300_001);
    expect((await prepareProjectInstructions(options)).manifest.mode).toBe("compiled");
    expect(compiler).toHaveBeenCalledTimes(2);
  });

  it("retries immediately when the compiler identity changes during backoff", async () => {
    const workspace = createWorkspace();
    const content = createLargeContent("identity-change");
    writeFileSync(workspace.agentsPath, content);
    let shouldFail = true;
    const compiler = vi.fn<ProjectInstructionCompiler>(async (request) => {
      if (shouldFail) throw new Error("first model failed");
      return {
        body: `Use read_rules for ${request.modules[0].link}.`,
        triggers: {},
      };
    });
    const options = {
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler,
      compilerFailureBackoffMs: 300_000,
    };

    expect((await prepareProjectInstructions({ ...options, compilerIdentity: "first/model" })).manifest.mode).toBe(
      "fallback",
    );
    shouldFail = false;
    expect((await prepareProjectInstructions({ ...options, compilerIdentity: "second/model" })).manifest.mode).toBe(
      "compiled",
    );
    expect(compiler).toHaveBeenCalledTimes(2);
  });

  it("reuses AGENTS compilation when only the visible skill catalog changes", async () => {
    const workspace = createWorkspace();
    const content = createLargeContent("skill-independent");
    writeFileSync(workspace.agentsPath, content);
    const compiler = createCompiler();
    const firstSkill = createSkill(workspace.root, "first-skill");
    const base = {
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content }],
      compiler,
    };

    const first = await prepareProjectInstructions({ ...base, skills: [firstSkill] });
    const second = await prepareProjectInstructions({
      ...base,
      skills: [firstSkill, createSkill(workspace.root, "second-skill")],
    });

    expect(compiler).toHaveBeenCalledOnce();
    expect(second.manifest.inputHash).not.toBe(first.manifest.inputHash);
    expect(second.manifest.skills).toHaveLength(2);
  });

  it("preserves no-newline Unicode content across byte-bounded module splits", async () => {
    const workspace = createWorkspace();
    const content = `# Rules\n${"a".repeat(23_999)}😀${"b".repeat(25_000)}`;
    writeFileSync(workspace.agentsPath, content);
    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: createCompiler(),
    });

    const restored = prepared.manifest.rules
      .map((rule) => readFileSync(join(prepared.versionDir, rule.file), "utf8"))
      .join("");
    expect(restored).toBe(content);
    expect(restored).not.toContain("�");
    for (const rule of prepared.manifest.rules) {
      expect(Buffer.byteLength(readFileSync(join(prepared.versionDir, rule.file)))).toBeLessThanOrEqual(
        PROJECT_INSTRUCTION_MODULE_MAX_BYTES,
      );
    }
  });

  it.each([
    ["blank body", async () => ({ body: " ", triggers: {} })],
    ["unknown link", async () => ({ body: "Read rules/not-cataloged.md", triggers: {} })],
    ["extra trigger", async () => ({ body: "Read rules/catalog.md", triggers: { "not-a-module": "Always" } })],
  ])("fails closed for %s compiler output", async (_label, compiler) => {
    const workspace = createWorkspace();
    const content = createLargeContent("invalid");
    writeFileSync(workspace.agentsPath, content);
    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler,
    });
    expect(prepared.manifest.mode).toBe("fallback");
    expect(prepared.manifest.compilerStatus).toBe("failed");
  });

  it("uses fallback triggers for omitted module IDs and preserves a closing tag for a huge body", async () => {
    const workspace = createWorkspace();
    const content = createLargeContent("bounded");
    writeFileSync(workspace.agentsPath, content);
    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async () => ({ body: "x".repeat(100_000), triggers: {} }),
    });

    expect(prepared.manifest.mode).toBe("compiled");
    expect(prepared.manifest.rules[0].trigger).toMatch(/^Work involving/u);
    expect(prepared.prompt).toMatch(/<\/project_instructions>$/u);
    expect(prepared.prompt.length).toBeLessThan(5_000);
  });
});

describe("project instruction catalog pagination", () => {
  it("makes a catalog larger than the read cap discoverable through bounded pages", () => {
    const rules = Array.from(
      { length: 3_000 },
      (_, index): ProjectInstructionRuleRecord => ({
        id: `rule-${index}`,
        link: `rules/rule-${index}.md`,
        file: `rules/rule-${index}.md`,
        title: `Rule ${index}`,
        trigger: `Condition ${index} ${"detail ".repeat(35)}`,
        sourcePath: "/repo/AGENTS.md",
        contentHash: "a".repeat(64),
      }),
    );
    const catalog = renderRulesCatalog(rules);
    const originalBytes = Buffer.byteLength(
      rules.map((rule) => `${rule.link}${rule.trigger}${rule.sourcePath}`).join(""),
    );

    expect(originalBytes).toBeGreaterThan(512_000);
    expect(catalog.pages.length).toBeGreaterThan(1);
    expect(Buffer.byteLength(catalog.root)).toBeLessThan(512_000);
    for (const page of catalog.pages) expect(Buffer.byteLength(page.content)).toBeLessThanOrEqual(128_000);
    const allPages = catalog.pages.map((page) => page.content).join("");
    for (const rule of rules) expect(allPages).toContain(rule.link);
  });
});
