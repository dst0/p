import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@dst0/p-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import type { ModelRegistry } from "../src/core/model-registry.ts";
import type * as ModelCompilerModule from "../src/core/project-instructions/model-compiler.ts";
import { createSessionProjectInstructionController } from "../src/core/project-instructions/session-controller.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import type { SettingsManager } from "../src/core/settings-manager.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

type CompileWithModel = typeof ModelCompilerModule.compileProjectInstructionsWithModel;

const modelCompilerMocks = vi.hoisted(() => ({
  compile: vi.fn<CompileWithModel>(),
}));

vi.mock("../src/core/project-instructions/model-compiler.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof ModelCompilerModule>();
  return { ...actual, compileProjectInstructionsWithModel: modelCompilerMocks.compile };
});

const temporaryDirectories: string[] = [];

function createModel(id: string): Model<Api> {
  return {
    id,
    name: id,
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://provider.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096,
  };
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "p-project-session-compiler-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  const agentsPath = join(root, "AGENTS.md");
  const content = Array.from(
    { length: 90 },
    (_, index) => `## Compiler rule ${index}\n\nPreserve compiler lifecycle ${index}. ${"detail ".repeat(12)}\n`,
  ).join("");
  writeFileSync(agentsPath, content);
  const runtime = createExtensionRuntime();
  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [{ path: agentsPath, content }] }),
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
  return { root, resourceLoader };
}

beforeEach(() => {
  modelCompilerMocks.compile.mockReset();
  modelCompilerMocks.compile.mockImplementation(async (request) =>
    createProjectInstructionCompilation(
      request,
      Object.fromEntries(request.modules.map((module) => [module.id, `When ${module.title} applies`])),
    ),
  );
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("default project instruction compiler lifecycle", () => {
  it("recovers from no model and failed auth when a different authenticated model becomes available", async () => {
    const fixture = createFixture();
    let model: Model<Api> | undefined;
    const getApiKeyAndHeaders = vi.fn(async (requested: Model<Api>) =>
      requested.id === "working"
        ? { ok: true as const, apiKey: "test-api-key", headers: { "x-test": "present" } }
        : { ok: false as const, error: "No model auth" },
    );
    const modelRegistry = { getApiKeyAndHeaders } as unknown as ModelRegistry;
    const settingsManager = {
      getHttpIdleTimeoutMs: () => 0,
      getEnableInstallTelemetry: () => false,
    } as unknown as SettingsManager;
    const controller = await createSessionProjectInstructionController({
      cwd: fixture.root,
      resourceLoader: fixture.resourceLoader,
      modelRegistry,
      settingsManager,
      getModel: () => model,
    });

    expect(controller.state.current?.manifest.mode).toBe("fallback");
    expect(modelCompilerMocks.compile).not.toHaveBeenCalled();

    model = createModel("unauthenticated");
    expect((await controller.refresh()).manifest.mode).toBe("fallback");
    expect(modelCompilerMocks.compile).not.toHaveBeenCalled();

    model = createModel("working");
    expect((await controller.refresh()).manifest.mode).toBe("compiled");
    expect(modelCompilerMocks.compile).toHaveBeenCalledOnce();
    expect(modelCompilerMocks.compile.mock.calls[0][1]).toMatchObject({
      model,
      apiKey: "test-api-key",
      headers: { "x-test": "present" },
      timeoutMs: 60_000,
    });
  });

  it("keeps an explicit compiler model pinned across task-model switches", async () => {
    const fixture = createFixture();
    const compilerModel = createModel("compiler");
    let taskModel: Model<Api> | undefined = createModel("task-one");
    const getApiKeyAndHeaders = vi.fn(async () => ({
      ok: true as const,
      apiKey: "compiler-key",
      headers: { "x-compiler": "dedicated" },
    }));
    const controller = await createSessionProjectInstructionController({
      cwd: fixture.root,
      resourceLoader: fixture.resourceLoader,
      modelRegistry: { getApiKeyAndHeaders } as unknown as ModelRegistry,
      settingsManager: {
        getHttpIdleTimeoutMs: () => 0,
        getEnableInstallTelemetry: () => false,
      } as unknown as SettingsManager,
      getModel: () => taskModel,
      compilerModel,
    });

    const initialHash = controller.state.current?.manifest.inputHash;
    taskModel = createModel("task-two");
    rmSync(join(fixture.root, ".pdev"), { recursive: true, force: true });
    const refreshed = await controller.refresh();

    expect(refreshed.manifest.inputHash).toBe(initialHash);
    expect(getApiKeyAndHeaders).toHaveBeenNthCalledWith(1, compilerModel);
    expect(getApiKeyAndHeaders).toHaveBeenNthCalledWith(2, compilerModel);
    expect(modelCompilerMocks.compile).toHaveBeenCalledTimes(2);
    expect(modelCompilerMocks.compile.mock.calls.map((call) => call[1].model.id)).toEqual(["compiler", "compiler"]);
  });
});
