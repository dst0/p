import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateImagesOpenAI } from "../src/providers/images/openai.ts";
import type { ImagesContext, ImagesModel } from "../src/types.ts";

const mockState = vi.hoisted(() => ({
  lastParams: undefined as unknown,
  lastRequestOptions: undefined as unknown,
  mockResponse: undefined as unknown,
}));

vi.mock("openai", () => {
  class FakeOpenAI {
    images = {
      generate: (params: unknown, requestOptions?: unknown) => {
        mockState.lastParams = params;
        mockState.lastRequestOptions = requestOptions;
        const signal = (requestOptions as { signal?: AbortSignal } | undefined)?.signal;
        if (signal?.aborted) {
          const error = new Error("Request aborted");
          return {
            withResponse: async () => {
              throw error;
            },
          };
        }
        const defaultResponse = {
          created: 1234567890,
          data: [
            {
              b64_json: "ZmFrZS1pbWFnZS1kYXRh",
              revised_prompt: "A beautiful cat in a garden",
            },
          ],
        };
        const response = mockState.mockResponse ?? defaultResponse;
        const promise = Promise.resolve(response) as Promise<typeof response> & {
          withResponse: () => Promise<{
            data: typeof response;
            response: { status: number; headers: Headers };
          }>;
        };
        promise.withResponse = async () => ({
          data: response,
          response: { status: 200, headers: new Headers() },
        });
        return promise;
      },
    };
  }

  return { default: FakeOpenAI };
});

describe("openai-images-unit", () => {
  const dummyModel: ImagesModel<"openai-images"> = {
    id: "dall-e-3",
    name: "DALL-E 3",
    api: "openai-images",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    input: ["text"],
    output: ["image", "text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };

  beforeEach(() => {
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

  it("generates image with b64_json output and revised_prompt", async () => {
    const context: ImagesContext = { input: [{ type: "text", text: "draw a cat" }] };
    let payloadSeen = false;
    let responseSeen = false;

    const res = await generateImagesOpenAI(dummyModel, context, {
      apiKey: "test-key",
      size: "1024x1024",
      quality: "hd",
      onPayload: (params) => {
        payloadSeen = true;
        return params;
      },
      onResponse: (response) => {
        responseSeen = true;
        expect(response.status).toBe(200);
      },
    });

    expect(payloadSeen).toBe(true);
    expect(responseSeen).toBe(true);
    expect(res.stopReason).toBe("stop");
    expect(res.output).toHaveLength(2);
    expect(res.output[0]).toEqual({
      type: "image",
      mimeType: "image/png",
      data: "ZmFrZS1pbWFnZS1kYXRh",
    });
    expect(res.output[1]).toEqual({
      type: "text",
      text: "A beautiful cat in a garden",
    });

    const params = mockState.lastParams as { prompt?: string; model?: string; size?: string; quality?: string };
    expect(params.prompt).toBe("draw a cat");
    expect(params.model).toBe("dall-e-3");
    expect(params.size).toBe("1024x1024");
    expect(params.quality).toBe("hd");
  });

  it("handles data URL in response", async () => {
    mockState.mockResponse = {
      created: 1234567890,
      data: [{ url: "data:image/jpeg;base64,anBlZy1kYXRh" }],
    };

    const context: ImagesContext = { input: [{ type: "text", text: "draw a dog" }] };
    const res = await generateImagesOpenAI(dummyModel, context, { apiKey: "test-key" });

    expect(res.stopReason).toBe("stop");
    expect(res.output[0]).toEqual({
      type: "image",
      mimeType: "image/jpeg",
      data: "anBlZy1kYXRh",
    });
  });

  it("handles abort signal properly", async () => {
    const controller = new AbortController();
    controller.abort();

    const context: ImagesContext = { input: [{ type: "text", text: "draw a sunset" }] };
    const res = await generateImagesOpenAI(dummyModel, context, {
      apiKey: "test-key",
      signal: controller.signal,
    });

    expect(res.stopReason).toBe("aborted");
    expect(res.errorMessage).toBe("Request aborted");
  });
});
