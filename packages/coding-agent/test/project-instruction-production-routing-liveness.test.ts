import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import { buildProjectInstructionConstraints } from "../src/core/project-instructions/compiler-constraints.ts";
import { deriveProjectInstructionTriggers } from "../src/core/project-instructions/compiler-triggers.ts";
import {
  materializeProjectInstructionCompilerResult,
  requiresConservativeAlwaysOn,
  validateProjectInstructionCompilerResult,
} from "../src/core/project-instructions/compiler-validation.ts";
import { splitInstructionSources } from "../src/core/project-instructions/content.ts";
import { selectProjectInstructionRuleLinks } from "../src/core/project-instructions/routing.ts";
import type {
  ProjectInstructionClassifications,
  ProjectInstructionCompilerRequest,
  ProjectInstructionRuleRecord,
} from "../src/core/project-instructions/types.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  executeProjectInstructionReadRules,
  pendingProjectInstructionRuleBatches,
  projectInstructionToolHookInput,
} from "./project-instruction-delivery-fixture.ts";

const temporaryDirectories: string[] = [];
const repositoryAgentsPath = join(import.meta.dirname, "../../../AGENTS.md");

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("production project-instruction routing", () => {
  it.each([
    ["release version 5.0.1", ["Version Bump", "Changelog", "Releasing"]],
    [
      "run npm test",
      ["Commands", "Test Quality & Adversarial Review", "Testing and Smoke Verification of p CLI & Features"],
    ],
    ["update dependencies", ["Dependency and Install Security"]],
    ["deploy production", ["Releasing", "Universal Delivery Baseline (v1)"]],
    ["summarize the work and finish", ["Durable Learning Capture", "Mandatory Learning Log"]],
    ["create_pull_request", ["Issues and PRs"]],
    ["start work in this repository", ["Universal Delivery Baseline (v1)"]],
  ])("keeps required real AGENTS modules relevant for %s", (query, requiredTitles) => {
    const rules = createProductionRules(readFileSync(repositoryAgentsPath, "utf8"), repositoryAgentsPath);
    const selectedTitles = selectProjectInstructionRuleLinks(rules, query).map(
      (link) => rules.find((rule) => rule.link === link)?.title,
    );

    expect(selectedTitles.length).toBeGreaterThanOrEqual(1);
    expect(selectedTitles.length).toBeLessThanOrEqual(3);
    expect(selectedTitles).toEqual(expect.arrayContaining(requiredTitles));
  });

  it("reserves the first mutation for code rules without routing generic fixture tests to P CLI smoke", async () => {
    const workspace = createProductionWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-inventory-routing"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: async (request) => compileSparseOmission(request),
      taskVerificationMode: "off",
    });
    try {
      session._createRuntimeContextPrompts(
        [
          "Implement the complete production-quality event-sourced inventory engine described in README.md.",
          "Read every provided file first. Preserve README.md, package.json, tsconfig.json, and the contract test exactly.",
          "Keep event-log storage in src/store.ts, domain behavior in src/engine.ts, and exports in src/index.ts.",
          "Pay particular attention to exact idempotency, atomic multi-SKU rollback, optimistic concurrency within batches, deep immutability, deterministic hash-chained JSONL, rigorous replay validation, and continuation after restore.",
          "Add substantial meaningful tests of your own. Use only Node built-ins and the existing toolchain; do not install dependencies.",
          "Run npm test and npm run typecheck until both pass.",
        ].join(" "),
        session.systemPrompt,
      );
      const blocked = await session.agent.beforeToolCall?.(
        projectInstructionToolHookInput("bash", { command: "mkdir -p src test" }),
      );
      expect.soft(blocked).toMatchObject({ block: true, reason: expect.stringContaining("read_rules") });

      const [batch] = pendingProjectInstructionRuleBatches(session);
      expect.soft(batch).toBeDefined();
      const rules = session._projectInstructions.state.current?.manifest.rules ?? [];
      const selectedTitles = batch?.map((link) => rules.find((rule) => rule.link === link)?.title) ?? [];
      expect.soft(selectedTitles).toContain("Code Quality");
      expect.soft(selectedTitles).toContain("Test Quality & Adversarial Review");
      expect.soft(selectedTitles).not.toContain("Testing and Smoke Verification of p CLI & Features");
    } finally {
      session.dispose();
    }
  });

  it.each([
    ["git commit", ["Git"]],
    ['git commit -m "release benchmark install"', ["Git"]],
    ['env git -C /repo commit -m "release benchmark install"', ["Git"]],
    ["npm run release", ["Version Bump", "Changelog", "Releasing"]],
    ["npm --prefix install run release", ["Releasing"]],
    ["npm --loglevel install run release", ["Releasing"]],
  ])("permits %s after one bounded authoritative read", async (command, requiredTitles) => {
    const workspace = createProductionWorkspace();
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: async (request) => compileSparseOmission(request),
      taskVerificationMode: "off",
    });
    try {
      session._createRuntimeContextPrompts("zzqqvv", session.systemPrompt);
      const call = projectInstructionToolHookInput("bash", { command });
      const blocked = await session.agent.beforeToolCall?.(call);
      expect.soft(blocked).toMatchObject({ block: true, reason: expect.stringContaining("read_rules") });

      const pending = pendingProjectInstructionRuleBatches(session);
      expect.soft(pending).toHaveLength(1);
      const batch = pending[0];
      if (!batch) return;
      expect.soft(batch.length).toBeGreaterThanOrEqual(1);
      expect.soft(batch.length).toBeLessThanOrEqual(3);
      const rules = session._projectInstructions.state.current?.manifest.rules ?? [];
      const selectedTitles = batch.map((link) => rules.find((rule) => rule.link === link)?.title);
      expect.soft(selectedTitles).toEqual(expect.arrayContaining(requiredTitles));

      await executeProjectInstructionReadRules(session, batch);
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("bash", { command })),
      ).resolves.toBeUndefined();
    } finally {
      session.dispose();
    }
  });
});

function createProductionWorkspace(): { root: string; resourceLoader: ResourceLoader } {
  const root = mkdtempSync(join(tmpdir(), "p-project-production-routing-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  const agentsPath = join(root, "AGENTS.md");
  const content = readFileSync(repositoryAgentsPath, "utf8");
  writeFileSync(agentsPath, content);
  const runtime = createExtensionRuntime();
  return {
    root,
    resourceLoader: {
      getExtensions: () => ({ extensions: [], errors: [], runtime }),
      getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [{ path: agentsPath, content }] }),
      getSystemPrompt: () => undefined,
      getAppendSystemPrompt: () => [],
      extendResources: () => {},
      reload: async () => {},
    },
  };
}

function createProductionRules(content: string, sourcePath: string): ProjectInstructionRuleRecord[] {
  const modules = splitInstructionSources([{ path: sourcePath, content }]);
  const constraints = buildProjectInstructionConstraints(modules);
  const compilation = compileSparseOmission({ sources: [{ path: sourcePath, content }], modules, constraints });
  return modules.map((module) => ({
    id: module.id,
    link: module.link,
    file: module.link,
    title: module.title,
    trigger: compilation.triggers[module.id] ?? "",
    routable: constraints.some(
      (constraint) =>
        constraint.moduleId === module.id && compilation.classifications.constraints[constraint.id] === "routed",
    ),
    sourcePath,
    contentHash: "0".repeat(64),
  }));
}

function compileSparseOmission(request: ProjectInstructionCompilerRequest) {
  const constraintScopes: ProjectInstructionClassifications["constraints"] = Object.fromEntries(
    request.constraints.map((constraint) => [
      constraint.id,
      requiresConservativeAlwaysOn(constraint) ? "always-on" : "routed",
    ]),
  );
  const classifications: ProjectInstructionClassifications = {
    modules: Object.fromEntries(
      request.modules.map((module) => {
        const moduleConstraints = request.constraints.filter((constraint) => constraint.moduleId === module.id);
        return [
          module.id,
          moduleConstraints.length === 0 ||
          moduleConstraints.some((constraint) => constraintScopes[constraint.id] === "always-on")
            ? "always-on"
            : "routed",
        ];
      }),
    ),
    constraints: constraintScopes,
  };
  const result = materializeProjectInstructionCompilerResult(
    classifications,
    deriveProjectInstructionTriggers(classifications, request.modules, request.constraints),
    request.constraints,
  );
  return validateProjectInstructionCompilerResult(result, request.modules, request.constraints);
}
