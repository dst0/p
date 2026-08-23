import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@dst0/p-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import type { ProjectInstructionCompiler } from "../src/core/project-instructions/index.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

const temporaryDirectories: string[] = [];

function createWorkspace(ruleCount = 90): { root: string; resourceLoader: ResourceLoader } {
  const root = mkdtempSync(join(tmpdir(), "p-sdk-compiler-identity-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  const agentsPath = join(root, "AGENTS.md");
  const content = Array.from(
    { length: ruleCount },
    (_, index) => `## Rule ${index}\n\nFor rule ${index} work, preserve identity evidence. ${"detail ".repeat(12)}\n`,
  ).join("");
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

function createModel(id: string): Model<Api> {
  return {
    id,
    name: id,
    api: "anthropic-messages",
    provider: "test-provider",
    baseUrl: "https://provider.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096,
  };
}

function createCompiler(): ProjectInstructionCompiler {
  return vi.fn(async (request) => createProjectInstructionCompilation(request));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("SDK project instruction compiler identity", () => {
  it("isolates anonymous custom compilers while allowing explicit stable cache reuse", async () => {
    const workspace = createWorkspace();
    let sessionNumber = 0;
    const create = async (compiler: ProjectInstructionCompiler, identity?: string) =>
      createAgentSession({
        cwd: workspace.root,
        agentDir: join(workspace.root, `.agent-${++sessionNumber}`),
        resourceLoader: workspace.resourceLoader,
        sessionManager: SessionManager.inMemory(workspace.root),
        projectInstructionCompiler: compiler,
        projectInstructionCompilerIdentity: identity,
      });

    const firstAnonymous = createCompiler();
    const first = await create(firstAnonymous);
    first.session.dispose();
    const secondAnonymous = createCompiler();
    const second = await create(secondAnonymous);
    second.session.dispose();
    expect(firstAnonymous).toHaveBeenCalledOnce();
    expect(secondAnonymous).toHaveBeenCalledOnce();

    const firstStable = createCompiler();
    const third = await create(firstStable, "test/stable-compiler");
    third.session.dispose();
    const secondStable = createCompiler();
    const fourth = await create(secondStable, "test/stable-compiler");
    fourth.session.dispose();
    expect(firstStable).toHaveBeenCalledOnce();
    expect(secondStable).not.toHaveBeenCalled();
  });

  it("fails closed when an explicit compiler model is unavailable", async () => {
    const workspace = createWorkspace();

    await expect(
      createAgentSession({
        cwd: workspace.root,
        agentDir: join(workspace.root, ".agent-missing-compiler"),
        resourceLoader: workspace.resourceLoader,
        sessionManager: SessionManager.inMemory(workspace.root),
        projectInstructionCompilerModel: "missing-provider/missing-model",
      }),
    ).rejects.toThrow(
      'Project instruction compiler model "missing-provider/missing-model" is unavailable; use provider/id from --list-models',
    );
  });

  it("fails closed when an explicit compiler model is not provider/id", async () => {
    const workspace = createWorkspace(1);

    await expect(
      createAgentSession({
        cwd: workspace.root,
        agentDir: join(workspace.root, ".agent-invalid-compiler"),
        resourceLoader: workspace.resourceLoader,
        sessionManager: SessionManager.inMemory(workspace.root),
        projectInstructionCompilerModel: "missing-provider",
      }),
    ).rejects.toThrow("Project instruction compiler model must use exact provider/id syntax");
  });

  it("fails closed when an explicit compiler model has no authentication", async () => {
    const workspace = createWorkspace(1);
    const compilerModel = createModel("compiler");
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    modelRegistry.models = [compilerModel];

    await expect(
      createAgentSession({
        cwd: workspace.root,
        agentDir: join(workspace.root, ".agent-unauthenticated-compiler"),
        authStorage,
        modelRegistry,
        resourceLoader: workspace.resourceLoader,
        sessionManager: SessionManager.inMemory(workspace.root),
        projectInstructionCompilerModel: `${compilerModel.provider}/${compilerModel.id}`,
      }),
    ).rejects.toThrow(
      `Project instruction compiler model "${compilerModel.provider}/${compilerModel.id}" has no configured authentication`,
    );
  });

  it("rejects ambiguous custom-compiler and compiler-model configuration", async () => {
    const workspace = createWorkspace();

    await expect(
      createAgentSession({
        cwd: workspace.root,
        agentDir: join(workspace.root, ".agent-ambiguous-compiler"),
        resourceLoader: workspace.resourceLoader,
        sessionManager: SessionManager.inMemory(workspace.root),
        projectInstructionCompiler: createCompiler(),
        projectInstructionCompilerIdentity: "custom/compiler",
        projectInstructionCompilerModel: "provider/model",
      }),
    ).rejects.toThrow("projectInstructionCompilerModel cannot be combined with projectInstructionCompiler");
  });

  it("restores an explicit compiler model independently of the resumed task model", async () => {
    const workspace = createWorkspace(1);
    const compilerModel = createModel("compiler");
    const firstTaskModel = createModel("task-one");
    const secondTaskModel = createModel("task-two");
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(compilerModel.provider, "test-key");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    modelRegistry.models = [compilerModel, firstTaskModel, secondTaskModel];
    const sessionManager = SessionManager.inMemory(workspace.root);
    const common = {
      cwd: workspace.root,
      resourceLoader: workspace.resourceLoader,
      sessionManager,
      authStorage,
      modelRegistry,
      completionMode: "implicit" as const,
    };

    const first = await createAgentSession({
      ...common,
      model: firstTaskModel,
      projectInstructionCompilerModel: `${compilerModel.provider}/${compilerModel.id}`,
    });
    const compiledInputHash = first.session._projectInstructions.state.current?.manifest.inputHash;
    first.session.dispose();

    const resumed = await createAgentSession({ ...common, model: secondTaskModel });
    expect(resumed.session.model).toBe(secondTaskModel);
    expect(resumed.session._projectInstructions.state.current?.manifest.inputHash).toBe(compiledInputHash);
    resumed.session.dispose();
  });
});
