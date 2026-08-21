import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCachedProjectInstructions } from "../src/core/project-instructions/cache.ts";
import {
  buildSkillRecords,
  buildSourceRecords,
  splitInstructionSources,
} from "../src/core/project-instructions/content.ts";
import {
  createProjectInstructionState,
  PROJECT_INSTRUCTION_COMPILER_VERSION,
  type ProjectInstructionCompiler,
  prepareProjectInstructions,
} from "../src/core/project-instructions/index.ts";
import { computeProjectInstructionResultHash } from "../src/core/project-instructions/manifest.ts";
import { getProjectInstructionFallbackPath } from "../src/core/project-instructions/paths.ts";
import { readRuleLinks } from "../src/core/project-instructions/reader.ts";
import type { ProjectInstructionManifest } from "../src/core/project-instructions/types.ts";
import type { Skill } from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";

const temporaryDirectories: string[] = [];

function createWorkspace(): { root: string; agentsPath: string; cacheDir: string; content: string } {
  const root = mkdtempSync(join(tmpdir(), "p-project-integrity-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  const agentsPath = join(root, "AGENTS.md");
  const content = Array.from(
    { length: 90 },
    (_, index) => `## Integrity ${index}\n\nAlways preserve integrity ${index}. ${"detail ".repeat(12)}\n`,
  ).join("");
  writeFileSync(agentsPath, content);
  return { root, agentsPath, cacheDir: join(root, ".pdev", "instructions"), content };
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

function createCompiler(): ProjectInstructionCompiler {
  return vi.fn(async (request: Parameters<ProjectInstructionCompiler>[0]) => ({
    body: `Use read_rules for ${request.modules[0].link}.`,
    triggers: Object.fromEntries(request.modules.map((module) => [module.id, `When ${module.title} applies`])),
  }));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("project instruction cache authority", () => {
  it.each([
    [
      "skill base directory",
      (manifest: ProjectInstructionManifest) => {
        manifest.skills[0].baseDir = "/";
      },
    ],
    [
      "source and module provenance",
      (manifest: ProjectInstructionManifest) => {
        manifest.sources[0].path = "/forged/AGENTS.md";
        manifest.rules[0].sourcePath = "/forged/AGENTS.md";
      },
    ],
  ])("rejects a self-consistent manifest with forged %s", async (_label, mutate) => {
    const workspace = createWorkspace();
    const skill = createSkill(workspace.root, "secure-skill");
    const sources = [{ path: workspace.agentsPath, content: workspace.content }];
    const compiler = createCompiler();
    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: sources,
      skills: [skill],
      compiler,
    });
    const forged = structuredClone(prepared.manifest);
    mutate(forged);
    forged.resultHash = computeProjectInstructionResultHash(forged);
    const forgedVersion = `${forged.inputHash}-${forged.resultHash}`;
    const forgedVersionDir = join(dirname(prepared.versionDir), forgedVersion);
    writeFileSync(join(prepared.versionDir, "manifest.json"), `${JSON.stringify(forged, null, 2)}\n`);
    renameSync(prepared.versionDir, forgedVersionDir);
    writeFileSync(
      join(prepared.cacheDir, "current.json"),
      `${JSON.stringify({ schemaVersion: 1, agentsHash: forged.agentsHash, inputHash: forged.inputHash, version: forgedVersion })}\n`,
    );
    writeFileSync(
      getProjectInstructionFallbackPath(prepared.cacheDir, forged.inputHash),
      renderForgedFallback(forged, forgedVersionDir),
    );

    const loaded = loadCachedProjectInstructions({
      cacheDir: prepared.cacheDir,
      workspaceRoot: realpathSync(workspace.root),
      agentsHash: prepared.manifest.agentsHash,
      inputHash: prepared.manifest.inputHash,
      compilerVersion: PROJECT_INSTRUCTION_COMPILER_VERSION,
      expected: {
        sources: buildSourceRecords(sources),
        modules: splitInstructionSources(sources),
        skills: buildSkillRecords([skill]),
      },
    });
    expect(loaded).toBeUndefined();
  });

  it("keeps immutable versions readable across different skill inputs", async () => {
    const workspace = createWorkspace();
    const compiler = createCompiler();
    const firstSkill = createSkill(workspace.root, "first");
    const base = {
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content: workspace.content }],
      compiler,
    };
    const first = await prepareProjectInstructions({ ...base, skills: [firstSkill] });
    const second = await prepareProjectInstructions({
      ...base,
      skills: [firstSkill, createSkill(workspace.root, "second")],
    });

    expect(readRuleLinks(createProjectInstructionState(first), [first.manifest.rules[0].link])).toContain(
      "preserve integrity",
    );
    expect(readRuleLinks(createProjectInstructionState(second), [second.manifest.rules[0].link])).toContain(
      "preserve integrity",
    );
  });

  it("rejects a cache path with a symlink in an earlier ancestor", async () => {
    const workspace = createWorkspace();
    const outside = mkdtempSync(join(tmpdir(), "p-project-integrity-outside-"));
    temporaryDirectories.push(outside);
    mkdirSync(join(workspace.root, ".pdev"));
    symlinkSync(outside, join(workspace.root, ".pdev", "link"));
    const nestedCache = join(workspace.root, ".pdev", "link", "a", "instructions");

    await expect(
      prepareProjectInstructions({
        cwd: workspace.root,
        cacheDir: nestedCache,
        contextFiles: [{ path: workspace.agentsPath, content: workspace.content }],
        skills: [],
        compiler: createCompiler(),
      }),
    ).rejects.toThrow(/cache.*workspace|symlink/i);
  });
});

describe("project instruction cache concurrency", () => {
  it("accepts the winner when two processes persist the same deterministic version", async () => {
    const workspace = createWorkspace();
    const runner = join(workspace.root, "same-result-runner.js");
    const processorPath = fileURLToPath(new URL("../src/core/project-instructions/processor.ts", import.meta.url));
    writeFileSync(runner, createConcurrentRunner());
    const children = ["one", "two"].map((id) =>
      runChild(runner, processorPath, workspace.root, workspace.agentsPath, id),
    );
    const results = await Promise.all(children);
    expect(results).toEqual([0, 0]);

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content: workspace.content }],
      skills: [],
      compiler: createCompiler(),
    });
    expect(prepared.manifest.mode).toBe("compiled");
    expect(readRuleLinks(createProjectInstructionState(prepared), [prepared.manifest.rules[0].link])).toContain(
      "preserve integrity",
    );
  });
});

function renderForgedFallback(manifest: ProjectInstructionManifest, versionDir: string): string {
  return `${[
    "# Ordinary-read project instruction fallback",
    "",
    `Input SHA-256: ${manifest.inputHash}`,
    `Immutable cache version: ${versionDir}`,
    `Physical rule catalog: ${join(versionDir, manifest.rulesCatalogFile)}`,
    `Physical skill catalog: ${join(versionDir, manifest.skillsCatalogFile)}`,
    "",
    "## Authoritative instruction sources",
    ...manifest.sources.map((source) => `- ${source.path}`),
    "",
    "## Authoritative skill roots",
    ...manifest.skills.map((skill) => `- ${skill.name}: ${skill.filePath}`),
    "",
    "Resolve relative catalog page and module links from the immutable cache version directory.",
  ].join("\n")}\n`;
}

function createConcurrentRunner(): string {
  return `import { readFileSync, writeFileSync, existsSync } from "node:fs";
const [processorPath, root, agentsPath, id] = process.argv.slice(2);
const { prepareProjectInstructions } = await import(processorPath);
const content = readFileSync(agentsPath, "utf8");
await prepareProjectInstructions({ cwd: root, contextFiles: [{ path: agentsPath, content }], skills: [], compiler: async (request) => {
  writeFileSync(root + "/ready-" + id, "ready\\n");
  while (!existsSync(root + "/ready-one") || !existsSync(root + "/ready-two")) await new Promise((resolve) => setTimeout(resolve, 5));
  return { body: "Use read_rules for " + request.modules[0].link + ".", triggers: Object.fromEntries(request.modules.map((module) => [module.id, "When " + module.title + " applies"])) };
} });
`;
}

function runChild(
  runner: string,
  processorPath: string,
  root: string,
  agentsPath: string,
  id: string,
): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [runner, processorPath, root, agentsPath, id], {
      cwd: dirname(processorPath),
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorOutput = "";
    child.stderr.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(0);
      else reject(new Error(`Concurrent cache child failed (${code ?? "signal"}): ${errorOutput}`));
    });
  });
}
