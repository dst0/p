import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@dst0/p-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry, type ProviderConfigInput } from "../src/core/model-registry.ts";
import { enforceProjectInstructionCompilerReasoningControl } from "../src/core/project-instructions/compiler-reasoning-control.ts";

const PROVIDER = "dynamic-discovery";
const COMPILER_MODEL = "qwen-compiler";

describe("ModelRegistry dynamic thinking metadata", () => {
  let tempDir: string;
  let modelsJsonPath: string;
  let authStorage: AuthStorage;

  beforeEach(() => {
    tempDir = join(tmpdir(), `p-dynamic-thinking-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    modelsJsonPath = join(tempDir, "models.json");
    authStorage = AuthStorage.create(join(tempDir, "auth.json"));
    writeStaticModels(modelsJsonPath);
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it("preserves configured compiler-control metadata when dynamic discovery omits it", () => {
    const registry = ModelRegistry.create(authStorage, modelsJsonPath);

    registry.registerProvider(PROVIDER, sparseRegistration());

    expect(providerModelIds(registry)).toEqual([COMPILER_MODEL]);
    assertConfiguredCompilerMetadata(registry);
  });

  it("treats an explicit empty discovered list as authoritative membership", () => {
    const registry = ModelRegistry.create(authStorage, modelsJsonPath);

    registry.registerProvider(PROVIDER, { models: [] });

    expect(providerModelIds(registry)).toEqual([]);
    registry.refresh();
    expect(providerModelIds(registry)).toEqual([]);
  });

  it("inherits omitted thinking metadata for an exact model and API across refresh", () => {
    const registry = ModelRegistry.create(authStorage, modelsJsonPath);

    registry.registerProvider(PROVIDER, {
      ...sparseRegistration(),
      modelMetadata: "inherit-existing",
      compat: {
        supportsDeveloperRole: true,
        supportsReasoningEffort: true,
        supportsUsageInStreaming: true,
      },
      models: [
        {
          id: COMPILER_MODEL,
          compat: { supportsUsageInStreaming: false },
        },
      ],
    });

    assertInheritedCompiler(registry);
    registry.refresh();
    assertInheritedCompiler(registry);
  });

  it("keeps persisted inheritance policy on later partial model registrations", () => {
    const registry = ModelRegistry.create(authStorage, modelsJsonPath);

    registry.registerProvider(PROVIDER, {
      ...sparseRegistration(),
      modelMetadata: "inherit-existing",
      compat: {
        supportsDeveloperRole: true,
        supportsReasoningEffort: true,
        supportsUsageInStreaming: true,
      },
      models: [
        {
          id: COMPILER_MODEL,
          compat: { supportsUsageInStreaming: false },
        },
      ],
    });
    assertInheritedCompiler(registry);

    registry.registerProvider(PROVIDER, sparseRegistration());

    assertInheritedCompiler(registry);
    registry.refresh();
    assertInheritedCompiler(registry);
  });

  it("preserves explicit dynamic metadata through later sparse registration and refresh", () => {
    const registry = ModelRegistry.create(authStorage, modelsJsonPath);

    registry.registerProvider(PROVIDER, {
      ...sparseRegistration(),
      modelMetadata: "inherit-existing",
      models: [
        {
          id: COMPILER_MODEL,
          reasoning: false,
          thinkingLevelMap: { off: null },
          compat: { thinkingFormat: "together" },
        },
      ],
    });
    assertExplicitDynamicMetadata(registry);

    registry.registerProvider(PROVIDER, sparseRegistration());

    assertExplicitDynamicMetadata(registry);
    registry.refresh();
    assertExplicitDynamicMetadata(registry);
  });

  it("re-inherits configured metadata when a discovered model returns after an empty list", () => {
    const registry = ModelRegistry.create(authStorage, modelsJsonPath);

    registry.registerProvider(PROVIDER, {
      ...sparseRegistration(),
      modelMetadata: "inherit-existing",
    });
    assertConfiguredCompilerMetadata(registry);

    registry.registerProvider(PROVIDER, { models: [] });
    expect(providerModelIds(registry)).toEqual([]);

    registry.registerProvider(PROVIDER, sparseRegistration());
    assertConfiguredCompilerMetadata(registry);
    registry.refresh();
    assertConfiguredCompilerMetadata(registry);
  });

  it("lets explicit reasoning, thinking-map nulls, and model compat override inherited metadata", () => {
    const registry = ModelRegistry.create(authStorage, modelsJsonPath);

    registry.registerProvider(PROVIDER, {
      ...sparseRegistration(),
      modelMetadata: "inherit-existing",
      models: [
        {
          id: COMPILER_MODEL,
          reasoning: false,
          thinkingLevelMap: { off: null },
          compat: { thinkingFormat: "together" },
        },
      ],
    });

    const model = requireCompilerModel(registry);
    expect(model.reasoning).toBe(false);
    expect(model.thinkingLevelMap).toEqual({ off: null, high: "enabled" });
    expect(model.compat).toMatchObject({
      supportsDeveloperRole: false,
      supportsUsageInStreaming: true,
      thinkingFormat: "together",
    });
  });

  it("does not inherit metadata when a matching ID changes API", () => {
    const registry = ModelRegistry.create(authStorage, modelsJsonPath);

    registry.registerProvider(PROVIDER, {
      ...sparseRegistration(),
      api: "anthropic-messages",
      modelMetadata: "inherit-existing",
    });

    const model = requireCompilerModel(registry);
    expect(model.api).toBe("anthropic-messages");
    expect(model.reasoning).toBe(false);
    expect(model.thinkingLevelMap).toBeUndefined();
    expect(model.compat).toBeUndefined();
  });

  it("rejects unknown metadata modes", () => {
    const registry = ModelRegistry.create(authStorage, modelsJsonPath);
    const config = {
      ...sparseRegistration(),
      modelMetadata: "merge",
    } as unknown as ProviderConfigInput;

    expect(() => registry.registerProvider(PROVIDER, config)).toThrow(/modelMetadata/u);
  });
});

function sparseRegistration() {
  return {
    baseUrl: "https://dynamic.test/v1",
    apiKey: "dynamic-test-key",
    api: "openai-completions" as const,
    models: [{ id: COMPILER_MODEL }],
  };
}

function writeStaticModels(modelsJsonPath: string): void {
  writeFileSync(
    modelsJsonPath,
    JSON.stringify({
      providers: {
        [PROVIDER]: {
          baseUrl: "https://static.test/v1",
          apiKey: "static-test-key",
          api: "openai-completions",
          compat: { supportsDeveloperRole: false },
          models: [
            {
              id: COMPILER_MODEL,
              reasoning: true,
              thinkingLevelMap: { off: "disabled", high: "enabled" },
              compat: {
                thinkingFormat: "qwen-chat-template",
                supportsUsageInStreaming: true,
              },
            },
            { id: "not-discovered" },
          ],
        },
      },
    }),
  );
}

function requireCompilerModel(registry: ModelRegistry): Model<"openai-completions"> {
  const model = registry.find(PROVIDER, COMPILER_MODEL);
  expect(model).toBeDefined();
  return model as Model<"openai-completions">;
}

function providerModelIds(registry: ModelRegistry): string[] {
  return registry
    .getAll()
    .filter((model) => model.provider === PROVIDER)
    .map((model) => model.id);
}

function assertInheritedCompiler(registry: ModelRegistry): void {
  const model = requireCompilerModel(registry);
  expect(providerModelIds(registry)).toEqual([COMPILER_MODEL]);
  expect(model.baseUrl).toBe("https://dynamic.test/v1");
  expect(model.reasoning).toBe(true);
  expect(model.thinkingLevelMap).toEqual({ off: "disabled", high: "enabled" });
  expect(model.compat).toMatchObject({
    supportsDeveloperRole: true,
    supportsReasoningEffort: true,
    supportsUsageInStreaming: false,
    thinkingFormat: "qwen-chat-template",
  });
  expect(enforceProjectInstructionCompilerReasoningControl(model)).toBe(model);
}

function assertExplicitDynamicMetadata(registry: ModelRegistry): void {
  const model = requireCompilerModel(registry);
  expect(model.reasoning).toBe(false);
  expect(model.thinkingLevelMap).toEqual({ off: null, high: "enabled" });
  expect(model.compat).toMatchObject({
    supportsDeveloperRole: false,
    supportsUsageInStreaming: true,
    thinkingFormat: "together",
  });
}

function assertConfiguredCompilerMetadata(registry: ModelRegistry): void {
  const model = requireCompilerModel(registry);
  expect(model.reasoning).toBe(true);
  expect(model.thinkingLevelMap).toEqual({ off: "disabled", high: "enabled" });
  expect(model.compat).toMatchObject({
    supportsDeveloperRole: false,
    supportsUsageInStreaming: true,
    thinkingFormat: "qwen-chat-template",
  });
  expect(enforceProjectInstructionCompilerReasoningControl(model)).toBe(model);
}
