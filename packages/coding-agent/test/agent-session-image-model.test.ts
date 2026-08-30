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

    const openaiModel = getImageModel("openai", "dall-e-3");
    expect(openaiModel).toBeDefined();

    do_setImageModel(fakeSession, openaiModel!);
    expect(do_getImageModel(fakeSession)).toBe(openaiModel);
  });

  it("resolves configured session image model with apiKey from modelRegistry", async () => {
    const openaiModel = getImageModel("openai", "dall-e-3")!;
    const fakeSession: any = {
      _imageModel: openaiModel,
      modelRegistry: {
        getApiKeyForProvider: async (provider: string) => (provider === "openai" ? "openai-secret-key" : undefined),
      },
      settingsManager: {
        getDefaultImageProvider: () => undefined,
        getDefaultImageModel: () => undefined,
      },
    };

    const resolved = await do_resolveImageModel(fakeSession);
    expect(resolved).toBeDefined();
    expect(resolved?.model.id).toBe("dall-e-3");
    expect(resolved?.model.provider).toBe("openai");
    expect(resolved?.apiKey).toBe("openai-secret-key");
  });

  it("resolves default provider and model from settingsManager", async () => {
    const fakeSession: any = {
      modelRegistry: {
        getApiKeyForProvider: async (provider: string) => (provider === "llm-orchestrator" ? "llm-orc-key" : undefined),
      },
      settingsManager: {
        getDefaultImageProvider: () => "llm-orchestrator",
        getDefaultImageModel: () => "dall-e-3",
      },
    };

    const resolved = await do_resolveImageModel(fakeSession);
    expect(resolved).toBeDefined();
    expect(resolved?.model.provider).toBe("llm-orchestrator");
    expect(resolved?.model.id).toBe("dall-e-3");
    expect(resolved?.apiKey).toBe("llm-orc-key");
  });

  it("resolves first available provider with credentials if no default is configured", async () => {
    const fakeSession: any = {
      modelRegistry: {
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
});
