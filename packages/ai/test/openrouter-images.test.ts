import { beforeEach, describe, expect, it } from "vitest";
import { generateImages } from "../src/images.ts";
import type { ImagesContext, ImagesModel } from "../src/types.ts";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const mockState = {
  lastParams: undefined as unknown,
  lastRequestOptions: undefined as unknown,
  fetchCalls: 0,
};

const fakeFetch: typeof globalThis.fetch = async (_input, init) => {
  mockState.fetchCalls++;
  mockState.lastRequestOptions = init;
  mockState.lastParams = JSON.parse(String(init?.body)) as unknown;
  return new Response(
    JSON.stringify({
      id: "img-1",
      usage: {
        prompt_tokens: 12,
        completion_tokens: 34,
        prompt_tokens_details: { cached_tokens: 0 },
      },
      choices: [
        {
          message: {
            content: "Here is your image.",
            images: [{ image_url: `data:image/png;base64,${PNG_BASE64}` }],
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};

describe("openrouter images", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.lastRequestOptions = undefined;
    mockState.fetchCalls = 0;
  });

  it("returns text plus images in final output", async () => {
    const model: ImagesModel<"openrouter-images"> = {
      id: "google/gemini-3.1-flash-image-preview",
      name: "Gemini 3.1 Flash Image Preview",
      api: "openrouter-images",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      input: ["text", "image"],
      output: ["text", "image"],
      cost: { input: 0.015, output: 0.03, cacheRead: 0, cacheWrite: 0 },
      headers: { "HTTP-Referer": "https://example.com" },
    };
    const context: ImagesContext = {
      input: [{ type: "text", text: "Generate a dog" }],
    };

    const output = await generateImages(model, context, { apiKey: "test", fetch: fakeFetch });
    expect(output.stopReason).toBe("stop");
    expect(output.responseId).toBe("img-1");
    expect(output.output[0]).toMatchObject({ type: "text", text: "Here is your image." });
    expect(output.output[1]).toMatchObject({ type: "image", mimeType: "image/png", data: PNG_BASE64 });

    const params = mockState.lastParams as {
      stream?: boolean;
      modalities?: string[];
      messages?: [{ content?: [{ type: string; text?: string }] }];
    };
    expect(params.stream).toBe(false);
    expect(params.modalities).toEqual(["image", "text"]);
    expect(params.messages?.[0]?.content?.[0]).toMatchObject({ type: "text", text: "Generate a dog" });
  });

  it("passes through abort signal and returns aborted result", async () => {
    const model: ImagesModel<"openrouter-images"> = {
      id: "black-forest-labs/flux.2-pro",
      name: "FLUX.2 Pro",
      api: "openrouter-images",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      input: ["text", "image"],
      output: ["image"],
      cost: { input: 0.015, output: 0.03, cacheRead: 0, cacheWrite: 0 },
    };
    const context: ImagesContext = {
      input: [{ type: "text", text: "Generate a dog" }],
    };
    const controller = new AbortController();
    controller.abort();

    const output = await generateImages(model, context, {
      apiKey: "test",
      signal: controller.signal,
      fetch: fakeFetch,
    });
    expect(output.stopReason).toBe("aborted");
    expect(output.errorMessage).toBe("Request aborted");
    expect(mockState.fetchCalls).toBe(0);
  });

  it("generateImages resolves the final assistant images result", async () => {
    const model: ImagesModel<"openrouter-images"> = {
      id: "black-forest-labs/flux.2-pro",
      name: "FLUX.2 Pro",
      api: "openrouter-images",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      input: ["text", "image"],
      output: ["image"],
      cost: { input: 0.015, output: 0.03, cacheRead: 0, cacheWrite: 0 },
    };
    const context: ImagesContext = {
      input: [{ type: "text", text: "Generate a dog" }],
    };

    const output = await generateImages(model, context, { apiKey: "test", fetch: fakeFetch });
    expect(output.output.some((item) => item.type === "image")).toBe(true);
  });
});
