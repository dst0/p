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

    // Verify onPayload mutation reached the SDK
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

  it("downloads remote URL images and enforces size limit", async () => {
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "image/png", "content-length": "16" }),
      arrayBuffer: async () => pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength),
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
    fetchSpy.mockRestore();
  });

  it("rejects remote URL with content-length exceeding 50MB", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-length": "60000000" }),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    mockState.mockResponse = {
      created: 1234567890,
      data: [{ url: "https://cdn.openai.com/images/huge.png" }],
    };
    const context: ImagesContext = { input: [{ type: "text", text: "draw" }] };
    const res = await generateImagesOpenAI(dummyModel, context, { apiKey: "test-key" });

    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toContain("exceeds maximum limit");
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

describe("validateImageUrlForDownload", () => {
  it("allows valid public HTTPS/HTTP URLs", () => {
    expect(validateImageUrlForDownload("https://cdn.openai.com/image.png").valid).toBe(true);
    expect(validateImageUrlForDownload("http://example.com/img.jpg").valid).toBe(true);
    expect(validateImageUrlForDownload("https://8.8.8.8/image.png").valid).toBe(true);
  });

  it("blocks basic private IPs and localhost", () => {
    expect(validateImageUrlForDownload("http://localhost:8080/image.png").valid).toBe(false);
    expect(validateImageUrlForDownload("http://127.0.0.1:8080/image.png").valid).toBe(false);
    expect(validateImageUrlForDownload("http://169.254.169.254/latest/meta-data").valid).toBe(false);
    expect(validateImageUrlForDownload("http://10.0.1.5/image.png").valid).toBe(false);
    expect(validateImageUrlForDownload("http://192.168.1.1/image.png").valid).toBe(false);
    expect(validateImageUrlForDownload("http://172.20.0.1/image.png").valid).toBe(false);
  });

  it("blocks non-HTTP protocols", () => {
    expect(validateImageUrlForDownload("ftp://example.com/image.png").valid).toBe(false);
    expect(validateImageUrlForDownload("file:///etc/passwd").valid).toBe(false);
    expect(validateImageUrlForDownload("gopher://evil.com/").valid).toBe(false);
  });

  it("blocks integer IP bypass (http://2130706433/ = 127.0.0.1)", () => {
    // URL API normalizes integer IPs to dotted-decimal, so IPv4 check catches it
    const r = validateImageUrlForDownload("http://2130706433/");
    expect(r.valid).toBe(false);
  });

  it("blocks octal IP bypass (http://0177.0.0.1/ = 127.0.0.1)", () => {
    // URL API normalizes octal octets to decimal, so IPv4 check catches it
    const r = validateImageUrlForDownload("http://0177.0.0.1/");
    expect(r.valid).toBe(false);
  });

  it("blocks hex IP bypass (http://0x7f000001/ = 127.0.0.1)", () => {
    // URL API normalizes hex IPs to dotted-decimal, so IPv4 check catches it
    const r = validateImageUrlForDownload("http://0x7f000001/");
    expect(r.valid).toBe(false);
  });

  it("blocks IPv4-mapped IPv6 (::ffff:127.0.0.1)", () => {
    const r = validateImageUrlForDownload("http://[::ffff:127.0.0.1]/");
    expect(r.valid).toBe(false);
  });

  it("blocks IPv4-mapped IPv6 for private ranges (::ffff:10.0.0.1)", () => {
    const r = validateImageUrlForDownload("http://[::ffff:10.0.0.1]/");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("IPv4-mapped");
  });

  it("blocks IPv6 loopback and private ranges", () => {
    expect(validateImageUrlForDownload("http://[::1]/").valid).toBe(false);
    expect(validateImageUrlForDownload("http://[fe80::1]/").valid).toBe(false);
    expect(validateImageUrlForDownload("http://[fc00::1]/").valid).toBe(false);
    expect(validateImageUrlForDownload("http://[fd12::1]/").valid).toBe(false);
  });

  it("blocks .localhost, .local, .internal subdomains", () => {
    expect(validateImageUrlForDownload("http://evil.localhost/").valid).toBe(false);
    expect(validateImageUrlForDownload("http://myhost.local/").valid).toBe(false);
    expect(validateImageUrlForDownload("http://service.internal/").valid).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(validateImageUrlForDownload("not-a-url").valid).toBe(false);
    expect(validateImageUrlForDownload("").valid).toBe(false);
  });
});

describe("detectImageMimeType", () => {
  it("detects standard image formats from magic bytes", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    const gif87 = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
    const gif89 = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

    expect(detectImageMimeType(png)).toBe("image/png");
    expect(detectImageMimeType(jpeg)).toBe("image/jpeg");
    expect(detectImageMimeType(webp)).toBe("image/webp");
    expect(detectImageMimeType(gif87)).toBe("image/gif");
    expect(detectImageMimeType(gif89)).toBe("image/gif");
  });

  it("returns undefined for empty buffer", () => {
    expect(detectImageMimeType(Buffer.alloc(0))).toBeUndefined();
  });

  it("returns undefined for truncated buffers (< minimum header size)", () => {
    expect(detectImageMimeType(Buffer.from([0x89]))).toBeUndefined();
    expect(detectImageMimeType(Buffer.from([0x89, 0x50]))).toBeUndefined();
    expect(detectImageMimeType(Buffer.from([0xff, 0xd8]))).toBeUndefined();
  });

  it("returns undefined for truncated PNG (4 bytes match but not full 8)", () => {
    const truncatedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);
    expect(detectImageMimeType(truncatedPng)).toBeUndefined();
  });

  it("returns undefined for unknown/random bytes", () => {
    expect(detectImageMimeType(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeUndefined();
    expect(detectImageMimeType(Buffer.from([0xde, 0xad, 0xbe, 0xef]))).toBeUndefined();
  });
});
