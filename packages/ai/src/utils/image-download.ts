import { promises as dnsPromises, type LookupAddress } from "node:dns";
import { type ClientRequest, get as httpGet, type IncomingMessage, type RequestOptions } from "node:http";
import { get as httpsGet } from "node:https";
import type { LookupFunction } from "node:net";
import {
  detectImageMimeType,
  MAX_IMAGE_BYTES,
  validateImageUrlForDownload,
  validateIpAddressForDownload,
} from "./image-mime.ts";

export const MAX_IMAGE_DOWNLOAD_BYTES = MAX_IMAGE_BYTES;
const MAX_REDIRECTS = 5;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export interface SafeImageDownloadResult {
  buffer: Buffer;
  mimeType: string;
}

export type ImageHostnameResolver = (hostname: string) => Promise<readonly LookupAddress[]>;
export type ImageRequest = (
  url: URL,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export interface ImageDownloadDependencies {
  resolveHostname?: ImageHostnameResolver;
  request?: ImageRequest;
}

async function resolveHostnameDefault(hostname: string): Promise<readonly LookupAddress[]> {
  return dnsPromises.lookup(hostname, { all: true, verbatim: true });
}

function validateResolvedAddresses(hostname: string, addresses: readonly LookupAddress[]): void {
  if (addresses.length === 0) {
    throw new Error(`DNS lookup returned no addresses for hostname: ${hostname}`);
  }
  for (const record of addresses) {
    const check = validateIpAddressForDownload(record.address);
    if (!check.valid) {
      throw new Error(`DNS resolved ${hostname} to private/unallowed IP ${record.address}: ${check.reason}`);
    }
  }
}

/**
 * Creates the lookup function used by the actual HTTP socket connection. Validation
 * and connection therefore use the same DNS result, closing DNS-rebinding races.
 */
export function createValidatedImageLookup(
  resolveHostname: ImageHostnameResolver = resolveHostnameDefault,
): LookupFunction {
  return (hostname, options, callback) => {
    void resolveHostname(hostname)
      .then((addresses) => {
        validateResolvedAddresses(hostname, addresses);
        if (options.all) {
          callback(null, [...addresses]);
          return;
        }
        const first = addresses[0];
        callback(null, first.address, first.family);
      })
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error : new Error(String(error));
        callback(reason, "", 0);
      });
  };
}

function requestDefault(
  url: URL,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
): ClientRequest {
  return url.protocol === "https:" ? httpsGet(url, options, callback) : httpGet(url, options, callback);
}

function requestResponse(
  url: URL,
  signal: AbortSignal | undefined,
  dependencies: ImageDownloadDependencies,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const finish = (callback: () => void): void => {
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => finish(() => reject(signal?.reason ?? new Error("Download aborted")));
    const request = (dependencies.request ?? requestDefault)(
      url,
      {
        lookup: createValidatedImageLookup(dependencies.resolveHostname),
        ...(signal ? { signal } : {}),
      },
      (response) => finish(() => resolve(response)),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    request.once("error", (error) => finish(() => reject(error)));
  });
}

function parseContentLength(response: IncomingMessage): number | undefined {
  const rawValue = response.headers["content-length"];
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid Content-Length header received while downloading image: ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid Content-Length header received while downloading image: ${value}`);
  }
  return parsed;
}

async function readLimitedImageBody(response: IncomingMessage, signal?: AbortSignal): Promise<Buffer> {
  if (signal?.aborted) {
    response.destroy();
    throw signal.reason ?? new Error("Download aborted");
  }
  let contentLength: number | undefined;
  try {
    contentLength = parseContentLength(response);
  } catch (error) {
    response.destroy();
    throw error;
  }
  if (contentLength !== undefined && contentLength > MAX_IMAGE_DOWNLOAD_BYTES) {
    response.destroy();
    throw new Error(`Image size exceeds maximum limit of ${MAX_IMAGE_DOWNLOAD_BYTES} bytes`);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const onAbort = (): void => {
    response.destroy(signal?.reason ?? new Error("Download aborted"));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const chunk of response) {
      if (signal?.aborted) throw signal.reason ?? new Error("Download aborted");
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_IMAGE_DOWNLOAD_BYTES) {
        response.destroy();
        throw new Error(`Image download size exceeds maximum limit of ${MAX_IMAGE_DOWNLOAD_BYTES} bytes`);
      }
      chunks.push(buffer);
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  return Buffer.concat(chunks, totalBytes);
}

/**
 * Downloads an image with socket-bound DNS validation, redirect revalidation,
 * a streaming 50MB limit, and structural image-envelope validation.
 */
export async function downloadImageSafely(
  initialUrl: string,
  options?: { signal?: AbortSignal; timeoutMs?: number; dependencies?: ImageDownloadDependencies },
): Promise<SafeImageDownloadResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Image download timeout must be positive");
  const timeoutController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    timeoutController.abort(new Error(`Image download timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  timeout.unref();
  const signal = options?.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;
  let currentUrl = initialUrl;

  try {
    for (let redirectCount = 0; ; redirectCount++) {
      if (signal.aborted) throw signal.reason ?? new Error("Download aborted");

      const urlCheck = validateImageUrlForDownload(currentUrl);
      if (!urlCheck.valid) {
        throw new Error(`Rejected image download URL for security: ${urlCheck.reason} (${currentUrl})`);
      }

      const parsed = new URL(currentUrl);
      const response = await requestResponse(parsed, signal, options?.dependencies ?? {});
      const statusCode = response.statusCode ?? 0;

      if (REDIRECT_STATUS_CODES.has(statusCode)) {
        const location = response.headers.location;
        response.destroy();
        if (!location) {
          throw new Error(`HTTP redirect ${statusCode} received without Location header from ${currentUrl}`);
        }
        if (redirectCount === MAX_REDIRECTS) {
          throw new Error(`Exceeded maximum redirect limit (${MAX_REDIRECTS}) downloading image`);
        }
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.destroy();
        throw new Error(`Failed to download image from URL: ${statusCode} ${response.statusMessage ?? ""}`.trim());
      }

      const buffer = await readLimitedImageBody(response, signal);
      const mimeType = detectImageMimeType(buffer);
      if (!mimeType) {
        throw new Error("Downloaded content is not a valid recognized image format (PNG, JPEG, WebP, GIF)");
      }
      return { buffer, mimeType };
    }
  } catch (error) {
    if (timedOut) throw new Error(`Image download timed out after ${timeoutMs}ms`, { cause: error });
    if (options?.signal?.aborted) throw new Error("Download aborted", { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
