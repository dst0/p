import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCachedProjectInstructions, persistProjectInstructions } from "../src/core/project-instructions/cache.ts";
import {
  buildSkillRecords,
  buildSourceRecords,
  splitInstructionSources,
} from "../src/core/project-instructions/content.ts";
import {
  PROJECT_INSTRUCTION_COMPILER_VERSION,
  prepareProjectInstructions,
} from "../src/core/project-instructions/index.ts";
import { getProjectInstructionFallbackPath } from "../src/core/project-instructions/paths.ts";
import { renderRulesCatalog, renderSkillsCatalog } from "../src/core/project-instructions/prompt.ts";

const temporaryDirectories: string[] = [];

function createWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "p-project-cache-recovery-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  const agentsPath = join(root, "AGENTS.md");
  const content = "# Rules\n\nAlways repair instruction cache authority.\n";
  writeFileSync(agentsPath, content);
  const sources = [{ path: agentsPath, content }];
  return { root, agentsPath, content, sources, cacheDir: join(root, ".pdev", "instructions") };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("project instruction cache recovery", () => {
  it("repairs invalid pointers, missing fallback guidance, invalid manifests, and escaping rule symlinks", async () => {
    const workspace = createWorkspace();
    const options = {
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: workspace.sources,
      skills: [],
    };
    const first = await prepareProjectInstructions(options);
    const currentPath = join(first.cacheDir, "current.json");
    const fallbackPath = getProjectInstructionFallbackPath(first.cacheDir, first.manifest.inputHash);

    writeFileSync(currentPath, '{"schemaVersion":2}\n');
    expect((await prepareProjectInstructions(options)).prompt).toBe(first.prompt);

    rmSync(fallbackPath);
    expect((await prepareProjectInstructions(options)).prompt).toBe(first.prompt);
    expect(readFileSync(fallbackPath, "utf8")).toContain("Ordinary-read project instruction fallback");

    writeFileSync(join(first.versionDir, "manifest.json"), "{}\n");
    expect((await prepareProjectInstructions(options)).manifest).toEqual(first.manifest);

    const rule = first.manifest.rules[0];
    const outsideRule = join(workspace.root, "outside-rule.md");
    writeFileSync(outsideRule, "forged rule\n");
    rmSync(join(first.versionDir, rule.file));
    symlinkSync(outsideRule, join(first.versionDir, rule.file));
    const repaired = await prepareProjectInstructions(options);
    expect(readFileSync(join(repaired.versionDir, rule.file), "utf8")).toBe(workspace.content);
  });

  it("does not load a cache located outside the authoritative workspace", () => {
    const workspace = createWorkspace();
    const outside = mkdtempSync(join(tmpdir(), "p-project-cache-outside-"));
    temporaryDirectories.push(outside);
    expect(
      loadCachedProjectInstructions({
        cacheDir: outside,
        workspaceRoot: realpathSync(workspace.root),
        agentsHash: "a".repeat(64),
        inputHash: "b".repeat(64),
        compilerVersion: PROJECT_INSTRUCTION_COMPILER_VERSION,
        expected: { sources: [], modules: [], skills: [] },
      }),
    ).toBeUndefined();
  });

  it("refuses to persist module content that does not match the integrity-checked manifest", async () => {
    const workspace = createWorkspace();
    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: workspace.sources,
      skills: [],
    });
    const modules = splitInstructionSources(workspace.sources);
    modules[0] = { ...modules[0], content: "forged module\n" };

    expect(() =>
      persistProjectInstructions({
        cacheDir: prepared.cacheDir,
        workspaceRoot: realpathSync(workspace.root),
        agentsHash: prepared.manifest.agentsHash,
        inputHash: prepared.manifest.inputHash,
        compilerVersion: PROJECT_INSTRUCTION_COMPILER_VERSION,
        expected: {
          sources: buildSourceRecords(workspace.sources),
          modules,
          skills: buildSkillRecords([]),
        },
        prompt: prepared.prompt,
        manifest: prepared.manifest,
        rulesCatalog: renderRulesCatalog(prepared.manifest.rules),
        skillsCatalog: renderSkillsCatalog(prepared.manifest.skills),
      }),
    ).toThrow(/does not match its manifest/u);
  });
});
