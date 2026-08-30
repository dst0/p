import { getImageModel } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import {
  do_getImageModel,
  do_resolveImageModel,
  do_setImageModel,
} from "../src/core/agent-session/agentsession-methods/model-resolution.ts";

describe("AgentSession Image Model Resolution", () => {
  it("gets and sets image model on session", () => {
    const fakeSession: any = {};
    expect(do_getImageModel(fakeSession)).toBeUndefined();

    const openaiModel = getImageModel("openai", "gpt-image-2");
    expect(openaiModel).toBeDefined();

    do_setImageModel(fakeSession, openaiModel!);
    expect(do_getImageModel(fakeSession)).toBe(openaiModel);
  });

  it("resolves configured session image model with apiKey from modelRegistry", async () => {
    const openaiModel = getImageModel("openai", "gpt-image-2")!;
    const fakeSession: any = {
      _imageModel: openaiModel,
      modelRegistry: {
        getAll: () => [],
        getApiKeyForProvider: async (provider: string) => (provider === "openai" ? "openai-secret-key" : undefined),
      },
      settingsManager: {
        getDefaultImageProvider: () => undefined,
        getDefaultImageModel: () => undefined,
      },
    };

    const resolved = await do_resolveImageModel(fakeSession);
    expect(resolved).toBeDefined();
    expect(resolved?.model.id).toBe("gpt-image-2");
    expect(resolved?.model.provider).toBe("openai");
    expect(resolved?.apiKey).toBe("openai-secret-key");
  });

  it("resolves default provider and model from settingsManager", async () => {
    const fakeSession: any = {
      modelRegistry: {
        getAll: () => [],
        getApiKeyForProvider: async (provider: string) => (provider === "llm-orchestrator" ? "llm-orc-key" : undefined),
      },
      settingsManager: {
        getDefaultImageProvider: () => "llm-orchestrator",
        getDefaultImageModel: () => "flux2-klein-4b",
      },
    };

    const resolved = await do_resolveImageModel(fakeSession);
    expect(resolved).toBeDefined();
    expect(resolved?.model.provider).toBe("llm-orchestrator");
    expect(resolved?.model.id).toBe("flux2-klein-4b");
    expect(resolved?.apiKey).toBe("llm-orc-key");
  });

  it("reuses a configured OpenAI-compatible provider for llm-orchestrator image requests", async () => {
    const configuredProviderModel = {
      id: "mini-pc/sokann-qwen-27b-cache",
      name: "Mini PC text model",
      api: "openai-completions",
      provider: "mini-pc-11450",
      baseUrl: "https://192.168.8.167:11450/v1",
      input: ["text"],
      output: ["text"],
      contextWindow: 32_768,
      maxTokens: 8_192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const fakeSession: any = {
      modelRegistry: {
        getAll: () => [configuredProviderModel],
        getApiKeyAndHeaders: async () => ({
          ok: true,
          apiKey: "orchestrator-secret",
          headers: { "x-orchestrator-client": "p" },
        }),
        getApiKeyForProvider: async () => undefined,
      },
      settingsManager: {
        getDefaultImageProvider: () => "mini-pc-11450",
        getDefaultImageModel: () => "flux2-klein-4b",
      },
    };

    const resolved = await do_resolveImageModel(fakeSession);

    expect(resolved?.model).toMatchObject({
      provider: "mini-pc-11450",
      id: "flux2-klein-4b",
      api: "openai-images",
      baseUrl: "https://192.168.8.167:11450/v1",
    });
    expect(resolved?.apiKey).toBe("orchestrator-secret");
    expect(resolved?.headers).toEqual({ "x-orchestrator-client": "p" });
  });

  it("resolves first available provider with credentials if no default is configured", async () => {
    const fakeSession: any = {
      modelRegistry: {
        getAll: () => [],
        getApiKeyForProvider: async (provider: string) => (provider === "openai" ? "openai-key" : undefined),
      },
      settingsManager: {
        getDefaultImageProvider: () => undefined,
        getDefaultImageModel: () => undefined,
      },
    };

    const resolved = await do_resolveImageModel(fakeSession);
    expect(resolved).toBeDefined();
    expect(resolved?.model.provider).toBe("openai");
    expect(resolved?.apiKey).toBe("openai-key");
  });

  it("returns undefined when no image model or provider credential is available", async () => {
    const resolved = await do_resolveImageModel({
      modelRegistry: {
        getAll: () => [],
        getApiKeyForProvider: async () => undefined,
      },
      settingsManager: {
        getDefaultImageProvider: () => undefined,
        getDefaultImageModel: () => undefined,
      },
    } as never);
    expect(resolved).toBeUndefined();
  });
});
