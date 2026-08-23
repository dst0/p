import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeState = vi.hoisted(() => ({
  buildResult: undefined as unknown,
  created: undefined as unknown,
  hasTrustResources: true,
  runtimeSettings: undefined as unknown,
  services: undefined as unknown,
}));

const serviceMocks = vi.hoisted(() => ({
  buildSessionOptions: vi.fn(),
  collectSettingsDiagnostics: vi.fn(() => [{ type: "warning", message: "settings" }]),
  createAgentSessionFromServices: vi.fn(),
  createAgentSessionServices: vi.fn(
    async (options: {
      resourceLoaderReloadOptions?: {
        resolveProjectTrust: (value: { extensionsResult: object }) => Promise<boolean>;
      };
    }) => {
      await options.resourceLoaderReloadOptions?.resolveProjectTrust({ extensionsResult: {} });
      return runtimeState.services;
    },
  ),
  createProjectTrustContext: vi.fn(() => ({ source: "created" })),
  hasTrustRequiringProjectResources: vi.fn(() => runtimeState.hasTrustResources),
  resolveModelScope: vi.fn(async () => [{ model: "scoped" }]),
  resolveProjectTrusted: vi.fn(async (options: { onExtensionError: (message: string) => void }) => {
    options.onExtensionError("extension warning");
    return true;
  }),
  settingsCreate: vi.fn(() => runtimeState.runtimeSettings),
}));

vi.mock("../src/cli/project-trust.ts", () => ({
  createProjectTrustContext: serviceMocks.createProjectTrustContext,
}));
vi.mock("../src/core/agent-session-services.ts", () => ({
  createAgentSessionFromServices: serviceMocks.createAgentSessionFromServices,
  createAgentSessionServices: serviceMocks.createAgentSessionServices,
}));
vi.mock("../src/core/model-resolver.ts", () => ({ resolveModelScope: serviceMocks.resolveModelScope }));
vi.mock("../src/core/project-trust.ts", () => ({ resolveProjectTrusted: serviceMocks.resolveProjectTrusted }));
vi.mock("../src/core/settings-manager.ts", () => ({
  SettingsManager: { create: serviceMocks.settingsCreate },
}));
vi.mock("../src/core/trust-manager.ts", () => ({
  hasTrustRequiringProjectResources: serviceMocks.hasTrustRequiringProjectResources,
}));
vi.mock("../src/main/cli-entry.ts", () => ({ collectSettingsDiagnostics: serviceMocks.collectSettingsDiagnostics }));
vi.mock("../src/main/runtime-init.ts", () => ({ buildSessionOptions: serviceMocks.buildSessionOptions }));

import { createCliRuntimeFactory } from "../src/main/runtime-factory.ts";

function createParsed() {
  return {
    apiKey: "runtime-key",
    appendSystemPrompt: undefined,
    models: ["provider/model"],
    noContextFiles: false,
    noExtensions: false,
    noPromptTemplates: false,
    noSkills: false,
    noThemes: false,
    projectTrustOverride: undefined,
    systemPrompt: undefined,
    thinking: "high",
    unknownFlags: new Map(),
  };
}

function createOptions() {
  return {
    agentDir: "/agent",
    appMode: "interactive",
    authStorage: { setRuntimeApiKey: vi.fn() },
    extensionFactories: [],
    parsed: createParsed(),
    resolvedExtensionPaths: ["extension"],
    resolvedPromptTemplatePaths: ["prompt"],
    resolvedSkillPaths: ["skill"],
    resolvedThemePaths: ["theme"],
    startupSettingsManager: { getDefaultProjectTrust: vi.fn(() => "ask") },
    trustPromptMode: "interactive",
    trustStore: { get: vi.fn(() => false) },
  };
}

function createSessionManager(messageCount = 0) {
  return {
    buildSessionContext: vi.fn(() => ({ messages: Array.from({ length: messageCount }, () => ({})) })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  runtimeState.hasTrustResources = true;
  runtimeState.runtimeSettings = {
    getEnabledModels: vi.fn(() => ["fallback/model"]),
  };
  runtimeState.services = {
    diagnostics: [{ type: "warning", message: "service" }],
    modelRegistry: { name: "registry" },
    resourceLoader: { getExtensions: vi.fn(() => ({ errors: [{ path: "broken", error: "bad" }] })) },
    settingsManager: runtimeState.runtimeSettings,
  };
  runtimeState.buildResult = {
    cliThinkingFromModel: true,
    diagnostics: [{ type: "warning", message: "session options" }],
    options: {
      completionLimits: undefined,
      completionMode: "normal",
      customTools: [],
      excludeTools: [],
      maxTokens: 100,
      model: { provider: "provider" },
      noTools: false,
      projectInstructionCompilerModel: "compiler-provider/compiler-model",
      scopedModels: [],
      thinkingLevel: "high",
      tools: [],
      userInputTools: [],
    },
  };
  runtimeState.created = {
    session: { model: { provider: "provider" }, thinkingLevel: "high", setThinkingLevel: vi.fn() },
  };
  serviceMocks.buildSessionOptions.mockImplementation(() => runtimeState.buildResult);
  serviceMocks.createAgentSessionFromServices.mockImplementation(async () => runtimeState.created);
});

describe("CLI runtime factory", () => {
  it("resolves uncached project trust and assembles runtime diagnostics", async () => {
    const options = createOptions();
    const factory = createCliRuntimeFactory(options as never);
    const result = await factory({
      cwd: "/project",
      agentDir: "/agent",
      sessionManager: createSessionManager(1),
      sessionStartEvent: undefined,
      projectTrustContext: undefined,
    } as never);

    expect(serviceMocks.resolveProjectTrusted).toHaveBeenCalled();
    expect(serviceMocks.createProjectTrustContext).toHaveBeenCalledWith(expect.objectContaining({ hasUI: true }));
    expect(serviceMocks.resolveModelScope).toHaveBeenCalledWith(["provider/model"], expect.anything());
    expect(options.authStorage.setRuntimeApiKey).toHaveBeenCalledWith("provider", "runtime-key");
    expect(serviceMocks.createAgentSessionFromServices).toHaveBeenCalledWith(
      expect.objectContaining({ projectInstructionCompilerModel: "compiler-provider/compiler-model" }),
    );
    expect(
      (runtimeState.created as { session: { setThinkingLevel: ReturnType<typeof vi.fn> } }).session.setThinkingLevel,
    ).toHaveBeenCalledWith("high");
    expect(result.diagnostics.map((entry) => entry.message)).toEqual([
      "extension warning",
      "service",
      "settings",
      'Failed to load extension "broken": bad',
      "session options",
    ]);

    await factory({
      cwd: "/project",
      agentDir: "/agent",
      sessionManager: createSessionManager(),
      sessionStartEvent: { type: "session_start", reason: "resume" },
      projectTrustContext: { source: "provided" },
    } as never);
    expect(serviceMocks.resolveProjectTrusted).toHaveBeenCalledTimes(1);
  });

  it("reports an API key without a model and trusts projects without resources", async () => {
    runtimeState.hasTrustResources = false;
    runtimeState.buildResult = {
      cliThinkingFromModel: false,
      diagnostics: [],
      options: { model: undefined },
    };
    const options = createOptions();
    options.parsed.models = [];
    const result = await createCliRuntimeFactory(options as never)({
      cwd: "/plain",
      agentDir: "/agent",
      sessionManager: createSessionManager(),
      sessionStartEvent: undefined,
      projectTrustContext: undefined,
    } as never);
    expect(result.diagnostics).toContainEqual({
      type: "error",
      message: "--api-key requires a model to be specified via --model, --provider/--model, or --models",
    });
    expect(serviceMocks.settingsCreate).toHaveBeenCalledWith("/plain", "/agent", { projectTrusted: true });
  });
});
