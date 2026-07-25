import { describe, expect, it, vi } from "vitest";
import { getImagesApiProvider, registerImagesApiProvider } from "../src/images-api-registry.ts";
import type { AssistantImages, ImagesApi, ImagesContext, ImagesFunction, ImagesModel } from "../src/types.ts";

function createImagesModel(api: ImagesApi): ImagesModel<ImagesApi> {
  return {
    id: `${api}-model`,
    name: `${api} model`,
    api,
    provider: "test-provider",
    baseUrl: "https://example.test",
    input: ["text"],
    output: ["image"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
  };
}

function createImagesResult(api: ImagesApi): AssistantImages {
  return {
    api,
    provider: "test-provider",
    model: `${api}-model`,
    output: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
    stopReason: "stop",
    timestamp: 1,
  };
}

describe("images API provider registry", () => {
  it("delegates image generation with the typed model, context, and options", async () => {
    const generateImages = vi.fn<ImagesFunction<ImagesApi>>(async (model) => createImagesResult(model.api));
    const model = createImagesModel("custom-images-api");
    const context: ImagesContext = { input: [{ type: "text", text: "draw a cat" }] };
    registerImagesApiProvider(
      {
        api: "custom-images-api",
        generateImages,
      },
      "source-1",
    );

    const provider = getImagesApiProvider("custom-images-api");
    expect(provider).toBeDefined();
    if (!provider) throw new Error("Expected the images API provider to be registered");

    await expect(provider.generateImages(model, context, { maxRetries: 2 })).resolves.toEqual(
      createImagesResult("custom-images-api"),
    );
    expect(generateImages).toHaveBeenCalledExactlyOnceWith(model, context, { maxRetries: 2 });
  });

  it("rejects mismatched models before invoking image generation", () => {
    const generateImages = vi.fn<ImagesFunction<ImagesApi>>(async (model) => createImagesResult(model.api));
    registerImagesApiProvider({
      api: "expected-images-api",
      generateImages,
    });
    const provider = getImagesApiProvider("expected-images-api");
    expect(provider).toBeDefined();
    if (!provider) throw new Error("Expected the images API provider to be registered");

    expect(() => provider.generateImages(createImagesModel("different-images-api"), { input: [] })).toThrow(
      "Mismatched api: different-images-api expected expected-images-api",
    );
    expect(generateImages).not.toHaveBeenCalled();
  });
});
