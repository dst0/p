import { EventEmitter } from "node:events";
import { type ClientRequest, createServer, type IncomingMessage, type RequestOptions } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  createValidatedImageLookup,
  downloadImageSafely,
  type ImageRequest,
  MAX_IMAGE_DOWNLOAD_BYTES,
} from "../src/utils/image-download.ts";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

interface FakeResponseOptions {
  statusCode?: number;
  headers?: Record<string, string>;
  chunks?: readonly Buffer[];
}

function createFakeResponse(options: FakeResponseOptions = {}): IncomingMessage {
  const stream = new PassThrough();
  const response = stream as unknown as IncomingMessage;
  response.statusCode = options.statusCode ?? 200;
  response.headers = options.headers ?? {};
  queueMicrotask(() => {
    for (const chunk of options.chunks ?? []) stream.write(chunk);
    stream.end();
  });
  return response;
}

function createOpenResponse(options: FakeResponseOptions = {}): IncomingMessage {
  const response = new PassThrough() as unknown as IncomingMessage;
  response.statusCode = options.statusCode ?? 200;
  response.headers = options.headers ?? {};
  return response;
}

function createBoundRequest(responseFactory: (url: URL) => IncomingMessage): ImageRequest {
  return (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const request = new EventEmitter() as unknown as ClientRequest;
    queueMicrotask(() => {
      if (!options.lookup) {
        request.emit("error", new Error("validated lookup was not attached"));
        return;
      }
      options.lookup(url.hostname, { all: false }, (error) => {
        if (error) {
          request.emit("error", error);
          return;
        }
        callback(responseFactory(url));
      });
    });
    return request;
  };
}

describe("safe image downloads", () => {
  it("binds the validated DNS result to the HTTP socket lookup", async () => {
    let requestCount = 0;
    const result = await downloadImageSafely("https://cdn.example.com/image.png", {
      dependencies: {
        resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
        request: createBoundRequest(() => {
          requestCount++;
          return createFakeResponse({ chunks: [PNG_BYTES] });
        }),
      },
    });

    expect(requestCount).toBe(1);
    expect(result).toEqual({ buffer: PNG_BYTES, mimeType: "image/png" });
  });

  it("rejects a private address returned by the connection-bound lookup", async () => {
    await expect(
      downloadImageSafely("https://cdn.example.com/image.png", {
        dependencies: {
          resolveHostname: async () => [{ address: "127.0.0.1", family: 4 }],
          request: createBoundRequest(() => createFakeResponse({ chunks: [PNG_BYTES] })),
        },
      }),
    ).rejects.toThrow("private/unallowed IP 127.0.0.1");
  });

  it("rejects loopback DNS through the real default HTTP transport before connecting", async () => {
    let connectionCount = 0;
    const server = createServer((_request, response) => {
      connectionCount++;
      response.end(PNG_BYTES);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(
        downloadImageSafely(`http://public.example:${port}/image.png`, {
          dependencies: { resolveHostname: async () => [{ address: "127.0.0.1", family: 4 }] },
        }),
      ).rejects.toThrow("private/unallowed IP 127.0.0.1");
      expect(connectionCount).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("rejects any mixed DNS answer containing a private address", async () => {
    const lookup = createValidatedImageLookup(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);

    const error = await new Promise<Error | undefined>((resolve) => {
      lookup("cdn.example.com", { all: true }, (lookupError) => resolve(lookupError ?? undefined));
    });
    expect(error?.message).toContain("private/unallowed IP 169.254.169.254");
  });

  it("revalidates redirects before issuing the next request", async () => {
    let requestCount = 0;
    const request = createBoundRequest(() => {
      requestCount++;
      return createFakeResponse({ statusCode: 302, headers: { location: "http://169.254.169.254/metadata" } });
    });

    await expect(
      downloadImageSafely("https://cdn.example.com/image.png", {
        dependencies: {
          resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
          request,
        },
      }),
    ).rejects.toThrow("Rejected image download URL for security");
    expect(requestCount).toBe(1);
  });

  it("revalidates public-looking redirect hostnames against second-hop DNS", async () => {
    let requestCount = 0;
    const request = createBoundRequest(() => {
      requestCount++;
      return createFakeResponse({ statusCode: 302, headers: { location: "https://redirect.example/image.png" } });
    });

    await expect(
      downloadImageSafely("https://cdn.example/image.png", {
        dependencies: {
          resolveHostname: async (hostname) => [
            { address: hostname === "redirect.example" ? "127.0.0.1" : "93.184.216.34", family: 4 },
          ],
          request,
        },
      }),
    ).rejects.toThrow("private/unallowed IP 127.0.0.1");
    expect(requestCount).toBe(1);
  });

  it("destroys unused redirect and error bodies instead of draining unbounded streams", async () => {
    const redirectResponse = createOpenResponse({
      statusCode: 302,
      headers: { location: "http://169.254.169.254/metadata" },
    });
    await expect(
      downloadImageSafely("https://cdn.example/image.png", {
        dependencies: {
          resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
          request: createBoundRequest(() => redirectResponse),
        },
      }),
    ).rejects.toThrow("Rejected image download URL for security");
    expect(redirectResponse.destroyed).toBe(true);

    const errorResponse = createOpenResponse({ statusCode: 503 });
    await expect(
      downloadImageSafely("https://cdn.example/image.png", {
        dependencies: {
          resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
          request: createBoundRequest(() => errorResponse),
        },
      }),
    ).rejects.toThrow("503");
    expect(errorResponse.destroyed).toBe(true);
  });

  it("times out and destroys a response whose body stalls", async () => {
    const stalledResponse = createOpenResponse();
    await expect(
      downloadImageSafely("https://cdn.example/image.png", {
        timeoutMs: 20,
        dependencies: {
          resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
          request: createBoundRequest(() => stalledResponse),
        },
      }),
    ).rejects.toThrow("timed out after 20ms");
    expect(stalledResponse.destroyed).toBe(true);
  });

  it("destroys a stalled response when abort wins the handoff from request to body", async () => {
    const controller = new AbortController();
    const stalledResponse = createOpenResponse();
    await expect(
      downloadImageSafely("https://cdn.example/image.png", {
        signal: controller.signal,
        dependencies: {
          resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
          request: createBoundRequest(() => {
            queueMicrotask(() => controller.abort());
            return stalledResponse;
          }),
        },
      }),
    ).rejects.toThrow("Download aborted");
    expect(stalledResponse.destroyed).toBe(true);
  });

  it("destroys an open response when Content-Length is malformed", async () => {
    const malformedResponse = createOpenResponse({ headers: { "content-length": "not-a-number" } });
    await expect(
      downloadImageSafely("https://cdn.example/image.png", {
        dependencies: {
          resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
          request: createBoundRequest(() => malformedResponse),
        },
      }),
    ).rejects.toThrow("Invalid Content-Length");
    expect(malformedResponse.destroyed).toBe(true);
  });

  it("rejects declared and streamed bodies larger than 50MB", async () => {
    const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }] as const;
    await expect(
      downloadImageSafely("https://cdn.example.com/declared.png", {
        dependencies: {
          resolveHostname: publicResolver,
          request: createBoundRequest(() =>
            createFakeResponse({ headers: { "content-length": String(MAX_IMAGE_DOWNLOAD_BYTES + 1) } }),
          ),
        },
      }),
    ).rejects.toThrow("exceeds maximum limit");

    const chunk = Buffer.alloc(1024 * 1024);
    await expect(
      downloadImageSafely("https://cdn.example.com/streamed.png", {
        dependencies: {
          resolveHostname: publicResolver,
          request: createBoundRequest(() => createFakeResponse({ chunks: Array(51).fill(chunk) })),
        },
      }),
    ).rejects.toThrow("exceeds maximum limit");
  });
});
