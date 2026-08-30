import { beforeEach, describe, expect, it } from "vitest";
import { generateImagesOpenAI } from "../src/providers/images/openai.ts";
import type { ImagesContext, ImagesModel } from "../src/types.ts";
import { MAX_IMAGE_DOWNLOAD_BYTES } from "../src/utils/image-download.ts";

const mockState = {
  lastUrl: undefined as string | undefined,
  lastParams: undefined as unknown,
  lastRequestOptions: undefined as unknown,
  mockResponse: undefined as unknown,
};

const fakeFetch: typeof globalThis.fetch = async (input, init) => {
  mockState.lastUrl = String(input);
  mockState.lastRequestOptions = init;
  mockState.lastParams = JSON.parse(String(init?.body)) as unknown;
  if (init?.signal?.aborted) throw new Error("Request aborted");
  const defaultResponse = {
    created: 1234567890,
    data: [
      {
        b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        revised_prompt: "A beautiful cat in a garden",
      },
    ],
  };
  return new Response(JSON.stringify(mockState.mockResponse ?? defaultResponse), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

describe("openai-images-unit", () => {
  const dummyModel: ImagesModel<"openai-images"> = {
    id: "gpt-image-2",
    name: "GPT Image 2",
    api: "openai-images",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    input: ["text"],
    output: ["image", "text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };

  beforeEach(() => {
    mockState.lastUrl = undefined;
    mockState.lastParams = undefined;
    mockState.lastRequestOptions = undefined;
    mockState.mockResponse = undefined;
  });

  it("returns error stopReason when apiKey is missing", async () => {
    const context: ImagesContext = { input: [{ type: "text", text: "draw a cat" }] };
    const res = await generateImagesOpenAI(dummyModel, context, {});
    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toBe("No API key for provider: openai");
  });

  it("returns error when prompt is empty", async () => {
    const context: ImagesContext = { input: [] };
    const res = await generateImagesOpenAI(dummyModel, context, { apiKey: "test-key" });
    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toContain("No text prompt provided");
  });

  it("supports a configured OpenAI-compatible provider authenticated only by custom headers", async () => {
    const customModel: ImagesModel<"openai-images"> = {
      ...dummyModel,
      id: "flux2-klein-4b",
      name: "Configured orchestrator",
      provider: "mini-pc-11450",
      baseUrl: "https://orchestrator.example/v1",
    };
    const context: ImagesContext = { input: [{ type: "text", text: "draw a cat" }] };

    const result = await generateImagesOpenAI(customModel, context, {
      headers: { "x-api-key": "custom-secret" },
      fetch: fakeFetch,
    });

    expect(result.stopReason).toBe("stop");
    const requestHeaders = new Headers((mockState.lastRequestOptions as RequestInit).headers);
    expect(requestHeaders.get("x-api-key")).toBe("custom-secret");
    expect(requestHeaders.has("authorization")).toBe(false);
  });

  it("generates image and passes onPayload mutation to the HTTP request", async () => {
    const context: ImagesContext = { input: [{ type: "text", text: "draw a cat" }] };
    let responseSeen = false;

    const res = await generateImagesOpenAI(dummyModel, context, {
      apiKey: "test-key",
      fetch: fakeFetch,
      size: "1024x1024",
      quality: "high",
      onPayload: (params) => ({ ...(params as Record<string, unknown>), size: "1536x1024" }),
      onResponse: (response) => {
        responseSeen = true;
        expect(response.status).toBe(200);
      },
    });

    const sentParams = mockState.lastParams as {
      model?: string;
      prompt?: string;
      n?: number;
      quality?: string;
      response_format?: string;
      size?: string;
    };
    expect(mockState.lastUrl).toBe("https://api.openai.com/v1/images/generations");
    expect(sentParams).toMatchObject({
      model: "gpt-image-2",
      prompt: "draw a cat",
      n: 1,
      size: "1536x1024",
    });
    expect(sentParams.quality).toBe("high");
    expect(sentParams).not.toHaveProperty("response_format");
    const requestOptions = mockState.lastRequestOptions as RequestInit;
    expect(requestOptions.method).toBe("POST");
    const requestHeaders = new Headers(requestOptions.headers);
    expect(requestHeaders.get("authorization")).toBe("Bearer test-key");
    expect(requestHeaders.get("content-type")).toBe("application/json");
    expect(responseSeen).toBe(true);
    expect(res.stopReason).toBe("stop");
    expect(res.output[0]).toEqual({
      type: "image",
      mimeType: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    });
    expect(res.output[1]).toEqual({ type: "text", text: "A beautiful cat in a garden" });
  });

  it("handles data URL in response with magic byte detection", async () => {
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    mockState.mockResponse = {
      created: 1234567890,
      data: [{ url: `data:image/octet-stream;base64,${pngBase64}` }],
    };
    const context: ImagesContext = { input: [{ type: "text", text: "draw a dog" }] };
    const res = await generateImagesOpenAI(dummyModel, context, { apiKey: "test-key", fetch: fakeFetch });
    expect(res.stopReason).toBe("stop");
    expect(res.output[0]).toEqual({ type: "image", mimeType: "image/png", data: pngBase64 });
  });

  it("rejects options unsupported by official GPT Image 2", async () => {
    const context: ImagesContext = { input: [{ type: "text", text: "draw" }] };
    const invalidQuality = await generateImagesOpenAI(dummyModel, context, {
      apiKey: "test-key",
      fetch: fakeFetch,
      quality: "hd",
    });
    expect(invalidQuality.stopReason).toBe("error");
    expect(invalidQuality.errorMessage).toContain("Unsupported GPT Image 2 quality");

    const invalidStyle = await generateImagesOpenAI(dummyModel, context, {
      apiKey: "test-key",
      fetch: fakeFetch,
      style: "vivid",
    });
    expect(invalidStyle.stopReason).toBe("error");
    expect(invalidStyle.errorMessage).toContain("does not support style");
  });

  it("rejects oversized base64 image responses before decoding", async () => {
    const oversizedEncodedLength = Math.ceil((MAX_IMAGE_DOWNLOAD_BYTES + 1) / 3) * 4;
    mockState.mockResponse = {
      created: 1234567890,
      data: [{ b64_json: "A".repeat(oversizedEncodedLength) }],
    };
    const context: ImagesContext = { input: [{ type: "text", text: "draw" }] };

    const res = await generateImagesOpenAI(dummyModel, context, { apiKey: "test-key", fetch: fakeFetch });

    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toContain("exceeds maximum limit");
  });

  it("rejects SSRF / private network URLs", async () => {
    mockState.mockResponse = {
      created: 1234567890,
      data: [{ url: "http://127.0.0.1/evil.png" }],
    };
    const context: ImagesContext = { input: [{ type: "text", text: "draw something" }] };
    const res = await generateImagesOpenAI(dummyModel, context, { apiKey: "test-key", fetch: fakeFetch });
    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toContain("Rejected image download URL for security");
  });

  it("handles abort signal properly", async () => {
    const controller = new AbortController();
    controller.abort();
    const context: ImagesContext = { input: [{ type: "text", text: "draw a sunset" }] };
    const res = await generateImagesOpenAI(dummyModel, context, {
      apiKey: "test-key",
      fetch: fakeFetch,
      signal: controller.signal,
    });
    expect(res.stopReason).toBe("aborted");
    expect(res.errorMessage).toBe("Request aborted");
  });
});
