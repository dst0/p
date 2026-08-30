import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createValidatedImageLookup, downloadImageSafely, type ImageRequest } from "../src/utils/image-download.ts";

function response(options: { status?: number; headers?: Record<string, string>; body?: Buffer } = {}): IncomingMessage {
  const stream = new PassThrough();
  const incoming = stream as unknown as IncomingMessage;
  incoming.statusCode = options.status ?? 200;
  incoming.headers = options.headers ?? {};
  queueMicrotask(() => stream.end(options.body));
  return incoming;
}

function publicRequest(factory: () => IncomingMessage): ImageRequest {
  return (url: URL, options: RequestOptions, callback: (incoming: IncomingMessage) => void) => {
    const request = new EventEmitter() as unknown as ClientRequest;
    queueMicrotask(() => {
      options.lookup?.(url.hostname, { all: false }, (error) => {
        if (error) request.emit("error", error);
        else callback(factory());
      });
    });
    return request;
  };
}

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 as const }];

describe("safe image download edge contracts", () => {
  it("uses the default resolver and rejects local DNS results", async () => {
    const lookup = createValidatedImageLookup();
    const error = await new Promise<Error | undefined>((resolve) => {
      lookup("127.0.0.1", { all: true }, (lookupError) => resolve(lookupError ?? undefined));
    });
    expect(error?.message).toContain("private/unallowed IP");
  });

  it("reports empty, non-Error, and public all-address DNS results", async () => {
    const emptyLookup = createValidatedImageLookup(async () => []);
    const emptyError = await new Promise<Error | undefined>((resolve) => {
      emptyLookup("empty.example", { all: true }, (error) => resolve(error ?? undefined));
    });
    expect(emptyError?.message).toContain("no addresses");

    const rejectedLookup = createValidatedImageLookup(async () => Promise.reject("resolver unavailable"));
    const rejectedError = await new Promise<Error | undefined>((resolve) => {
      rejectedLookup("error.example", { all: false }, (error) => resolve(error ?? undefined));
    });
    expect(rejectedError?.message).toBe("resolver unavailable");

    const allLookup = createValidatedImageLookup(publicResolver);
    const addresses = await new Promise<readonly { address: string; family: number }[]>((resolve, reject) => {
      allLookup("public.example", { all: true }, (error, result) => {
        if (error) reject(error);
        else if (Array.isArray(result)) resolve(result);
        else reject(new Error("Expected all-address DNS result"));
      });
    });
    expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("rejects unsafe Content-Length integers and invalid image bodies", async () => {
    await expect(
      downloadImageSafely("https://public.example/image.png", {
        dependencies: {
          resolveHostname: publicResolver,
          request: publicRequest(() => response({ headers: { "content-length": "999999999999999999999" } })),
        },
      }),
    ).rejects.toThrow("Invalid Content-Length");
    await expect(
      downloadImageSafely("https://public.example/image.png", {
        dependencies: {
          resolveHostname: publicResolver,
          request: publicRequest(() => response({ body: Buffer.from("not an image") })),
        },
      }),
    ).rejects.toThrow("not a valid recognized image format");
  });

  it("rejects redirects without a location and stops at the redirect limit", async () => {
    await expect(
      downloadImageSafely("https://public.example/image.png", {
        dependencies: {
          resolveHostname: publicResolver,
          request: publicRequest(() => response({ status: 302 })),
        },
      }),
    ).rejects.toThrow("without Location");

    let requests = 0;
    await expect(
      downloadImageSafely("https://public.example/image.png", {
        dependencies: {
          resolveHostname: publicResolver,
          request: publicRequest(() => {
            requests++;
            return response({ status: 302, headers: { location: "/next.png" } });
          }),
        },
      }),
    ).rejects.toThrow("Exceeded maximum redirect limit");
    expect(requests).toBe(6);
  });

  it("honors a signal that was aborted before download begins", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadImageSafely("https://public.example/image.png", {
        signal: controller.signal,
        dependencies: { resolveHostname: publicResolver, request: publicRequest(() => response()) },
      }),
    ).rejects.toThrow("Download aborted");
  });
});
