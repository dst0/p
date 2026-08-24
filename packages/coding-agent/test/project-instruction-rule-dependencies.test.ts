import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { hashText } from "../src/core/project-instructions/content.ts";
import {
  expandProjectInstructionRuleLinks,
  validateProjectInstructionRuleDependencies,
} from "../src/core/project-instructions/dependency-graph.ts";
import {
  PROJECT_INSTRUCTION_READ_MAX_BYTES,
  PROJECT_INSTRUCTION_RULE_EXPANSION_MAX_MODULES,
} from "../src/core/project-instructions/limits.ts";
import { prepareProjectInstructions } from "../src/core/project-instructions/processor.ts";
import { renderProjectInstructions, renderRulesCatalog } from "../src/core/project-instructions/prompt.ts";
import type { ProjectInstructionRuleRecord, ProjectInstructionState } from "../src/core/project-instructions/types.ts";
import { createReadRulesToolDefinition } from "../src/core/tools/read-rules.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

const temporaryDirectories: string[] = [];
const extensionContext = {} as ExtensionContext;

function rule(name: string, requires: string[] = []): ProjectInstructionRuleRecord {
  const link = `rules/${name}.md`;
  return {
    id: name,
    link,
    file: link,
    title: name,
    trigger: `When ${name} applies`,
    routable: true,
    requires,
    sourcePath: "AGENTS.md",
    contentHash: hashText(`${name}\n`),
  };
}

function createState(rules: ProjectInstructionRuleRecord[]): ProjectInstructionState {
  const root = mkdtempSync(join(tmpdir(), "p-rule-dependencies-"));
  temporaryDirectories.push(root);
  const inputHash = "a".repeat(64);
  const resultHash = "b".repeat(64);
  const versionDir = join(root, `${inputHash}-${resultHash}`);
  mkdirSync(join(versionDir, "rules"), { recursive: true });
  for (const record of rules) writeFileSync(join(versionDir, record.file), `${record.id}\n`);
  return {
    current: {
      prompt: "",
      cacheDir: root,
      versionDir,
      manifest: {
        schemaVersion: 1,
        compilerVersion: "test",
        agentsHash: "c".repeat(64),
        inputHash,
        resultHash,
        promptHash: hashText(""),
        rulesCatalogHash: hashText(""),
        skillsCatalogHash: hashText(""),
        rulesCatalogPages: [],
        skillsCatalogPages: [],
        mode: "compiled",
        compilerStatus: "success",
        promptFile: "prompt.md",
        rulesCatalogFile: "rules/catalog.md",
        skillsCatalogFile: "skills/catalog.md",
        sources: [],
        rules,
        skills: [],
      },
    },
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("rule dependency graph validation", () => {
  it("rejects missing, traversing, and cyclic prerequisites", () => {
    expect(() => validateProjectInstructionRuleDependencies([rule("a", ["rules/missing.md"])])).toThrow(
      /missing dependency.*rules\/missing\.md/iu,
    );
    expect(() => validateProjectInstructionRuleDependencies([rule("a", ["../outside.md"])])).toThrow(
      /invalid dependency link/iu,
    );
    expect(() =>
      validateProjectInstructionRuleDependencies([rule("a", ["rules/b.md"]), rule("b", ["rules/a.md"])]),
    ).toThrow(/dependency cycle.*rules\/a\.md.*rules\/b\.md.*rules\/a\.md/iu);
  });

  it("expands prerequisites before selected rules once and enforces explicit and expanded bounds", () => {
    const rules = [
      rule("foundation"),
      rule("implementation", ["rules/foundation.md", "rules/foundation.md"]),
      rule("verification", ["rules/foundation.md", "rules/implementation.md"]),
    ];
    expect(expandProjectInstructionRuleLinks(rules, ["rules/verification.md", "rules/implementation.md"])).toEqual([
      "rules/foundation.md",
      "rules/implementation.md",
      "rules/verification.md",
    ]);
    expect(() =>
      expandProjectInstructionRuleLinks(rules, [
        "rules/foundation.md",
        "rules/implementation.md",
        "rules/verification.md",
        "rules/catalog.md",
      ]),
    ).toThrow(/at most 3/iu);

    const oversized = Array.from({ length: PROJECT_INSTRUCTION_RULE_EXPANSION_MAX_MODULES + 1 }, (_, index) =>
      rule(`chain-${index}`, index === 0 ? [] : [`rules/chain-${index - 1}.md`]),
    );
    expect(() => expandProjectInstructionRuleLinks(oversized, [oversized.at(-1)?.link ?? ""])).toThrow(
      /dependency expansion.*module limit/iu,
    );

    const deep = Array.from({ length: 20_000 }, (_, index) =>
      rule(`deep-${index}`, index === 0 ? [] : [`rules/deep-${index - 1}.md`]),
    );
    expect(() => expandProjectInstructionRuleLinks(deep, [deep.at(-1)?.link ?? ""])).toThrow(
      /dependency expansion.*module limit/iu,
    );
  });

  it("keeps dependency routing metadata in the catalog and out of the always-on body", () => {
    const independent = rule("implementation");
    const dependent = rule("implementation", ["rules/foundation.md"]);
    const render = (record: ProjectInstructionRuleRecord) =>
      renderProjectInstructions({
        agentsHash: "a".repeat(64),
        inputHash: "b".repeat(64),
        cacheDir: "/workspace/.pdev/instructions",
        mode: "compiled",
        body: "Always preserve the global invariant.",
        sources: [],
        rules: [record],
        skills: [],
      });

    expect(render(dependent)).toBe(render(independent));
    expect(renderRulesCatalog([dependent]).root).toContain("Requires: rules/foundation.md");
  });

  it("resolves compiler-declared module ids to immutable catalog links", async () => {
    const root = mkdtempSync(join(tmpdir(), "p-rule-dependency-compiler-"));
    temporaryDirectories.push(root);
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    const agentsPath = join(root, "AGENTS.md");
    const content = [
      `# Foundation\n\nPreserve the foundation.\n${"Foundation detail.\n".repeat(90)}`,
      `# Implementation\n\nApply the implementation.\n${"Implementation detail.\n".repeat(90)}`,
    ].join("\n");
    writeFileSync(agentsPath, content);
    const prepared = await prepareProjectInstructions({
      cwd: root,
      contextFiles: [{ path: agentsPath, content }],
      skills: [],
      compiler: async (request) => {
        const result = createProjectInstructionCompilation(request);
        return Object.assign(result, { requires: { [request.modules[1].id]: [request.modules[0].id] } });
      },
    });

    expect(prepared.manifest.mode).toBe("compiled");
    expect(prepared.manifest.rules[1].requires).toEqual([prepared.manifest.rules[0].link]);
  });
});

describe("read_rules dependency expansion", () => {
  it("returns a deduplicated transitive closure in one validated call", async () => {
    const rules = [
      rule("foundation"),
      rule("implementation", ["rules/foundation.md"]),
      rule("verification", ["rules/foundation.md", "rules/implementation.md"]),
    ];
    const state = createState(rules);
    const onValidatedRead = vi.fn();
    const tool = createReadRulesToolDefinition(state, onValidatedRead);

    expect(Value.Check(tool.parameters, { links: rules.map((record) => record.link) })).toBe(true);
    expect(Value.Check(tool.parameters, { links: [...rules.map((record) => record.link), "rules/extra.md"] })).toBe(
      false,
    );
    const result = await tool.execute(
      "call",
      { links: ["rules/verification.md", "rules/implementation.md"] },
      undefined,
      undefined,
      extensionContext,
    );
    const text = result.content[0].type === "text" ? result.content[0].text : "";
    expect(text.match(/^## rules\/.+\.md$/gmu)).toEqual([
      "## rules/foundation.md",
      "## rules/implementation.md",
      "## rules/verification.md",
    ]);
    expect(onValidatedRead).toHaveBeenCalledOnce();
    expect(onValidatedRead).toHaveBeenCalledWith(["rules/verification.md", "rules/implementation.md"]);
  });

  it("counts transitive prerequisite bytes against the single-call read ceiling", async () => {
    const rules = [rule("foundation"), rule("selected", ["rules/foundation.md"])];
    const state = createState(rules);
    const prepared = state.current;
    if (!prepared) throw new Error("Expected prepared state");
    const dependency = prepared.manifest.rules[0];
    const selected = prepared.manifest.rules[1];
    const dependencyContent = "x".repeat(Math.floor(PROJECT_INSTRUCTION_READ_MAX_BYTES / 2));
    const selectedContent = "y".repeat(Math.floor(PROJECT_INSTRUCTION_READ_MAX_BYTES / 2));
    writeFileSync(join(prepared.versionDir, dependency.file), dependencyContent);
    writeFileSync(join(prepared.versionDir, selected.file), selectedContent);
    dependency.contentHash = hashText(dependencyContent);
    selected.contentHash = hashText(selectedContent);

    const tool = createReadRulesToolDefinition(state);
    await expect(
      tool.execute("call", { links: [selected.link] }, undefined, undefined, extensionContext),
    ).rejects.toThrow(/read limit/iu);
  });
});
