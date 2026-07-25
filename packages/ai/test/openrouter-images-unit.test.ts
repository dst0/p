import { describe, expect, it } from "vitest";
import { generateImagesOpenRouter } from "../src/providers/images/openrouter.ts";
import type { ImagesContext, ImagesModel } from "../src/types.ts";

describe("openrouter-images-unit", () => {
  const dummyModel: ImagesModel<"openrouter-images"> = {
    id: "google/imagen-3",
    name: "Imagen 3",
    api: "openrouter-images",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    input: ["text", "image"],
    output: ["image", "text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };

  it("returns error stopReason when apiKey is missing", async () => {
    const context: ImagesContext = { input: [{ type: "text", text: "draw cat" }] };
    const res = await generateImagesOpenRouter(dummyModel, context, {});
    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toBe("No API key for provider: openrouter");
  });

  it("handles image input in context and onPayload hook", async () => {
    const context: ImagesContext = {
      input: [
        { type: "text", text: "edit image" },
        { type: "image", mimeType: "image/png", data: "base64data" },
      ],
    };

    let payloadReceived = false;
    const res = await generateImagesOpenRouter(dummyModel, context, {
      apiKey: "dummy-key",
      onPayload: async (params) => {
        payloadReceived = true;
        return params;
      },
    });

    expect(payloadReceived).toBe(true);
    // Since fetch/client creation with dummy key to fake endpoint fails network, stopReason should be error
    expect(res.stopReason).toBe("error");
  });
});
