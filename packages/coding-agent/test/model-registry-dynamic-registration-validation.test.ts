import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry, type ProviderConfigInput } from "../src/core/model-registry.ts";

const PROVIDER = "dynamic-validation";
const MODEL = "configured-model";

describe("ModelRegistry dynamic registration validation", () => {
  let tempDir: string;
  let modelsJsonPath: string;
  let authStorage: AuthStorage;

  beforeEach(() => {
    tempDir = join(tmpdir(), `p-dynamic-validation-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    modelsJsonPath = join(tempDir, "models.json");
    authStorage = AuthStorage.create(join(tempDir, "auth.json"));
    writeFileSync(
      modelsJsonPath,
      JSON.stringify({
        providers: {
          [PROVIDER]: {
            baseUrl: "https://configured.test/v1",
            apiKey: "configured-test-key",
            api: "openai-completions",
            models: [{ id: MODEL, reasoning: true, thinkingLevelMap: { off: "disabled" } }],
          },
        },
      }),
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects malformed model IDs before changing registry state", () => {
    for (const invalidId of [undefined, "", 42]) {
      const registry = ModelRegistry.create(authStorage, modelsJsonPath);
      registry.registerProvider(PROVIDER, {
        ...sparseRegistration(),
        headers: { "X-Provider-State": "preserved" },
        models: [
          {
            id: MODEL,
            headers: { "X-Model-State": "preserved" },
            reasoning: false,
          },
        ],
      });
      const before = registryState(registry);
      const malformed = {
        ...sparseRegistration(),
        models: [{ id: invalidId }],
      } as unknown as ProviderConfigInput;

      expect(() => registry.registerProvider(PROVIDER, malformed)).toThrow(/model id.*non-empty string/iu);
      expect(registryState(registry)).toEqual(before);
      registry.refresh();
      expect(registryState(registry)).toEqual(before);
    }
  });

  it("persists metadata mode until an explicit replacement resets it", () => {
    const registry = ModelRegistry.create(authStorage, modelsJsonPath);
    registry.registerProvider(PROVIDER, {
      ...sparseRegistration(),
      modelMetadata: "inherit-existing",
    });
    expect(registry.find(PROVIDER, MODEL)?.reasoning).toBe(true);

    registry.registerProvider(PROVIDER, {
      ...sparseRegistration(),
      modelMetadata: "replace",
    });
    expect(registry.find(PROVIDER, MODEL)?.reasoning).toBe(false);
    expect(registry.find(PROVIDER, MODEL)?.thinkingLevelMap).toBeUndefined();

    registry.registerProvider(PROVIDER, sparseRegistration());
    registry.refresh();
    expect(registry.find(PROVIDER, MODEL)?.reasoning).toBe(false);
    expect(registry.find(PROVIDER, MODEL)?.thinkingLevelMap).toBeUndefined();
  });
});

function sparseRegistration() {
  return {
    baseUrl: "https://dynamic.test/v1",
    apiKey: "dynamic-test-key",
    api: "openai-completions" as const,
    models: [{ id: MODEL }],
  };
}

function registryState(registry: ModelRegistry) {
  return structuredClone({
    models: registry.models,
    configuredModels: registry.configuredModels,
    registeredProviders: [...registry.registeredProviders],
    providerRequestConfigs: [...registry.providerRequestConfigs],
    modelRequestHeaders: [...registry.modelRequestHeaders],
    loadError: registry.loadError,
  });
}
