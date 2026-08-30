import {
  detectImageMimeType,
  parseIPv4Strict,
  validateImageUrlForDownload,
  validateIpAddressForDownload,
} from "./image-mime.ts";

export const MAX_IMAGE_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_REDIRECTS = 5;

export interface SafeImageDownloadResult {
  buffer: Buffer;
  mimeType: string;
}

let _dnsLookup:
  | ((hostname: string, options: { all: boolean }) => Promise<{ address: string; family: number }[]>)
  | null = null;
const dynamicImport = (specifier: string) => import(specifier);
const NODE_DNS_SPECIFIER = "node:" + "dns";

if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
  dynamicImport(NODE_DNS_SPECIFIER)
    .then((m: any) => {
      _dnsLookup = m.promises?.lookup || m.lookup;
    })
    .catch(() => {});
}

/**
 * Resolves a hostname via DNS and validates all returned IP addresses.
 */
async function validateHostnameDns(hostname: string): Promise<{ valid: boolean; reason?: string }> {
  // If it's already an IP address, validation already ran
  if (parseIPv4Strict(hostname) !== null || hostname.startsWith("[") || hostname.includes(":")) {
    return { valid: true };
  }

  if (!_dnsLookup) {
    if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
      try {
        const m = (await dynamicImport(NODE_DNS_SPECIFIER)) as any;
        _dnsLookup = m.promises?.lookup || m.lookup;
      } catch {
        // DNS lookup unavailable in this environment
      }
    }
  }

  if (!_dnsLookup) {
    // In browser or non-Node environments where DNS lookup is unavailable,
    // hostname string validation is the primary defense.
    return { valid: true };
  }

  try {
    const addresses = await _dnsLookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      return { valid: false, reason: `DNS lookup failed for hostname: ${hostname}` };
    }
    for (const record of addresses) {
      const check = validateIpAddressForDownload(record.address);
      if (!check.valid) {
        return {
          valid: false,
          reason: `DNS resolved ${hostname} to private/unallowed IP ${record.address}: ${check.reason}`,
        };
      }
    }
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      reason: `DNS resolution failed for ${hostname}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Downloads an image safely with DNS inspection, redirect revalidation,
 * streaming size limits (aborts after 50MB), and magic byte verification.
 */
export async function downloadImageSafely(
  initialUrl: string,
  options?: { signal?: AbortSignal },
): Promise<SafeImageDownloadResult> {
  let currentUrl = initialUrl;
  let redirectCount = 0;

  while (redirectCount <= MAX_REDIRECTS) {
    if (options?.signal?.aborted) {
      throw new Error("Download aborted");
    }

    const urlCheck = validateImageUrlForDownload(currentUrl);
    if (!urlCheck.valid) {
      throw new Error(`Rejected image download URL for security: ${urlCheck.reason} (${currentUrl})`);
    }

    const parsed = new URL(currentUrl);
    const dnsCheck = await validateHostnameDns(parsed.hostname);
    if (!dnsCheck.valid) {
      throw new Error(`Rejected image download URL for security: ${dnsCheck.reason} (${currentUrl})`);
    }

    const fetchRes = await fetch(currentUrl, {
      signal: options?.signal,
      redirect: "manual",
    });

    // Handle redirects manually to revalidate each hop
    if ([301, 302, 303, 307, 308].includes(fetchRes.status)) {
      const location = fetchRes.headers.get("location");
      if (!location) {
        throw new Error(`HTTP redirect ${fetchRes.status} received without Location header from ${currentUrl}`);
      }
      currentUrl = new URL(location, currentUrl).href;
      redirectCount++;
      if (redirectCount > MAX_REDIRECTS) {
        throw new Error(`Exceeded maximum redirect limit (${MAX_REDIRECTS}) downloading image`);
      }
      continue;
    }

    if (!fetchRes.ok) {
      throw new Error(`Failed to download image from URL: ${fetchRes.status} ${fetchRes.statusText}`);
    }

    // Check early Content-Length header if present
    const contentLength = fetchRes.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_DOWNLOAD_BYTES) {
      throw new Error(`Image size exceeds maximum limit of ${MAX_IMAGE_DOWNLOAD_BYTES} bytes`);
    }

    // Stream download with byte counter to prevent memory exhaustion
    if (!fetchRes.body) {
      throw new Error("No response body received for image download");
    }

    const reader = fetchRes.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        if (options?.signal?.aborted) {
          await reader.cancel();
          throw new Error("Download aborted");
        }

        const { done, value } = await reader.read();
        if (done) break;

        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > MAX_IMAGE_DOWNLOAD_BYTES) {
            await reader.cancel();
            throw new Error(`Image download size exceeds maximum limit of ${MAX_IMAGE_DOWNLOAD_BYTES} bytes`);
          }
          chunks.push(value);
        }
      }
    } catch (err) {
      await reader.cancel().catch(() => {});
      throw err;
    }

    const buffer = Buffer.concat(chunks);
    const detectedMime = detectImageMimeType(buffer);
    if (!detectedMime) {
      throw new Error("Downloaded content is not a valid recognized image format (PNG, JPEG, WebP, GIF)");
    }

    return {
      buffer,
      mimeType: detectedMime,
    };
  }

  throw new Error(`Exceeded maximum redirect limit (${MAX_REDIRECTS}) downloading image`);
}
