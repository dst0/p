import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { materializeProjectInstructionCompilerResult } from "../src/core/project-instructions/compiler-validation.ts";
import {
  prepareProjectInstructions,
  selectProjectInstructionRuleLinks,
} from "../src/core/project-instructions/index.ts";
import type { ProjectInstructionClassifications } from "../src/core/project-instructions/types.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

const temporaryDirectories: string[] = [];

function createWorkspace(): { root: string; agentsPath: string } {
  const root = mkdtempSync(join(tmpdir(), "p-project-v4-routing-"));
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

describe("project instruction compiler v4 routing", () => {
  it("fails closed when compiler classification omits source modules", async () => {
    const workspace = createWorkspace();
    const content = largeInstructions();
    writeFileSync(workspace.agentsPath, content);

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => {
        const result = createProjectInstructionCompilation(request);
        delete result.classifications.modules[request.modules.at(-1)?.id ?? ""];
        return result;
      },
    });

    expect(prepared.manifest.compilerStatus).toBe("failed");
    expect(prepared.manifest.mode).toBe("fallback");
  });

  it("fails closed when compiler classification omits a source constraint", async () => {
    const workspace = createWorkspace();
    const content = largeInstructions();
    writeFileSync(workspace.agentsPath, content);

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => {
        const result = createProjectInstructionCompilation(request);
        delete result.classifications.constraints[request.constraints.at(-1)?.id ?? ""];
        return result;
      },
    });

    expect(prepared.manifest.compilerStatus).toBe("failed");
    expect(prepared.manifest.mode).toBe("fallback");
  });

  it("rejects routing every unmistakably global Always, Never, and Must constraint", async () => {
    const workspace = createWorkspace();
    const content = [
      `## Always\n\nAlways preserve A on every task. ${"detail ".repeat(150)}\n`,
      `## Never\n\nNever discard B across all tasks. ${"detail ".repeat(150)}\n`,
      `## Must\n\nMust verify C for every request. ${"detail ".repeat(150)}\n`,
    ].join("");
    writeFileSync(workspace.agentsPath, content);

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => ({
        body: "No source constraints apply to every task.",
        triggers: {},
        classifications: {
          modules: Object.fromEntries(request.modules.map((module) => [module.id, "routed"])),
          constraints: Object.fromEntries(request.constraints.map((constraint) => [constraint.id, "routed"])),
        },
        alwaysOn: {},
      }),
    });

    expect(prepared.manifest.compilerStatus).toBe("failed");
    expect(prepared.manifest.mode).toBe("fallback");
  });

  it("requires every always-on module to contribute to the body", async () => {
    const workspace = createWorkspace();
    const content = largeInstructions();
    writeFileSync(workspace.agentsPath, content);

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => {
        const summaries = Object.fromEntries(
          request.constraints.slice(0, -1).map((constraint, index) => [constraint.id, `I${index}.`]),
        );
        return {
          body: Object.values(summaries).join("\n"),
          triggers: {},
          classifications: {
            modules: Object.fromEntries(request.modules.map((module) => [module.id, "always-on"])),
            constraints: Object.fromEntries(request.constraints.map((constraint) => [constraint.id, "always-on"])),
          },
          alwaysOn: summaries,
        };
      },
    });

    expect(prepared.manifest.compilerStatus).toBe("failed");
    expect(prepared.manifest.mode).toBe("fallback");
  });

  it("rejects punctuation-only always-on contributions", async () => {
    const workspace = createWorkspace();
    const content = largeInstructions();
    writeFileSync(workspace.agentsPath, content);

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => ({
        body: request.constraints.map(() => ".").join("\n"),
        triggers: {},
        classifications: {
          modules: Object.fromEntries(request.modules.map((module) => [module.id, "always-on"])),
          constraints: Object.fromEntries(request.constraints.map((constraint) => [constraint.id, "always-on"])),
        },
        alwaysOn: Object.fromEntries(request.constraints.map((constraint) => [constraint.id, "."])),
      }),
    });

    expect(prepared.manifest.compilerStatus).toBe("failed");
    expect(prepared.manifest.mode).toBe("fallback");
  });

  it("rejects always-on text that substitutes different actions and objects", async () => {
    const workspace = createWorkspace();
    const content = `# Security\n\nAlways encrypt credentials. ${"context ".repeat(400)}\n`;
    writeFileSync(workspace.agentsPath, content);

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => ({
        body: "Always delete files.",
        triggers: {},
        classifications: {
          modules: Object.fromEntries(request.modules.map((module) => [module.id, "always-on"])),
          constraints: Object.fromEntries(request.constraints.map((constraint) => [constraint.id, "always-on"])),
        },
        alwaysOn: Object.fromEntries(request.constraints.map((constraint) => [constraint.id, "Always delete files."])),
      }),
    });

    expect(prepared.manifest.compilerStatus).toBe("failed");
    expect(prepared.manifest.mode).toBe("fallback");
  });

  it("routes activity-specific modal rules but keeps true global rules in the base", async () => {
    const workspace = createWorkspace();
    const content = [
      "# Testing\n\nNever run npm test unless requested.\n",
      `${Array.from({ length: 30 }, (_, index) => `Testing context ${index} ${"detail ".repeat(10)}`).join("\n")}\n`,
      "# Security\n\nAlways protect credentials on every task.\n",
      `${Array.from({ length: 30 }, (_, index) => `Security context ${index} ${"detail ".repeat(10)}`).join("\n")}\n`,
    ].join("");
    writeFileSync(workspace.agentsPath, content);

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => {
        const global = request.constraints.find((constraint) => constraint.content.includes("every task"));
        if (!global) throw new Error("Missing global fixture constraint");
        const triggers = Object.fromEntries(
          request.modules.map((module) => [
            module.id,
            module.id === global.moduleId ? "Security context credentials" : "npm test execution",
          ]),
        );
        const classifications: ProjectInstructionClassifications = {
          modules: Object.fromEntries(
            request.modules.map((module) => [module.id, module.id === global.moduleId ? "always-on" : "routed"]),
          ),
          constraints: Object.fromEntries(
            request.constraints.map((constraint) => [
              constraint.id,
              constraint.id === global.id ? "always-on" : "routed",
            ]),
          ),
        };
        return materializeProjectInstructionCompilerResult(classifications, triggers, request.constraints);
      },
    });

    expect(prepared.manifest.compilerStatus).toBe("success");
    expect(prepared.manifest.mode).toBe("compiled");
    expect(prepared.prompt).toContain("Always protect credentials on every task.");
    expect(prepared.prompt).not.toContain("Never run npm test unless requested.");
  });

  it("rejects routed modules whose title-like trigger is not grounded in source activity", async () => {
    const workspace = createWorkspace();
    const content = `# Security edits\n\nRotate secrets now.\n${"Operational context.\n".repeat(150)}`;
    writeFileSync(workspace.agentsPath, content);

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => ({
        body: "No source constraints apply to every task.",
        triggers: { [request.modules[0].id]: "database migration" },
        classifications: {
          modules: Object.fromEntries(request.modules.map((module) => [module.id, "routed"])),
          constraints: Object.fromEntries(request.constraints.map((constraint) => [constraint.id, "routed"])),
        },
        alwaysOn: {},
      }),
    });

    expect(prepared.manifest.compilerStatus).toBe("failed");
    expect(prepared.manifest.mode).toBe("fallback");
  });

  it("selects zero to three links by lexical relevance with deterministic Unicode-aware ties", async () => {
    const workspace = createWorkspace();
    const content = [
      "## Security\n\nProtect credentials.\n",
      "## Testing\n\nRun focused tests.\n",
      "## Реліз\n\nПеревір публікацію.\n",
      "## Git\n\nPreserve branches.\n",
    ].join("");
    writeFileSync(workspace.agentsPath, content);
    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
    });
    const rules = prepared.manifest.rules.map((rule) => ({ ...rule, routable: true }));

    expect(selectProjectInstructionRuleLinks(rules, "unrelated weather forecast")).toEqual([]);
    expect(selectProjectInstructionRuleLinks(rules, "work involving project rules")).toEqual([]);
    const first = selectProjectInstructionRuleLinks(
      rules,
      "security testing реліз git credentials tests публікацію branches",
    );
    const second = selectProjectInstructionRuleLinks(
      rules,
      "security testing реліз git credentials tests публікацію branches",
    );
    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
    expect(first.every((link) => rules.some((rule) => rule.link === link))).toBe(true);
  });
});
