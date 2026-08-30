import { promises as dnsPromises } from "dns";
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
              b64_json:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
              revised_prompt: "A beautiful cat in a garden",
            },
          ],
        };
        const response = mockState.mockResponse ?? defaultResponse;
        const promise = Promise.resolve(response) as Promise<typeof response> & {
          withResponse: () => Promise<{ data: typeof response; response: { status: number; headers: Headers } }>;
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
    vi.restoreAllMocks();
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

  it("generates image with b64_json and onPayload mutation is passed to SDK", async () => {
    const context: ImagesContext = { input: [{ type: "text", text: "draw a cat" }] };
    let responseSeen = false;

    const res = await generateImagesOpenAI(dummyModel, context, {
      apiKey: "test-key",
      size: "1024x1024",
      quality: "hd",
      onPayload: (params) => ({ ...(params as Record<string, unknown>), size: "256x256" }),
      onResponse: (response) => {
        responseSeen = true;
        expect(response.status).toBe(200);
      },
    });

    const sentParams = mockState.lastParams as { size?: string };
    expect(sentParams.size).toBe("256x256");
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
    const res = await generateImagesOpenAI(dummyModel, context, { apiKey: "test-key" });
    expect(res.stopReason).toBe("stop");
    expect(res.output[0]).toEqual({ type: "image", mimeType: "image/png", data: pngBase64 });
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

  it("downloads remote URL images streaming and verifies magic bytes", async () => {
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);

    vi.spyOn(dnsPromises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "image/png", "content-length": "16" }),
      body: {
        getReader: () => {
          let readCount = 0;
          return {
            read: async () => {
              if (readCount++ === 0) {
                return { done: false, value: new Uint8Array(pngBytes) };
              }
              return { done: true, value: undefined };
            },
            cancel: async () => {},
          };
        },
      } as any,
    } as Response);

    mockState.mockResponse = {
      created: 1234567890,
      data: [{ url: "https://cdn.openai.com/images/abc123.png" }],
    };
    const context: ImagesContext = { input: [{ type: "text", text: "draw" }] };
    const res = await generateImagesOpenAI(dummyModel, context, { apiKey: "test-key" });

    expect(fetchSpy).toHaveBeenCalledWith("https://cdn.openai.com/images/abc123.png", expect.any(Object));
    expect(res.stopReason).toBe("stop");
    expect(res.output[0].type).toBe("image");
    expect((res.output[0] as { mimeType: string }).mimeType).toBe("image/png");
    fetchSpy.mockRestore();
  });

  it("rejects streaming response exceeding 50MB during stream consumption", async () => {
    vi.spyOn(dnsPromises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);

    let streamCancelled = false;
    const hugeChunk = new Uint8Array(10 * 1024 * 1024); // 10MB chunk

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      headers: new Headers({}), // no Content-Length header
      body: {
        getReader: () => {
          let chunksSent = 0;
          return {
            read: async () => {
              chunksSent++;
              if (chunksSent <= 6) {
                // Total 60MB
                return { done: false, value: hugeChunk };
              }
              return { done: true, value: undefined };
            },
            cancel: async () => {
              streamCancelled = true;
            },
          };
        },
      } as any,
    } as Response);

    mockState.mockResponse = {
      created: 1234567890,
      data: [{ url: "https://cdn.openai.com/images/infinite.png" }],
    };
    const context: ImagesContext = { input: [{ type: "text", text: "draw" }] };
    const res = await generateImagesOpenAI(dummyModel, context, { apiKey: "test-key" });

    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toContain("exceeds maximum limit");
    expect(streamCancelled).toBe(true);
  });

  it("rejects SSRF redirect to private network", async () => {
    vi.spyOn(dnsPromises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      status: 302,
      ok: false,
      headers: new Headers({ location: "http://169.254.169.254/latest/meta-data" }),
    } as Response);

    mockState.mockResponse = {
      created: 1234567890,
      data: [{ url: "https://public-cdn.example.com/image.png" }],
    };
    const context: ImagesContext = { input: [{ type: "text", text: "draw" }] };
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
});
