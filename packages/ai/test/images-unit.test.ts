import { describe, expect, it, vi } from "vitest";
import { getImageModel, getImageModels, getImageProviders } from "../src/image-models.ts";
import { generateImages } from "../src/images.ts";
import { getImagesApiProvider, registerImagesApiProvider } from "../src/images-api-registry.ts";
import type { AssistantImages, ImagesApi, ImagesContext, ImagesModel } from "../src/types.ts";

describe("Images Registry and Models Unit Tests", () => {
  it("getImageProviders returns array of provider names including openai and llm-orchestrator", () => {
    const providers = getImageProviders();
    expect(providers).toContain("openrouter");
    expect(providers).toContain("openai");
    expect(providers).toContain("llm-orchestrator");
  });

  it("getImageModels returns models for provider or empty array for unknown provider", () => {
    const openRouterModels = getImageModels("openrouter");
    expect(openRouterModels.length).toBeGreaterThan(0);
    const openaiModels = getImageModels("openai");
    expect(openaiModels.length).toBeGreaterThan(0);
    const llmOrcModels = getImageModels("llm-orchestrator");
    expect(llmOrcModels.length).toBeGreaterThan(0);
    const unknown = getImageModels("nonexistent" as any);
    expect(unknown).toEqual([]);
  });

  it("getImageModel retrieves a specific image model definition", () => {
    const model = getImageModel("openrouter", "google/gemini-2.5-flash-image");
    expect(model).toBeDefined();
    expect(model?.id).toBe("google/gemini-2.5-flash-image");
    expect(model?.provider).toBe("openrouter");

    const openaiModel = getImageModel("openai", "dall-e-3");
    expect(openaiModel).toBeDefined();
    expect(openaiModel?.id).toBe("dall-e-3");
    expect(openaiModel?.api).toBe("openai-images");

    const llmOrcModel = getImageModel("llm-orchestrator", "flux.1-dev");
    expect(llmOrcModel).toBeDefined();
    expect(llmOrcModel?.id).toBe("flux.1-dev");
    expect(llmOrcModel?.api).toBe("openai-images");
  });

  it("registers and retrieves custom images API provider", async () => {
    const mockGenerate = vi.fn(async (model: ImagesModel<any>, _context: ImagesContext): Promise<AssistantImages> => {
      return {
        api: model.api,
        provider: model.provider,
        model: model.id,
        output: [{ type: "text", text: "generated image mock" }],
        stopReason: "stop",
        timestamp: 1000,
      };
    });

    registerImagesApiProvider({
      api: "custom-test-images" as ImagesApi,
      generateImages: mockGenerate as any,
    });

    const provider = getImagesApiProvider("custom-test-images" as ImagesApi);
    expect(provider).toBeDefined();

    const mockModel: ImagesModel<any> = {
      id: "test-img-model",
      name: "Test Img Model",
      api: "custom-test-images" as ImagesApi,
      provider: "custom-provider" as any,
      baseUrl: "",
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      input: ["text"],
      output: ["image"],
    };

    const context: ImagesContext = {
      input: [{ type: "text", text: "draw something" }],
    };

    const res = await generateImages(mockModel, context);
    expect(res.stopReason).toBe("stop");
    expect(res.output).toEqual([{ type: "text", text: "generated image mock" }]);
    expect(mockGenerate).toHaveBeenCalled();
  });

  it("throws error when invoking generateImages with unregistered API", async () => {
    const mockModel: ImagesModel<any> = {
      id: "unregistered-model",
      name: "Unregistered",
      api: "unknown-images-api" as ImagesApi,
      provider: "unknown" as any,
      baseUrl: "",
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      input: ["text"],
      output: ["image"],
    };

    await expect(generateImages(mockModel, { input: [] })).rejects.toThrow("No API provider registered for api");
  });

  it("throws error when invoking wrapped provider with mismatched API", async () => {
    registerImagesApiProvider({
      api: "strict-api" as ImagesApi,
      generateImages: vi.fn() as any,
    });

    const provider = getImagesApiProvider("strict-api" as ImagesApi);
    expect(provider).toBeDefined();

    const wrongModel: ImagesModel<any> = {
      id: "wrong-model",
      name: "Wrong Model",
      api: "other-api" as ImagesApi,
      provider: "test" as any,
      baseUrl: "",
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      input: ["text"],
      output: ["image"],
    };

    expect(() => provider?.generateImages(wrongModel, { input: [] })).toThrow("Mismatched api");
  });
});
