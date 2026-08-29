import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateImagesOpenAI } from "../src/providers/images/openai.ts";
import type { ImagesContext, ImagesModel } from "../src/types.ts";
import { detectImageMimeType, validateImageUrlForDownload } from "../src/utils/image-mime.ts";

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
              b64_json:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
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
    expect(res.output[0]).toEqual({
      type: "image",
      mimeType: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    });
    expect(res.output[1]).toEqual({
      type: "text",
      text: "A beautiful cat in a garden",
    });
  });

  it("handles data URL in response with magic byte detection", async () => {
    // 1x1 PNG in base64
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    mockState.mockResponse = {
      created: 1234567890,
      data: [{ url: `data:image/octet-stream;base64,${pngBase64}` }],
    };

    const context: ImagesContext = { input: [{ type: "text", text: "draw a dog" }] };
    const res = await generateImagesOpenAI(dummyModel, context, { apiKey: "test-key" });

    expect(res.stopReason).toBe("stop");
    expect(res.output[0]).toEqual({
      type: "image",
      mimeType: "image/png",
      data: pngBase64,
    });
  });

  it("rejects SSRF / private network URLs", async () => {
    mockState.mockResponse = {
      created: 1234567890,
      data: [{ url: "http://127.0.0.1/evil.png" }],
    };

    const context: ImagesContext = { input: [{ type: "text", text: "draw something" }] };
    const res = await generateImagesOpenAI(dummyModel, context, { apiKey: "test-key" });

    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toContain("Rejected image download URL for security");
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

  it("validates SSRF URL helper across IP and hostname ranges", () => {
    expect(validateImageUrlForDownload("https://cdn.openai.com/image.png").valid).toBe(true);
    expect(validateImageUrlForDownload("http://localhost:8080/image.png").valid).toBe(false);
    expect(validateImageUrlForDownload("http://127.0.0.1:8080/image.png").valid).toBe(false);
    expect(validateImageUrlForDownload("http://169.254.169.254/latest/meta-data").valid).toBe(false);
    expect(validateImageUrlForDownload("http://10.0.1.5/image.png").valid).toBe(false);
    expect(validateImageUrlForDownload("http://192.168.1.1/image.png").valid).toBe(false);
    expect(validateImageUrlForDownload("http://172.20.0.1/image.png").valid).toBe(false);
    expect(validateImageUrlForDownload("ftp://example.com/image.png").valid).toBe(false);
  });

  it("detects image MIME types from magic bytes correctly", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

    expect(detectImageMimeType(png)).toBe("image/png");
    expect(detectImageMimeType(jpeg)).toBe("image/jpeg");
    expect(detectImageMimeType(webp)).toBe("image/webp");
    expect(detectImageMimeType(gif)).toBe("image/gif");
    expect(detectImageMimeType(Buffer.from([0x00, 0x01, 0x02]))).toBeUndefined();
  });
});
