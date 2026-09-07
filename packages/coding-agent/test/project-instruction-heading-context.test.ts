import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isUnmistakablyGlobalConstraint,
  materializeProjectInstructionCompilerResult,
} from "../src/core/project-instructions/compiler-validation.ts";
import {
  PROJECT_INSTRUCTION_COMPILER_VERSION,
  prepareProjectInstructions,
} from "../src/core/project-instructions/index.ts";
import { DEFAULT_MODEL_COMPILER_CONTRACT_REVISION } from "../src/core/project-instructions/session-controller.ts";
import type {
  ProjectInstructionCompilerRequest,
  ProjectInstructionScope,
} from "../src/core/project-instructions/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createWorkspace(): { root: string; agentsPath: string } {
  const root = mkdtempSync(join(tmpdir(), "p-project-heading-context-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  return { root, agentsPath: join(root, "AGENTS.md") };
}

function compileHeadingFixture(request: ProjectInstructionCompilerRequest) {
  const constraints = Object.fromEntries(
    request.constraints.map((constraint) => {
      const semanticText = [...constraint.headingContext.map((heading) => heading.content), constraint.content].join(
        "\n",
      );
      return [
        constraint.id,
        isUnmistakablyGlobalConstraint(semanticText) || semanticText.includes("кожному завданні")
          ? "always-on"
          : "routed",
      ];
    }),
  ) as Record<string, ProjectInstructionScope>;
  const modules = Object.fromEntries(
    request.modules.map((module) => [
      module.id,
      request.constraints.some(
        (constraint) => constraint.moduleId === module.id && constraints[constraint.id] === "always-on",
      ) || !request.constraints.some((constraint) => constraint.moduleId === module.id)
        ? "always-on"
        : "routed",
    ]),
  ) as Record<string, ProjectInstructionScope>;
  const triggers = Object.fromEntries(
    request.modules.flatMap((module) => {
      const routed = request.constraints.find(
        (constraint) => constraint.moduleId === module.id && constraints[constraint.id] === "routed",
      );
      const sourceWords = routed?.content.match(/[\p{L}\p{N}]+/gu) ?? [];
      const trigger = [routed?.headingContext.at(-1)?.content, sourceWords.slice(0, 10).join(" ")]
        .filter(Boolean)
        .join(" ");
      return routed ? [[module.id, trigger]] : [];
    }),
  );
  return materializeProjectInstructionCompilerResult({ modules, constraints }, triggers, request.constraints);
}

describe("project instruction heading context", () => {
  it("preserves multilingual, generic, fragment, and mixed-scope heading semantics", async () => {
    const workspace = createWorkspace();
    const content = [
      "## Ніколи не публікуй секрети в кожному завданні\n",
      "## Commands\n### Must\nRun focused tests before code changes.\n",
      "## Safety\n### Required behavior\nAlways protect credentials across every task.\n\nNever publish artifacts during draft work.\n",
      "## Universal safety\n### Across all tasks\nProtect secrets.\n",
      `## Background\n### Reference Notes\n${"Background context for release verification.\n".repeat(160)}`,
    ].join("");
    writeFileSync(workspace.agentsPath, content);
    let compilerRequest: ProjectInstructionCompilerRequest | undefined;

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => {
        compilerRequest = request;
        return compileHeadingFixture(request);
      },
    });

    const constraints = compilerRequest?.constraints ?? [];
    const cyrillic = constraints.find((constraint) => constraint.content.includes("Ніколи"));
    expect(cyrillic).toMatchObject({ kind: "orphan-heading", headingContext: [] });
    const focusedTests = constraints.find((constraint) => constraint.content.startsWith("Run focused tests"));
    expect(focusedTests?.headingContext.map((heading) => heading.content)).toEqual(["## Commands", "### Must"]);
    expect(constraints.map((constraint) => constraint.content)).not.toContain("## Commands");
    expect(constraints.map((constraint) => constraint.content)).not.toContain("### Required behavior");
    const global = constraints.find((constraint) => constraint.content.includes("every task"));
    expect(global?.headingContext.map((heading) => heading.content)).toEqual(["## Safety", "### Required behavior"]);
    expect(prepared.manifest.compilerStatus).toBe("success");
    expect(prepared.manifest.mode).toBe("compiled");
    expect(prepared.manifest.compilerVersion).toBe(PROJECT_INSTRUCTION_COMPILER_VERSION);
    expect(PROJECT_INSTRUCTION_COMPILER_VERSION).toBe("project-instructions-v4-exact-source-v15-module-dependencies");
    expect(DEFAULT_MODEL_COMPILER_CONTRACT_REVISION).toBe("exact-source-v10-sparse-scope-calibration");
    expect(prepared.prompt).toContain("## Ніколи не публікуй секрети в кожному завданні");
    expect(prepared.prompt).toContain(
      "## Safety\n### Required behavior\nAlways protect credentials across every task.",
    );
    expect(prepared.prompt).toContain("## Universal safety\n### Across all tasks\nProtect secrets.");
    expect(prepared.prompt).not.toContain("Never publish artifacts during draft work.");
    const safetyRule = prepared.manifest.rules.find((rule) => rule.title === "Safety");
    expect(safetyRule?.routable).toBe(true);
    expect(safetyRule?.trigger).toContain("### Required behavior");
  });

  it("grounds a routed trigger in a generic governing heading", async () => {
    const workspace = createWorkspace();
    const content = `## Operations\n### Deployment\nDo it.\n${"Supporting context without activity terms.\n".repeat(180)}`;
    writeFileSync(workspace.agentsPath, content);

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => {
        const classifications = {
          modules: Object.fromEntries(request.modules.map((module) => [module.id, "routed" as const])),
          constraints: Object.fromEntries(request.constraints.map((constraint) => [constraint.id, "routed" as const])),
        };
        return materializeProjectInstructionCompilerResult(
          classifications,
          { [request.modules[0]!.id]: "Deployment" },
          request.constraints,
        );
      },
    });

    expect(prepared.manifest.compilerStatus).toBe("success");
    expect(prepared.manifest.mode).toBe("compiled");
    expect(prepared.manifest.rules[0]?.trigger).toBe("Deployment");
  });

  it("rejects routing an always-on scope declared only by a governing heading", async () => {
    const workspace = createWorkspace();
    const content = `## Security\n### Across all tasks\nProtect secrets.\n${"Supporting security context.\n".repeat(220)}`;
    writeFileSync(workspace.agentsPath, content);

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => ({
        body: "No source constraints apply to every task.",
        classifications: {
          modules: Object.fromEntries(request.modules.map((module) => [module.id, "routed"])),
          constraints: Object.fromEntries(request.constraints.map((constraint) => [constraint.id, "routed"])),
        },
        triggers: Object.fromEntries(request.modules.map((module) => [module.id, "Security"])),
        alwaysOn: {},
      }),
    });

    expect(prepared.manifest.compilerStatus).toBe("failed");
    expect(prepared.manifest.mode).toBe("fallback");
  });

  it("carries heading context into byte-split continuation modules", async () => {
    const workspace = createWorkspace();
    const content = `## Operations\n### Deployment\nDo it.\n${Array.from(
      { length: 900 },
      (_, index) => `- Supporting continuation detail ${index}.`,
    ).join("\n")}\n`;
    writeFileSync(workspace.agentsPath, content);
    let compilerRequest: ProjectInstructionCompilerRequest | undefined;

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => {
        compilerRequest = request;
        return compileHeadingFixture(request);
      },
    });

    expect(compilerRequest?.modules.length).toBeGreaterThan(1);
    const continuationModule = compilerRequest?.modules[1];
    expect(continuationModule?.headingContext?.map(({ content }) => content)).toEqual([
      "## Operations",
      "### Deployment",
    ]);
    const continuationConstraints = compilerRequest?.constraints.filter(
      (constraint) => constraint.moduleId === continuationModule?.id,
    );
    expect(continuationConstraints?.[0]?.headingContext.map((heading) => heading.content)).toEqual([
      "## Operations",
      "### Deployment",
    ]);
    expect(prepared.manifest.compilerStatus).toBe("success");
    expect(prepared.manifest.mode).toBe("compiled");
    expect(prepared.manifest.rules[1]?.title).toBe("Deployment part 2");
    expect(prepared.manifest.rules[1]?.trigger).toContain("### Deployment");
  });

  it("inherits a parent heading across a normal major-heading module boundary", async () => {
    const workspace = createWorkspace();
    const content = [
      "# Across every task\n",
      "## Security\nProtect secrets.\n",
      `# Deployment\nFor deployment work, follow the release checklist.\n${"Deployment detail.\n".repeat(180)}`,
    ].join("");
    writeFileSync(workspace.agentsPath, content);
    let compilerRequest: ProjectInstructionCompilerRequest | undefined;

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => {
        compilerRequest = request;
        return compileHeadingFixture(request);
      },
    });

    const security = compilerRequest?.constraints.find((constraint) => constraint.content === "Protect secrets.");
    expect(security?.headingContext.map(({ content }) => content)).toEqual(["# Across every task", "## Security"]);
    expect(prepared.prompt.match(/# Across every task/gu)).toHaveLength(1);
    expect(prepared.prompt).toContain("# Across every task\n## Security\nProtect secrets.");
  });

  it("deduplicates one inherited heading identity across byte-split always-on children", async () => {
    const workspace = createWorkspace();
    const supporting = Array.from({ length: 1_000 }, (_, index) => `- Supporting detail ${index}.`);
    supporting.splice(5, 0, "- Keep this first invariant.");
    supporting.splice(920, 0, "- Keep this second invariant.");
    const content = `# Safety\n${supporting.join("\n")}\n`;
    writeFileSync(workspace.agentsPath, content);
    let compilerRequest: ProjectInstructionCompilerRequest | undefined;

    const prepared = await prepareProjectInstructions({
      cwd: workspace.root,
      contextFiles: [{ path: workspace.agentsPath, content }],
      skills: [],
      compiler: async (request) => {
        compilerRequest = request;
        const constraints = Object.fromEntries(
          request.constraints.map((constraint) => [
            constraint.id,
            constraint.content.includes("Keep this") ? "always-on" : "routed",
          ]),
        ) as Record<string, ProjectInstructionScope>;
        const modules = Object.fromEntries(
          request.modules.map((module) => [
            module.id,
            request.constraints.some(
              (constraint) => constraint.moduleId === module.id && constraints[constraint.id] === "always-on",
            ) || !request.constraints.some((constraint) => constraint.moduleId === module.id)
              ? "always-on"
              : "routed",
          ]),
        ) as Record<string, ProjectInstructionScope>;
        const triggers = Object.fromEntries(
          request.modules.flatMap((module) =>
            request.constraints.some(
              (constraint) => constraint.moduleId === module.id && constraints[constraint.id] === "routed",
            )
              ? [[module.id, "Supporting detail"]]
              : [],
          ),
        );
        return materializeProjectInstructionCompilerResult({ modules, constraints }, triggers, request.constraints);
      },
    });

    expect(compilerRequest?.modules.length).toBeGreaterThan(1);
    const inheritedIds = new Set(
      compilerRequest?.constraints.flatMap((constraint) =>
        constraint.headingContext.filter(({ content }) => content === "# Safety").map(({ id }) => id),
      ),
    );
    expect(inheritedIds.size).toBe(1);
    expect(prepared.prompt.match(/# Safety/gu)).toHaveLength(1);
    expect(prepared.prompt).toContain("Keep this first invariant.");
    expect(prepared.prompt).toContain("Keep this second invariant.");
  });
});
