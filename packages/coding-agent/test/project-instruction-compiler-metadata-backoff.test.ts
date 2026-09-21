import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, Model } from "@dst0/p-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import type { ModelRegistry } from "../src/core/model-registry.ts";
import { createSessionProjectInstructionController } from "../src/core/project-instructions/session-controller.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import type { SettingsManager } from "../src/core/settings-manager.ts";

const { completeSimpleMock } = vi.hoisted(() => ({ completeSimpleMock: vi.fn() }));
const temporaryDirectories: string[] = [];

vi.mock("@dst0/p-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dst0/p-ai")>();
  return { ...actual, completeSimple: completeSimpleMock };
});

interface CompilerMetadata {
  off: string | null;
  thinkingFormat?: "openai" | "qwen";
}

function compilerModel(metadata: CompilerMetadata): Model<"openai-completions"> {
  return {
    id: "shared-compiler-model",
    name: "Shared compiler model",
    api: "openai-completions",
    provider: "private-provider",
    baseUrl: "https://provider.invalid/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096,
    thinkingLevelMap: { off: metadata.off },
    ...(metadata.thinkingFormat ? { compat: { thinkingFormat: metadata.thinkingFormat } } : {}),
  };
}

function createFixture(): { root: string; resourceLoader: ResourceLoader } {
  const root = mkdtempSync(join(tmpdir(), "p-project-compiler-metadata-backoff-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  const agentsPath = join(root, "AGENTS.md");
  const content = Array.from(
    { length: 90 },
    (_, index) =>
      `## Test workflow ${index}\n\nWhen running test workflow ${index}, preserve its fixture. ${"Scoped detail. ".repeat(12)}\n`,
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

function compilerResponse(model: Model<"openai-completions">): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: '{"alwaysOn":[]}' }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 10,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 11,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

interface CompilerLifecycle {
  controller: Awaited<ReturnType<typeof createSessionProjectInstructionController>>;
  fixture: ReturnType<typeof createFixture>;
  getApiKeyAndHeaders: ReturnType<typeof vi.fn>;
  modelState: { current: Model<"openai-completions"> };
}

async function createCompilerLifecycle(
  initialModel: Model<"openai-completions">,
  providerBehavior: (
    model: Model<"openai-completions">,
  ) => AssistantMessage | Promise<AssistantMessage> = compilerResponse,
): Promise<CompilerLifecycle> {
  const fixture = createFixture();
  const modelState = { current: initialModel };
  const getApiKeyAndHeaders = vi.fn(async () => ({ ok: true as const, apiKey: "test-key" }));
  completeSimpleMock.mockImplementation(async () => providerBehavior(modelState.current));
  const controller = await createSessionProjectInstructionController({
    cwd: fixture.root,
    resourceLoader: fixture.resourceLoader,
    modelRegistry: { getApiKeyAndHeaders } as unknown as ModelRegistry,
    settingsManager: {
      getHttpIdleTimeoutMs: () => 0,
      getEnableInstallTelemetry: () => false,
    } as unknown as SettingsManager,
    getModel: () => modelState.current,
  });
  return { controller, fixture, getApiKeyAndHeaders, modelState };
}

function modelIdentity(model: Model<"openai-completions">): string {
  return `${model.provider}/${model.id}`;
}

beforeEach(() => completeSimpleMock.mockReset());
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("project instruction compiler metadata backoff", () => {
  it("does not fail closed when thinking-off metadata is incomplete", async () => {
    const lifecycle = await createCompilerLifecycle(compilerModel({ off: "none" }));
    expect(lifecycle.controller.state.current?.manifest).toMatchObject({ mode: "compiled", compilerStatus: "success" });
    expect(completeSimpleMock).toHaveBeenCalledOnce();

    const refreshed = await lifecycle.controller.refresh();

    expect(refreshed.manifest.mode).toBe("compiled");
    expect(completeSimpleMock).toHaveBeenCalledOnce();
    expect(lifecycle.getApiKeyAndHeaders).toHaveBeenCalledOnce();
  });

  it("recompiles when thinkingFormat changes while the off state stays constant", async () => {
    const initialModel = compilerModel({ off: "none" });
    const lifecycle = await createCompilerLifecycle(initialModel);
    expect(lifecycle.controller.state.current?.manifest.mode).toBe("compiled");
    expect(completeSimpleMock).toHaveBeenCalledOnce();

    const compatibleModel = compilerModel({ off: "none", thinkingFormat: "qwen" });
    expect(modelIdentity(compatibleModel)).toBe(modelIdentity(initialModel));
    expect(compatibleModel.thinkingLevelMap?.off).toBe(initialModel.thinkingLevelMap?.off);
    lifecycle.modelState.current = compatibleModel;
    const refreshed = await lifecycle.controller.refresh();

    expect(refreshed.manifest.mode).toBe("compiled");
    expect(completeSimpleMock).toHaveBeenCalledTimes(2);
  });

  it("does not fail closed when the model cannot disable thinking", async () => {
    const initialModel = compilerModel({ off: null, thinkingFormat: "qwen" });
    const lifecycle = await createCompilerLifecycle(initialModel);
    expect(lifecycle.controller.state.current?.manifest.mode).toBe("compiled");
    expect(completeSimpleMock).toHaveBeenCalledOnce();

    const compatibleModel = compilerModel({ off: "none", thinkingFormat: "qwen" });
    expect(modelIdentity(compatibleModel)).toBe(modelIdentity(initialModel));
    expect(compatibleModel.compat?.thinkingFormat).toBe(initialModel.compat?.thinkingFormat);
    lifecycle.modelState.current = compatibleModel;
    const refreshed = await lifecycle.controller.refresh();

    expect(refreshed.manifest.mode).toBe("compiled");
    expect(completeSimpleMock).toHaveBeenCalledTimes(2);
  });

  it("keeps provider identity stable while allowing thinking metadata to evolve", async () => {
    const initialModel = compilerModel({ off: "none", thinkingFormat: "openai" });
    const lifecycle = await createCompilerLifecycle(initialModel);
    expect(lifecycle.controller.state.current?.manifest.mode).toBe("compiled");
    expect(completeSimpleMock).toHaveBeenCalledOnce();

    const compatibleModel = compilerModel({ off: "disabled", thinkingFormat: "openai" });
    expect(modelIdentity(compatibleModel)).toBe(modelIdentity(initialModel));
    expect(compatibleModel.api).toBe(initialModel.api);
    expect(compatibleModel.reasoning).toBe(initialModel.reasoning);
    expect(compatibleModel.compat?.thinkingFormat).toBe(initialModel.compat?.thinkingFormat);
    lifecycle.modelState.current = compatibleModel;

    const refreshed = await lifecycle.controller.refresh();

    expect(refreshed.manifest.mode).toBe("compiled");
    expect(completeSimpleMock).toHaveBeenCalledTimes(2);
  });
});
