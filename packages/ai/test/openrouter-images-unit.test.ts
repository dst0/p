import { beforeEach, describe, expect, it } from "vitest";
import { generateImagesOpenRouter } from "../src/providers/images/openrouter.ts";
import type { ImagesContext, ImagesModel } from "../src/types.ts";
import { MAX_IMAGE_BYTES } from "../src/utils/image-mime.ts";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const mockState = {
  urls: [] as string[],
  lastParams: undefined as unknown,
  lastHeaders: undefined as Headers | undefined,
  response: undefined as unknown,
  generationResponse: undefined as unknown,
};

const fakeFetch: typeof globalThis.fetch = async (input, init) => {
  const url = String(input);
  mockState.urls.push(url);
  if (url.includes("/generation?")) {
    return new Response(
      JSON.stringify(
        mockState.generationResponse ?? {
          data: { is_byok: false, total_cost: 0.04, upstream_inference_cost: 0.03 },
        },
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  mockState.lastParams = JSON.parse(String(init?.body)) as unknown;
  mockState.lastHeaders = new Headers(init?.headers);
  const defaultResponse = {
    id: "generation-1",
    choices: [
      {
        message: {
          content: "Generated",
          images: [{ image_url: `data:image/octet-stream;base64,${PNG_BASE64}` }],
        },
      },
    ],
  };
  return new Response(JSON.stringify(mockState.response ?? defaultResponse), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

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

  beforeEach(() => {
    mockState.urls = [];
    mockState.lastParams = undefined;
    mockState.lastHeaders = undefined;
    mockState.response = undefined;
    mockState.generationResponse = undefined;
  });

  it("returns error stopReason when apiKey is missing", async () => {
    const context: ImagesContext = { input: [{ type: "text", text: "draw cat" }] };
    const res = await generateImagesOpenRouter(dummyModel, context, {});
    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toBe("No API key for provider: openrouter");
  });

  it("sends image input and validates the returned image bytes", async () => {
    const context: ImagesContext = {
      input: [
        { type: "text", text: "edit image" },
        { type: "image", mimeType: "image/png", data: PNG_BASE64 },
      ],
    };
    let payloadReceived = false;

    const res = await generateImagesOpenRouter(dummyModel, context, {
      apiKey: "dummy-key",
      fetch: fakeFetch,
      onPayload: async (params) => {
        payloadReceived = true;
        return params;
      },
    });

    expect(payloadReceived).toBe(true);
    expect(mockState.urls).toEqual([
      "https://openrouter.ai/api/v1/chat/completions",
      "https://openrouter.ai/api/v1/generation?id=generation-1",
    ]);
    expect(mockState.lastParams).toMatchObject({
      model: "google/imagen-3",
      stream: false,
      modalities: ["image", "text"],
    });
    expect(mockState.lastHeaders?.get("HTTP-Referer")).toBe("https://github.com/dst0/p");
    expect(mockState.lastHeaders?.get("X-OpenRouter-Title")).toBe("p");
    expect(res.stopReason).toBe("stop");
    expect(res.output).toEqual([
      { type: "text", text: "Generated" },
      { type: "image", mimeType: "image/png", data: PNG_BASE64 },
    ]);
  });

  it.each([
    { name: "missing completion and total counts", usage: { prompt_tokens: 5, cost: 0.04 } },
    { name: "a negative prompt count", usage: { prompt_tokens: -1, completion_tokens: 4, cost: 0.04 } },
    {
      name: "a total smaller than its complete components",
      usage: { prompt_tokens: 3, completion_tokens: 7, total_tokens: 9, cost: 0.04 },
    },
    {
      name: "a total larger than its complete components",
      usage: { prompt_tokens: 3, completion_tokens: 7, total_tokens: 11, cost: 0.04 },
    },
    {
      name: "cache counters larger than the prompt total",
      usage: {
        prompt_tokens: 5,
        completion_tokens: 7,
        total_tokens: 12,
        cost: 0.04,
        prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 3 },
      },
    },
  ])("does not fabricate token usage from $name", async ({ usage }) => {
    mockState.response = {
      id: "generation-invalid-token-usage",
      usage,
      choices: [{ message: { images: [{ image_url: `data:image/png;base64,${PNG_BASE64}` }] } }],
    };

    const result = await generateImagesOpenRouter(
      dummyModel,
      { input: [{ type: "text", text: "draw" }] },
      { apiKey: "dummy-key", fetch: fakeFetch },
    );

    expect(result).toMatchObject({ stopReason: "stop", reportedUsd: 0.04 });
    expect(result.usage).toBeUndefined();
  });

  it.each([
    { cachedTokens: 0, cacheWriteTokens: 100, expectedInput: 20 },
    { cachedTokens: 20, cacheWriteTokens: 80, expectedInput: 20 },
  ])(
    "treats $cacheWriteTokens cache writes separately from $cachedTokens cache reads",
    async ({ cachedTokens, cacheWriteTokens, expectedInput }) => {
      mockState.response = {
        id: "generation-cache-breakdown",
        usage: {
          prompt_tokens: 120,
          completion_tokens: 7,
          total_tokens: 127,
          cost: 0.09,
          prompt_tokens_details: { cached_tokens: cachedTokens, cache_write_tokens: cacheWriteTokens },
        },
        choices: [{ message: { images: [{ image_url: `data:image/png;base64,${PNG_BASE64}` }] } }],
      };

      const result = await generateImagesOpenRouter(
        dummyModel,
        { input: [{ type: "text", text: "draw" }] },
        { apiKey: "dummy-key", fetch: fakeFetch },
      );

      expect(result.usage).toMatchObject({
        input: expectedInput,
        output: 7,
        cacheRead: cachedTokens,
        cacheWrite: cacheWriteTokens,
        totalTokens: 127,
      });
    },
  );

  it("derives a total only when all required token components are present", async () => {
    mockState.response = {
      id: "generation-complete-token-components",
      usage: { prompt_tokens: 3, completion_tokens: 7, cost: 0.09 },
      choices: [{ message: { images: [{ image_url: `data:image/png;base64,${PNG_BASE64}` }] } }],
    };

    const result = await generateImagesOpenRouter(
      dummyModel,
      { input: [{ type: "text", text: "draw" }] },
      { apiKey: "dummy-key", fetch: fakeFetch },
    );

    expect(result.usage).toMatchObject({ input: 3, output: 7, totalTokens: 10 });
  });

  it("rejects oversized base64 image responses before decoding", async () => {
    const oversizedEncodedLength = Math.ceil((MAX_IMAGE_BYTES + 1) / 3) * 4;
    mockState.response = {
      id: "generation-oversized",
      choices: [
        {
          message: {
            content: "",
            images: [{ image_url: `data:image/png;base64,${"A".repeat(oversizedEncodedLength)}` }],
          },
        },
      ],
    };

    const result = await generateImagesOpenRouter(
      dummyModel,
      { input: [{ type: "text", text: "draw" }] },
      { apiKey: "dummy-key", fetch: fakeFetch },
    );

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("exceeds maximum limit");
  });

  it("lets request headers override duplicate model casing variants", async () => {
    const model: ImagesModel<"openrouter-images"> = {
      ...dummyModel,
      headers: {
        "HTTP-Referer": "https://model.example",
        "http-referer": "https://stale-model.example",
        "X-OpenRouter-Title": "Model p",
        "x-openrouter-title": "Stale model p",
      },
    };

    const result = await generateImagesOpenRouter(
      model,
      { input: [{ type: "text", text: "draw" }] },
      {
        apiKey: "dummy-key",
        fetch: fakeFetch,
        headers: {
          "HTTP-Referer": "https://request.example",
          "X-OpenRouter-Title": "Request p",
        },
      },
    );

    expect(result.stopReason).toBe("stop");
    expect(mockState.lastHeaders?.get("HTTP-Referer")).toBe("https://request.example");
    expect(mockState.lastHeaders?.get("X-OpenRouter-Title")).toBe("Request p");
  });
});
